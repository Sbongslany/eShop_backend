import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";

// Callable function to create customer profile AFTER frontend auth signup
export const registerCustomer = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in to register.");
  }

  const uid = request.auth.uid;
  const email = request.auth.token.email || "";
  const { firstName = "", lastName = "", phone = "" } = request.data;

  // Check if profile already exists
  const existingDoc = await db.collection("customers").doc(uid).get();
  if (existingDoc.exists) {
    return { success: true, message: "Profile already exists." };
  }

  // Create the customer profile
  await db.collection("customers").doc(uid).set({
    uid: uid,
    email: email,
    firstName: firstName,
    lastName: lastName,
    phone: phone,
    createdAt: Timestamp.now(),
    lastLogin: Timestamp.now(),
    isGuest: false,
  });

  return { success: true, message: "Customer profile created." };
});

// Update lastLogin on every login (triggered when frontend updates this field)
export const onCustomerLogin = onDocumentWritten(
  "customers/{customerId}",
  async (event) => {
    if (!event.data) return;
    if (!event.data.after.exists) return;

    const afterData = event.data.after.data();
    const beforeData = event.data.before?.data();

    // Only update lastLogin if document existed before (not creation)
    if (beforeData && afterData) {
      // We only update if something else changed to avoid infinite loops, 
      // but for simplicity, we can just let the frontend call a "ping" function 
      // or we can remove this trigger and let the frontend handle lastLogin updates.
      // Let's keep it simple: frontend will call a callable function to update lastLogin.
    }
  }
);

// Callable function to update last login time
export const updateLastLogin = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const uid = request.auth.uid;
  await db.collection("customers").doc(uid).update({
    lastLogin: Timestamp.now(),
  });

  return { success: true };
});