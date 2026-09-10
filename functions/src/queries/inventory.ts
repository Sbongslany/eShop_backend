import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";
import { logAudit } from "../utils/audit";

// Helper to check admin role
const verifyAdmin = (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const role = request.auth.token.role;
  if (role !== "super_admin" && role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return { uid: request.auth.uid, email: request.auth.token.email || "" };
};

// ==========================================
// 1. WAREHOUSE CRUD (Admin Only)
// ==========================================

export const createWarehouse = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { name, code, address } = request.data;

  if (!name || !code || !address) {
    throw new HttpsError("invalid-argument", "Name, code, and address are required.");
  }

  const docRef = await db.collection("warehouses").add({
    name,
    code,
    address,
    isActive: true,
    createdAt: Timestamp.now(),
  });

  await logAudit(admin.uid, admin.email, "CREATE", "warehouses", docRef.id, null, request.data);
  return { success: true, warehouseId: docRef.id };
});

// ==========================================
// 2. INVENTORY MANAGEMENT (Admin sets stock)
// ==========================================

export const updateInventory = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { productId, warehouseId, quantityOnHand, lowStockThreshold, allowBackorder } = request.data;

  if (!productId || !warehouseId || quantityOnHand === undefined) {
    throw new HttpsError("invalid-argument", "productId, warehouseId, and quantityOnHand are required.");
  }

  // Use the composite key pattern for the document ID
  const invId = `${productId}_${warehouseId}`;
  const invRef = db.collection("inventory").doc(invId);

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(invRef);
    
    // Explicitly type as any to allow dynamic property assignment
    const newData: any = {
      productId,
      warehouseId,
      quantityOnHand: Number(quantityOnHand),
      lowStockThreshold: Number(lowStockThreshold || 5),
      allowBackorder: Boolean(allowBackorder || false),
      updatedAt: Timestamp.now(),
    };

    if (doc.exists) {
      const oldData = doc.data() as any;
      // Calculate available stock based on existing reservations
      newData.quantityReserved = oldData.quantityReserved || 0;
      newData.quantityAvailable = newData.quantityOnHand - newData.quantityReserved;
      
      transaction.update(invRef, newData);
      await logAudit(admin.uid, admin.email, "UPDATE", "inventory", invId, oldData, newData);
    } else {
      // Create new inventory record
      newData.quantityReserved = 0;
      newData.quantityAvailable = newData.quantityOnHand;
      
      transaction.set(invRef, newData);
      await logAudit(admin.uid, admin.email, "CREATE", "inventory", invId, null, newData);
    }
  });

  return { success: true, message: "Inventory updated." };
});

// ==========================================
// 3. CHECKOUT FLOW: RESERVE, RELEASE, CONFIRM
// ==========================================

// A. RESERVE STOCK (Called when user proceeds to checkout)
export const reserveStock = onCall(async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  
  const { sessionId, items } = request.data; // items: [{ productId, warehouseId, quantity }]
  
  if (!sessionId || !items || !Array.isArray(items)) {
    throw new HttpsError("invalid-argument", "sessionId and items array are required.");
  }

  const reservationIds: string[] = [];

  // We must run a transaction for EACH item to prevent race conditions
  for (const item of items) {
    const invId = `${item.productId}_${item.warehouseId}`;
    const invRef = db.collection("inventory").doc(invId);

    await db.runTransaction(async (transaction) => {
      const invDoc = await transaction.get(invRef);
      
      if (!invDoc.exists) {
        throw new HttpsError("not-found", `Inventory record not found for product ${item.productId}`);
      }

      const invData = invDoc.data() as any;
      const available = invData.quantityAvailable || 0;
      const requested = Number(item.quantity);

      if (available < requested && !invData.allowBackorder) {
        throw new HttpsError("failed-precondition", `Insufficient stock for product ${item.productId}. Available: ${available}`);
      }

      // 1. Update Inventory Record (Increase Reserved, Decrease Available)
      transaction.update(invRef, {
        quantityReserved: (invData.quantityReserved || 0) + requested,
        quantityAvailable: available - requested,
        updatedAt: Timestamp.now(),
      });

      // 2. Create Stock Reservation Document
      const resRef = db.collection("stock_reservations").doc();
      transaction.set(resRef, {
        sessionId: sessionId,
        customerId: request.auth!.uid,
        productId: item.productId,
        warehouseId: item.warehouseId,
        quantity: requested,
        status: "pending",
        expiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000), // 15 minutes
        createdAt: Timestamp.now(),
      });
      
      reservationIds.push(resRef.id);
    });
  }

  return { success: true, reservationIds };
});

// B. RELEASE STOCK (Called if checkout is cancelled or times out)
export const releaseStock = onCall(async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  
  const { reservationIds } = request.data;
  if (!reservationIds || !Array.isArray(reservationIds)) {
    throw new HttpsError("invalid-argument", "reservationIds array is required.");
  }

  for (const resId of reservationIds) {
    const resRef = db.collection("stock_reservations").doc(resId);
    
    await db.runTransaction(async (transaction) => {
      const resDoc = await transaction.get(resRef);
      if (!resDoc.exists) return; // Already processed or deleted

      const resData = resDoc.data() as any;
      
      // Only release if it's still pending
      if (resData.status !== "pending") return;

      const invId = `${resData.productId}_${resData.warehouseId}`;
      const invRef = db.collection("inventory").doc(invId);
      const invDoc = await transaction.get(invRef);

      if (invDoc.exists) {
        const invData = invDoc.data() as any;
        transaction.update(invRef, {
          quantityReserved: Math.max(0, (invData.quantityReserved || 0) - resData.quantity),
          quantityAvailable: (invData.quantityAvailable || 0) + resData.quantity,
          updatedAt: Timestamp.now(),
        });
      }

      // Mark reservation as released
      transaction.update(resRef, { status: "released" });
    });
  }

  return { success: true, message: "Stock released." };
});

// C. CONFIRM DEDUCTION (Called AFTER successful payment)
export const confirmStockDeduction = onCall(async (request: CallableRequest) => {
  // In production, this should be called securely by a Stripe Webhook. 
  // For now, we protect it with Admin auth.
  verifyAdmin(request); 
  
  const { reservationIds } = request.data;
  if (!reservationIds || !Array.isArray(reservationIds)) {
    throw new HttpsError("invalid-argument", "reservationIds array is required.");
  }

  for (const resId of reservationIds) {
    const resRef = db.collection("stock_reservations").doc(resId);
    
    await db.runTransaction(async (transaction) => {
      const resDoc = await transaction.get(resRef);
      if (!resDoc.exists) return;

      const resData = resDoc.data() as any;
      if (resData.status !== "pending") return; // Prevent double-dipping

      const invId = `${resData.productId}_${resData.warehouseId}`;
      const invRef = db.collection("inventory").doc(invId);
      const invDoc = await transaction.get(invRef);

      if (invDoc.exists) {
        const invData = invDoc.data() as any;
        // Deduct from actual OnHand stock, and remove from Reserved
        transaction.update(invRef, {
          quantityOnHand: Math.max(0, (invData.quantityOnHand || 0) - resData.quantity),
          quantityReserved: Math.max(0, (invData.quantityReserved || 0) - resData.quantity),
          // quantityAvailable stays exactly the same because both OnHand and Reserved decreased
          updatedAt: Timestamp.now(),
        });
      }

      // Mark reservation as confirmed
      transaction.update(resRef, { status: "confirmed" });
    });
  }

  return { success: true, message: "Stock deducted and confirmed." };
});