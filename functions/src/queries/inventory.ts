import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";
import { logAudit } from "../utils/audit";

// Helper to check admin role (Async with Firestore Fallback)
const verifyAdmin = async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  
  const uid = request.auth.uid;
  const email = request.auth.token.email || "";
  const claimRole = request.auth.token.role as string;

  // 1. Check Custom Claim first
  if (claimRole === "super_admin" || claimRole === "admin" || claimRole === "support") {
    return { uid, email, role: claimRole };
  }

  // 2. FALLBACK: Check Firestore document
  const customerDoc = await db.collection("customers").doc(uid).get();
  if (customerDoc.exists) {
    const data = customerDoc.data();
    if (data?.role === "super_admin" || data?.role === "admin" || data?.role === "support") {
      return { uid, email, role: data.role };
    }
  }

  throw new HttpsError("permission-denied", "Admin access required.");
};

// ==========================================
// 1. WAREHOUSE CRUD (Admin Only)
// ==========================================

export const createWarehouse = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request); // FIXED: Added await
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
  const admin = await verifyAdmin(request); // FIXED: Added await
  const { productId, warehouseId, quantityOnHand, lowStockThreshold, allowBackorder } = request.data;

  if (!productId || !warehouseId || quantityOnHand === undefined) {
    throw new HttpsError("invalid-argument", "productId, warehouseId, and quantityOnHand are required.");
  }

  // Use the composite key pattern for the document ID
  const invId = `${productId}_${warehouseId}`;
  const invRef = db.collection("inventory").doc(invId);

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(invRef);
    
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
      newData.quantityReserved = oldData.quantityReserved || 0;
      newData.quantityAvailable = newData.quantityOnHand - newData.quantityReserved;
      
      transaction.update(invRef, newData);
      await logAudit(admin.uid, admin.email, "UPDATE", "inventory", invId, oldData, newData);
    } else {
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

export const reserveStock = onCall(async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  
  const { sessionId, items } = request.data;
  if (!sessionId || !items || !Array.isArray(items)) {
    throw new HttpsError("invalid-argument", "sessionId and items array are required.");
  }

  const reservationIds: string[] = [];

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

      transaction.update(invRef, {
        quantityReserved: (invData.quantityReserved || 0) + requested,
        quantityAvailable: available - requested,
        updatedAt: Timestamp.now(),
      });

      const resRef = db.collection("stock_reservations").doc();
      transaction.set(resRef, {
        sessionId: sessionId,
        customerId: request.auth!.uid,
        productId: item.productId,
        warehouseId: item.warehouseId,
        quantity: requested,
        status: "pending",
        expiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
        createdAt: Timestamp.now(),
      });
      
      reservationIds.push(resRef.id);
    });
  }

  return { success: true, reservationIds };
});

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
      if (!resDoc.exists) return;

      const resData = resDoc.data() as any;
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

      transaction.update(resRef, { status: "released" });
    });
  }

  return { success: true, message: "Stock released." };
});

export const confirmStockDeduction = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request); // FIXED: Added await
  
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
      if (resData.status !== "pending") return;

      const invId = `${resData.productId}_${resData.warehouseId}`;
      const invRef = db.collection("inventory").doc(invId);
      const invDoc = await transaction.get(invRef);

      if (invDoc.exists) {
        const invData = invDoc.data() as any;
        transaction.update(invRef, {
          quantityOnHand: Math.max(0, (invData.quantityOnHand || 0) - resData.quantity),
          quantityReserved: Math.max(0, (invData.quantityReserved || 0) - resData.quantity),
          updatedAt: Timestamp.now(),
        });
      }

      transaction.update(resRef, { status: "confirmed" });
    });
  }

  return { success: true, message: "Stock deducted and confirmed." };
});

// ==========================================
// 4. ADMIN: GET ALL WAREHOUSES
// ==========================================
export const getAllWarehouses = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  try {
    const snapshot = await db.collection("warehouses").where("isActive", "==", true).get();
    const warehouses = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    return { success: true, warehouses };
  } catch (error: any) {
    console.error("Error fetching warehouses:", error);
    throw new HttpsError("internal", "Failed to fetch warehouses.");
  }
});

