import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { db } from "../config/admin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

// Helper to get YYYY-MM-DD string from a Timestamp
const getDateStr = (ts: Timestamp): string => {
  const date = ts.toDate();
  return date.toISOString().split("T")[0];
};

// ==========================================
// 1. ORDER COMPLETION AGGREGATION
// ==========================================

export const onOrderCompleted = onDocumentUpdated("orders/{orderId}", async (event) => {
  const beforeData = event.data?.before.data() as any;
  const afterData = event.data?.after.data() as any;

  if (!beforeData || !afterData) return;

  // Only trigger when an order transitions to "paid" or "delivered" for the first time
  const wasUnpaid = beforeData.paymentStatus !== "paid" && beforeData.status !== "delivered";
  const isNowPaid = afterData.paymentStatus === "paid" || afterData.status === "delivered";

  if (!wasUnpaid || !isNowPaid) return; // Skip if already counted or not yet paid

  const orderDateStr = getDateStr(afterData.createdAt);
  const customerId = afterData.customerId;
  const netRevenue = afterData.totalCents - (afterData.discountCents || 0);

  const batch = db.batch();

  // 1. Update Daily Sales Summary
  const dailyRef = db.collection("daily_sales_summary").doc(orderDateStr);
  batch.set(dailyRef, {
    date: Timestamp.fromDate(new Date(orderDateStr + "T00:00:00Z")),
    totalOrders: FieldValue.increment(1),
    totalRevenueCents: FieldValue.increment(afterData.totalCents),
    totalDiscountCents: FieldValue.increment(afterData.discountCents || 0),
    netRevenueCents: FieldValue.increment(netRevenue),
    newCustomersCount: afterData.isGuest ? 0 : FieldValue.increment(1), // Simplified: assumes auth = new (can be refined)
    updatedAt: Timestamp.now(),
  }, { merge: true });

  // 2. Update Product Sales Metrics
  for (const item of afterData.items) {
    const productRef = db.collection("product_sales_metrics").doc(item.productId);
    batch.set(productRef, {
      productName: item.name,
      categoryId: item.categoryId || "unknown",
      totalUnitsSold: FieldValue.increment(item.quantity),
      totalRevenueCents: FieldValue.increment(item.priceCents * item.quantity),
      unitsSoldLast7Days: FieldValue.increment(item.quantity),
      revenueLast7DaysCents: FieldValue.increment(item.priceCents * item.quantity),
      lastSoldAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  }

  // 3. Update Customer LTV Metrics (if authenticated)
  if (customerId) {
    const customerRef = db.collection("customer_metrics").doc(customerId);
    batch.set(customerRef, {
      customerEmail: afterData.customerEmail,
      totalOrders: FieldValue.increment(1),
      totalSpentCents: FieldValue.increment(afterData.totalCents),
      lastOrderDate: Timestamp.now(),
      firstOrderDate: FieldValue.serverTimestamp(), // Only sets if it doesn't exist
      updatedAt: Timestamp.now(),
    }, { merge: true });

    // Note: Segment upgrading (e.g., retail -> vip) can be done here or via a scheduled function
  }

  await batch.commit();
});

// ==========================================
// 2. SCHEDULED: RESET 7-DAY METRICS (Optional but recommended)
// ==========================================
// In a real app, you'd use a scheduled function (pubsub) to run weekly 
// and decrement the "Last 7 Days" counters to keep them rolling. 
// For this phase, the incremental approach gives us a strong foundation.