import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";

export const getOrderDetails = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }
  
  const role = request.auth.token.role;
  if (role !== "super_admin" && role !== "admin" && role !== "support") {
    throw new HttpsError("permission-denied", "Admin access required.");
  }

  const { orderId } = request.data;
  if (!orderId) {
    throw new HttpsError("invalid-argument", "orderId is required.");
  }

  try {
    const doc = await db.collection("orders").doc(orderId).get();
    if (!doc.exists) {
      throw new HttpsError("not-found", "Order not found.");
    }

    return { 
      success: true, 
      order: { id: doc.id, ...doc.data() } 
    };
  } catch (error: any) {
    console.error("Error fetching order details:", error);
    throw new HttpsError("internal", "Failed to fetch order details.");
  }
});