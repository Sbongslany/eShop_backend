import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";

export const evaluateOrderRisk = onDocumentCreated("orders/{orderId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const orderData = snapshot.data();
  const orderId = event.params.orderId;
  
  let score = 0;
  const flags: string[] = [];

  // 1. High Value Check (> $500)
  if (orderData.totalCents > 50000) {
    score += 20;
    flags.push("high_value");
  }

  // 2. Mismatched Address (Billing vs Shipping Country)
  if (orderData.billingAddress?.country && orderData.shippingAddress?.country) {
    if (orderData.billingAddress.country !== orderData.shippingAddress.country) {
      score += 30;
      flags.push("mismatched_address");
    }
  }

  // 3. New Account High Value Check
  if (orderData.customerId) {
    const customerDoc = await db.collection("customers").doc(orderData.customerId).get();
    if (customerDoc.exists) {
      const customerData = customerDoc.data();
      const createdAt = customerData?.createdAt?.toDate();
      if (createdAt) {
        const accountAgeHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
        if (accountAgeHours < 24 && orderData.totalCents > 10000) {
          score += 25;
          flags.push("new_account_high_value");
        }
      }
    }
  }

  // 4. Velocity Check (More than 2 orders in the last hour from same email)
  const oneHourAgo = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
  const recentOrders = await db.collection("orders")
    .where("customerEmail", "==", orderData.customerEmail)
    .where("createdAt", ">", oneHourAgo)
    .limit(5)
    .get();

  if (recentOrders.size > 2) {
    score += 25;
    flags.push("velocity");
  }

  // Cap score at 100
  score = Math.min(score, 100);

  // Determine decision
  let decision = "approved";
  if (score >= 70) decision = "manual_review";
  
  // Update the order document with risk data
  const updateData: any = {
    risk: {
      score,
      flags,
      decision,
      reviewedBy: null,
      reviewedAt: null
    }
  };

  // If high risk, flag the order status
  if (decision === "manual_review") {
    updateData.status = "flagged";
  }

  await db.collection("orders").doc(orderId).update(updateData);

  // Notify admins if high risk
  if (score >= 70) {
    await db.collection("notifications").add({
      type: "high_risk_order",
      severity: "warning",
      title: `High Risk Order Detected`,
      message: `Order ${orderData.orderNumber} scored ${score}/100. Flags: ${flags.join(", ")}`,
      targetEntity: { collection: "orders", docId: orderId },
      readBy: [],
      createdAt: Timestamp.now(),
      resolvedAt: null,
    });
  }
});