// ==========================================
// 5. ADMIN: GET WAREHOUSE DETAILS & INVENTORY
// ==========================================
export const getWarehouseDetails = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  const { warehouseId } = request.data;

  if (!warehouseId) {
    throw new HttpsError("invalid-argument", "warehouseId is required.");
  }

  try {
    const warehouseDoc = await db.collection("warehouses").doc(warehouseId).get();
    if (!warehouseDoc.exists) {
      throw new HttpsError("not-found", "Warehouse not found.");
    }
    const warehouse = { id: warehouseDoc.id, ...warehouseDoc.data() };

    const inventorySnapshot = await db.collection("inventory")
      .where("warehouseId", "==", warehouseId)
      .get();

    const inventory = inventorySnapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Fetch product names for these inventory items
    const productIds = inventory.map((inv: any) => inv.productId);
    let productsMap = new Map();
    if (productIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < productIds.length; i += 10) {
        chunks.push(productIds.slice(i, i + 10));
      }
      
      for (const chunk of chunks) {
        const productsSnap = await db.collection("products")
          .where("__name__", "in", chunk)
          .get();
        productsSnap.docs.forEach((doc: any) => {
          productsMap.set(doc.id, doc.data().name);
        });
      }
    }

    const inventoryWithNames = inventory.map((inv: any) => ({
      ...inv,
      productName: productsMap.get(inv.productId) || "Unknown Product"
    }));

    return {
      success: true,
      warehouse,
      inventory: inventoryWithNames,
    };
  } catch (error: any) {
    console.error("Error fetching warehouse details:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to fetch warehouse details.");
  }
});

// ==========================================
// 6. ADMIN: GET LOW STOCK ALERTS
// ==========================================
export const getLowStockAlerts = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  try {
    const snapshot = await db.collection("inventory").get();
    console.log(`[DEBUG] Total inventory records found in DB: ${snapshot.docs.length}`);
    
    const allItems = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    
    const lowStockItems = allItems.filter((inv: any) => {
      const available = inv.quantityAvailable !== undefined ? inv.quantityAvailable : inv.quantityOnHand;
      const threshold = inv.lowStockThreshold || 5;
      const isLow = available <= threshold;
      
      // Log every single item so we can see the math
      console.log(`[DEBUG] Product: ${inv.productId} | Available: ${available} | Threshold: ${threshold} | IsLow: ${isLow}`);
      
      return isLow;
    }).sort((a: any, b: any) => {
      const availA = a.quantityAvailable !== undefined ? a.quantityAvailable : a.quantityOnHand;
      const availB = b.quantityAvailable !== undefined ? b.quantityAvailable : b.quantityOnHand;
      return availA - availB;
    });

    console.log(`[DEBUG] Total low stock items that passed the filter: ${lowStockItems.length}`);

    // Fetch product names for the low stock items
    const productIds = lowStockItems.map((inv: any) => inv.productId);
    let productsMap = new Map();
    if (productIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < productIds.length; i += 10) {
        chunks.push(productIds.slice(i, i + 10));
      }
      for (const chunk of chunks) {
        const productsSnap = await db.collection("products")
          .where("__name__", "in", chunk)
          .get();
        productsSnap.docs.forEach((doc: any) => {
          productsMap.set(doc.id, doc.data().name);
        });
      }
    }

    const alerts = lowStockItems.map((inv: any) => ({
      ...inv,
      productName: productsMap.get(inv.productId) || "Unknown Product"
    }));

    return { success: true, alerts };
  } catch (error: any) {
    console.error("Error fetching low stock alerts:", error);
    throw new HttpsError("internal", "Failed to fetch low stock alerts.");
  }
});

// ==========================================
// 7. ADMIN: BACKFILL INVENTORY FOR EXISTING PRODUCTS (One-time use)
// ==========================================
export const backfillInventoryRecords = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  
  try {
    console.log("Starting inventory backfill...");
    
    // 1. Get all active warehouses
    const warehousesSnap = await db.collection("warehouses").where("isActive", "==", true).get();
    if (warehousesSnap.empty) {
      return { success: false, message: "No active warehouses found. Create a warehouse first." };
    }
    const warehouseIds = warehousesSnap.docs.map(doc => doc.id);
    console.log(`Found ${warehouseIds.length} active warehouse(s)`);

    // 2. Get all active products
    const productsSnap = await db.collection("products").where("isActive", "==", true).get();
    console.log(`Found ${productsSnap.size} active product(s)`);

    let createdCount = 0;

    // 3. Create missing inventory records
    for (const productDoc of productsSnap.docs) {
      const productId = productDoc.id;
      const productData = productDoc.data() as any;
      const threshold = productData.lowStockThreshold || 5;

      for (const warehouseId of warehouseIds) {
        const invId = `${productId}_${warehouseId}`;
        const invRef = db.collection("inventory").doc(invId);
        
        const invDoc = await invRef.get();
        if (!invDoc.exists) {
          // Record doesn't exist, create it
          await invRef.set({
            productId: productId,
            warehouseId: warehouseId,
            quantityOnHand: 0,
            quantityReserved: 0,
            quantityAvailable: 0,
            lowStockThreshold: threshold,
            allowBackorder: false,
            updatedAt: Timestamp.now(),
          });
          createdCount++;
        }
      }
    }

    console.log(`✅ Backfill complete. Created ${createdCount} new inventory records.`);
    return { success: true, message: `Successfully created ${createdCount} inventory records.` };
    
  } catch (error: any) {
    console.error("Error during backfill:", error);
    throw new HttpsError("internal", "Failed to backfill inventory records.");
  }
});