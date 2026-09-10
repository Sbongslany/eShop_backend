import { beforeUserCreated } from "firebase-functions/v2/identity";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { db, adminAuth } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";

// Auto-create customer document when a new user signs up
export const onCustomerCreated = beforeUserCreated(async (event) => {
  if (!event.data) return;

  const uid = event.data.uid;
  const email = event.data.email || "";

  // Check if it's an admin (has custom claims)
  const userRecord = await adminAuth.getUser(uid);
  const isAdmin = userRecord.customClaims?.role;

  // Only create customer doc if NOT an admin
  if (!isAdmin) {
    await db.collection("customers").doc(uid).set({
      uid: uid,
      email: email,
      firstName: "",
      lastName: "",
      phone: "",
      createdAt: Timestamp.now(),
      lastLogin: Timestamp.now(),
      isGuest: false,
    });
  }
});

// Update lastLogin on every login
export const onCustomerLogin = onDocumentWritten(
  "customers/{customerId}",
  async (event) => {
    if (!event.data) return;
    if (!event.data.after.exists) return;

    const afterData = event.data.after.data();
    const beforeData = event.data.before?.data();

    // Only update lastLogin if document existed before (not creation)
    if (beforeData && afterData) {
      await event.data.after.ref.update({
        lastLogin: Timestamp.now(),
      });
    }
  }
);