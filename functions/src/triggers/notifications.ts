import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";

// Helper to create a notification document
const createNotification = async (
  type: "low_stock" | "payment_failed" | "order_flagged",
  severity: "info" | "warning" | "critical",
  title: string,
  message: string,
  targetCollection: "products" | "orders",
  targetId: string
) => {
  await db.collection("notifications").add({
    type,
    severity,
    title,
    message,
    targetEntity: { collection: targetCollection, docId: targetId },
    readBy: [],
    createdAt: Timestamp.now(),
    resolvedAt: null,
  });
};

// 1. LOW STOCK TRIGGER (Forced to us-central1)
export const onProductStockUpdate = onDocumentUpdated(
  { document: "products/{productId}", region: "us-central1" },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) return;

    const beforeStock = beforeData.currentStock;
    const afterStock = afterData.currentStock;
    const threshold = afterData.lowStockThreshold || 5;

    if (afterStock <= threshold && beforeStock > threshold) {
      await createNotification(
        "low_stock",
        "critical",
        `Low Stock Alert: ${afterData.name}`,
        `SKU ${afterData.sku} has dropped to ${afterStock} units.`,
        "products",
        event.params.productId
      );
    }
  }
);

// 2 & 3. FLAGGED ORDERS & FAILED PAYMENTS TRIGGERS (Forced to us-central1)
export const onOrderStatusUpdate = onDocumentUpdated(
  { document: "orders/{orderId}", region: "us-central1" },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) return;

    if (afterData.status === "flagged" && beforeData.status !== "flagged") {
      await createNotification(
        "order_flagged",
        "warning",
        `Order Flagged: #${afterData.orderNumber}`,
        `Reason: ${afterData.flaggedReason || "Manual review required"}`,
        "orders",
        event.params.orderId
      );
    }

    if (afterData.paymentStatus === "failed" && beforeData.paymentStatus !== "failed") {
      await createNotification(
        "payment_failed",
        "critical",
        `Payment Failed: #${afterData.orderNumber}`,
        `Payment for ${afterData.customerEmail} failed to process.`,
        "orders",
        event.params.orderId
      );
    }
  }
);