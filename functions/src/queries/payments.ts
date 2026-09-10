import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";
import axios from "axios";

// Define secrets (v2 way)
const PAYSTACK_SECRET_KEY = defineSecret("PAYSTACK_SECRET_KEY");

// Helper to check if user is authenticated (guests can pay too)
const verifyAuthOrGuest = (request: CallableRequest) => {
  return {
    uid: request.auth?.uid || "guest",
    email: request.auth?.token?.email || request.data.customerEmail,
  };
};

export const initializePayment = onCall(
  {
    secrets: [PAYSTACK_SECRET_KEY],
  },
  async (request: CallableRequest) => {
    const { orderId, amountCents, currency, customerEmail, customerName } = request.data;

    if (!orderId || !amountCents || !currency || !customerEmail) {
      throw new HttpsError("invalid-argument", "orderId, amountCents, currency, and customerEmail are required.");
    }

    const user = verifyAuthOrGuest(request);
    
    // 1. Verify the order exists and matches the amount
    const orderDoc = await db.collection("orders").doc(orderId).get();
    if (!orderDoc.exists) {
      throw new HttpsError("not-found", "Order not found.");
    }
    const orderData = orderDoc.data() as any;

    if (orderData.totalCents !== amountCents) {
      throw new HttpsError("failed-precondition", "Order total does not match payment amount.");
    }

    if (orderData.paymentStatus === "paid") {
      throw new HttpsError("failed-precondition", "This order has already been paid.");
    }

    // 2. Generate a unique reference for Paystack
    const paystackReference = `order_${orderId}_${Date.now()}`;

    // 3. Initialize Transaction with Paystack
    const secretKey = PAYSTACK_SECRET_KEY.value();
    if (!secretKey) {
      throw new HttpsError("internal", "Paystack secret key is not configured.");
    }

    try {
      const response = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        {
          email: customerEmail,
          amount: amountCents, // Paystack expects amount in kobo/cents
          currency: currency,
          reference: paystackReference,
          metadata: {
            orderId: orderId,
            customerId: user.uid,
            customerName: customerName || "Guest",
          },
        },
        {
          headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.data.status) {
        throw new Error(response.data.message || "Failed to initialize Paystack transaction");
      }

      const { authorization_url, reference } = response.data.data;

      // 4. Save Payment Record to Firestore
      const paymentRef = db.collection("payments").doc();
      await paymentRef.set({
        id: paymentRef.id,
        orderId: orderId,
        customerId: user.uid === "guest" ? null : user.uid,
        paystackReference: reference,
        amountCents: amountCents,
        currency: currency,
        status: "pending",
        customerEmail: customerEmail,
        customerName: customerName || "Guest",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      // 5. Update Order to show payment is in progress
      await db.collection("orders").doc(orderId).update({
        paymentStatus: "pending",
        paymentIntentId: reference, // Storing Paystack reference here
        updatedAt: Timestamp.now(),
      });

      return { 
        success: true, 
        authorizationUrl: authorization_url, 
        reference: reference,
        paymentId: paymentRef.id
      };

    } catch (error: any) {
      console.error("Paystack initialization error:", error.response?.data || error.message);
      throw new HttpsError("internal", "Failed to initialize payment. Please try again.");
    }
  }
);