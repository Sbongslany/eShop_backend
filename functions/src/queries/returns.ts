import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";
import { logAudit } from "../utils/audit";

// Helper to check admin role
const verifyAdmin = (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const role = request.auth.token.role;
  if (role !== "super_admin" && role !== "admin" && role !== "support") {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return { uid: request.auth.uid, email: request.auth.token.email || "" };
};

// Helper to generate RMA number
const generateRMANumber = (): string => {
  const year = new Date().getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `RMA-${year}-${random}`;
};

// ==========================================
// 1. CUSTOMER: REQUEST A RETURN
// ==========================================

export const requestReturn = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in to request a return.");
  }

  const { orderId, items, customerNotes } = request.data;

  if (!orderId || !items || !Array.isArray(items) || items.length === 0) {
    throw new HttpsError("invalid-argument", "orderId and items array are required.");
  }

  const customerId = request.auth.uid;

  try {
    const returnId = db.collection("returns").doc().id;
    const rmaNumber = generateRMANumber();

    // Fetch the order to validate items and get exact prices securely
    const orderDoc = await db.collection("orders").doc(orderId).get();
    if (!orderDoc.exists) {
      throw new HttpsError("not-found", "Order not found.");
    }
    const orderData = orderDoc.data() as any;

    if (orderData.customerId !== customerId) {
      throw new HttpsError("permission-denied", "You can only request returns for your own orders.");
    }

    if (orderData.status === "cancelled" || orderData.status === "refunded") {
      throw new HttpsError("failed-precondition", "Cannot return a cancelled or already refunded order.");
    }

    let requestedRefundCents = 0;
    const validatedItems = [];

    for (const reqItem of items) {
      const orderItem = orderData.items.find((i: any) => i.productId === reqItem.productId && i.variantId === (reqItem.variantId || null));
      if (!orderItem) {
        throw new HttpsError("invalid-argument", `Item ${reqItem.productId} not found in this order.`);
      }
      if (reqItem.quantity > orderItem.quantity) {
        throw new HttpsError("invalid-argument", `Return quantity exceeds ordered quantity for ${reqItem.productId}.`);
      }

      const itemRefund = orderItem.priceCents * reqItem.quantity;
      requestedRefundCents += itemRefund;

      validatedItems.push({
        productId: reqItem.productId,
        variantId: reqItem.variantId || null,
        name: orderItem.name,
        quantity: reqItem.quantity,
        reason: reqItem.reason || "Not specified",
        condition: "new", // Default, will be updated by warehouse upon inspection
      });
    }

    const newReturn = {
      id: returnId,
      rmaNumber: rmaNumber,
      orderId: orderId,
      customerId: customerId,
      items: validatedItems,
      status: "requested",
      requestedRefundCents: requestedRefundCents,
      restockingFeeCents: 0,
      approvedRefundCents: requestedRefundCents, // Starts as requested, admin can adjust
      customerNotes: customerNotes || "",
      adminNotes: "",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    await db.collection("returns").doc(returnId).set(newReturn);

    // Trigger a notification for admins about the new return request
    await db.collection("notifications").add({
      type: "return_requested",
      severity: "info",
      title: `New Return Request: ${rmaNumber}`,
      message: `Customer requested a return for Order ${orderData.orderNumber}.`,
      targetEntity: { collection: "returns", docId: returnId },
      readBy: [],
      createdAt: Timestamp.now(),
      resolvedAt: null,
    });

    return { success: true, returnId, rmaNumber };

  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    console.error("Return request failed:", error);
    throw new HttpsError("internal", "Failed to request return.");
  }
});

// ==========================================
// 2. ADMIN: UPDATE RETURN STATUS (Approve, Reject, Receive, Refund)
// ==========================================

export const updateReturnStatus = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { returnId, newStatus, adminNotes, restockingFeeCents, returnTrackingNumber } = request.data;

  if (!returnId || !newStatus) {
    throw new HttpsError("invalid-argument", "returnId and newStatus are required.");
  }

  const validStatuses = ["approved", "rejected", "received", "refunded", "closed"];
  if (!validStatuses.includes(newStatus)) {
    throw new HttpsError("invalid-argument", "Invalid newStatus.");
  }

  const returnRef = db.collection("returns").doc(returnId);

  await db.runTransaction(async (transaction) => {
    const returnDoc = await transaction.get(returnRef);
    if (!returnDoc.exists) {
      throw new HttpsError("not-found", "Return request not found.");
    }

    const returnData = returnDoc.data() as any;
    const oldStatus = returnData.status;

    // State machine validation
    if (oldStatus === "rejected" || oldStatus === "refunded" || oldStatus === "closed") {
      throw new HttpsError("failed-precondition", `Cannot update a return that is already ${oldStatus}.`);
    }

    const updateData: any = {
      status: newStatus,
      updatedAt: Timestamp.now(),
    };

    if (adminNotes) {
      updateData.adminNotes = (returnData.adminNotes ? returnData.adminNotes + "\n\n" : "") + `[${admin.email}]: ${adminNotes}`;
    }

    if (newStatus === "approved" && restockingFeeCents !== undefined) {
      updateData.restockingFeeCents = Number(restockingFeeCents);
      updateData.approvedRefundCents = Math.max(0, returnData.requestedRefundCents - updateData.restockingFeeCents);
    }

    if (newStatus === "received") {
      updateData.receivedAt = Timestamp.now();
    }

    if (newStatus === "refunded") {
      updateData.resolvedAt = Timestamp.now();
      // NOTE: In a real app, you would trigger the actual Stripe refund API call here via a backend service.
    }

    if (returnTrackingNumber) {
      updateData.returnTrackingNumber = returnTrackingNumber;
    }

    transaction.update(returnRef, updateData);

    await logAudit(
      admin.uid,
      admin.email,
      `UPDATE_RETURN_TO_${newStatus.toUpperCase()}`,
      "returns",
      returnId,
      { status: oldStatus },
      { status: newStatus, ...updateData }
    );
  });

  return { success: true, message: `Return status updated to ${newStatus}.` };
});

// ==========================================
// 3. ADMIN: UPDATE ORDER STATUS (Ship, Deliver, Cancel)
// ==========================================

export const updateOrderStatus = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { orderId, newStatus, trackingNumber, notes } = request.data;

  if (!orderId || !newStatus) {
    throw new HttpsError("invalid-argument", "orderId and newStatus are required.");
  }

  const validStatuses = ["processing", "shipped", "delivered", "cancelled", "flagged"];
  if (!validStatuses.includes(newStatus)) {
    throw new HttpsError("invalid-argument", "Invalid newStatus.");
  }

  const orderRef = db.collection("orders").doc(orderId);

  await db.runTransaction(async (transaction) => {
    const orderDoc = await transaction.get(orderRef);
    if (!orderDoc.exists) {
      throw new HttpsError("not-found", "Order not found.");
    }

    const orderData = orderDoc.data() as any;
    const oldStatus = orderData.status;

    const updateData: any = {
      status: newStatus,
      updatedAt: Timestamp.now(),
    };

    if (trackingNumber) updateData.trackingNumber = trackingNumber;
    if (notes) updateData.notes = (orderData.notes ? orderData.notes + "\n" : "") + notes;

    transaction.update(orderRef, updateData);

    await logAudit(
      admin.uid,
      admin.email,
      `UPDATE_ORDER_TO_${newStatus.toUpperCase()}`,
      "orders",
      orderId,
      { status: oldStatus },
      { status: newStatus, ...updateData }
    );
  });

  return { success: true, message: `Order status updated to ${newStatus}.` };
});

/// new admin

