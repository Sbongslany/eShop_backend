import { onCall, HttpsError, CallableRequest }
  from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";
import { logAudit } from "../utils/audit";

// 1. UPDATE CUSTOMER PROFILE
export const updateCustomerProfile = onCall(
  async (request: CallableRequest) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in.");
    }

    const uid = request.auth.uid;
    const { firstName, lastName, phone } = request.data;

    // Get existing profile for audit log
    const docRef = db.collection("customers").doc(uid);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new HttpsError("not-found", "Customer profile not found.");
    }

    const previousData = doc.data();

    const updateData: Record<string, any> = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (phone !== undefined) updateData.phone = phone;

    await docRef.update(updateData);

    // Log the change
    await logAudit(
      uid,
      request.auth.token.email || "",
      "UPDATE",
      "customers",
      uid,
      previousData,
      { ...previousData, ...updateData }
    );

    return { success: true, message: "Profile updated." };
  }
);

// 2. ADD ADDRESS
export const addAddress = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const uid = request.auth.uid;
  const {
    type, firstName, lastName, street,
    city, state, postalCode, country,
    phone, isDefault,
  } = request.data;

  if (!type || !firstName || !street || !city || !country) {
    throw new HttpsError(
      "invalid-argument",
      "Required fields: type, firstName, street, city, country."
    );
  }

  // If this is set as default, unset other defaults of same type
  if (isDefault) {
    const existingDefaults = await db
      .collection("customers")
      .doc(uid)
      .collection("addresses")
      .where("type", "==", type)
      .where("isDefault", "==", true)
      .get();

    const batch = db.batch();
    existingDefaults.forEach((d) => {
      batch.update(d.ref, { isDefault: false });
    });
    await batch.commit();
  }

  const docRef = await db
    .collection("customers")
    .doc(uid)
    .collection("addresses")
    .add({
      customerId: uid,
      type: type,
      firstName: firstName,
      lastName: lastName || "",
      street: street,
      city: city,
      state: state || "",
      postalCode: postalCode || "",
      country: country,
      phone: phone || "",
      isDefault: isDefault || false,
      createdAt: Timestamp.now(),
    });

  return { success: true, addressId: docRef.id };
});

// 3. DELETE ADDRESS
export const deleteAddress = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const uid = request.auth.uid;
  const { addressId } = request.data;

  if (!addressId) {
    throw new HttpsError("invalid-argument", "addressId is required.");
  }

  await db
    .collection("customers")
    .doc(uid)
    .collection("addresses")
    .doc(addressId)
    .delete();

  return { success: true, message: "Address deleted." };
});

// 4. GET CUSTOMER ADDRESSES
export const getAddresses = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const uid = request.auth.uid;

  const snapshot = await db
    .collection("customers")
    .doc(uid)
    .collection("addresses")
    .orderBy("createdAt", "desc")
    .get();

  const addresses = snapshot.docs.map((d: any) => ({
    id: d.id,
    ...d.data(),
  }));

  return { addresses: addresses };
});

// 5. ADD TO WISHLIST
export const addToWishlist = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const uid = request.auth.uid;
  const { productId } = request.data;

  if (!productId) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }

  // Check if already in wishlist
  const existing = await db
    .collection("customers")
    .doc(uid)
    .collection("wishlists")
    .where("productId", "==", productId)
    .limit(1)
    .get();

  if (!existing.empty) {
    return { success: true, message: "Already in wishlist." };
  }

  await db
    .collection("customers")
    .doc(uid)
    .collection("wishlists")
    .add({
      customerId: uid,
      productId: productId,
      addedAt: Timestamp.now(),
    });

  return { success: true, message: "Added to wishlist." };
});

// 6. REMOVE FROM WISHLIST
export const removeFromWishlist = onCall(
  async (request: CallableRequest) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in.");
    }

    const uid = request.auth.uid;
    const { wishlistItemId } = request.data;

    if (!wishlistItemId) {
      throw new HttpsError(
        "invalid-argument",
        "wishlistItemId is required."
      );
    }

    await db
      .collection("customers")
      .doc(uid)
      .collection("wishlists")
      .doc(wishlistItemId)
      .delete();

    return { success: true, message: "Removed from wishlist." };
  }
);

// 7. GET WISHLIST
export const getWishlist = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const uid = request.auth.uid;

  const snapshot = await db
    .collection("customers")
    .doc(uid)
    .collection("wishlists")
    .orderBy("addedAt", "desc")
    .get();

  const items = snapshot.docs.map((d: any) => ({
    id: d.id,
    ...d.data(),
  }));

  return { wishlist: items };
});

// 8. ADMIN: GET ALL CUSTOMERS (for admin panel)
export const getAllCustomers = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const role = request.auth.token.role;
  if (
    role !== "super_admin" &&
    role !== "admin" &&
    role !== "support"
  ) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }

  const { limit: reqLimit = 50, startAfterId } = request.data;

  let query: any = db.collection("customers").orderBy("createdAt", "desc");

  if (startAfterId) {
    const startDoc = await db
      .collection("customers")
      .doc(startAfterId)
      .get();
    if (startDoc.exists) {
      query = query.startAfter(startDoc);
    }
  }

  query = query.limit(reqLimit);

  const snapshot = await query.get();

  const customers = snapshot.docs.map((d: any) => ({
    id: d.id,
    ...d.data(),
  }));

  const lastVisible = snapshot.docs[snapshot.docs.length - 1];

  return {
    customers: customers,
    lastDocId: lastVisible?.id || null,
    hasMore: snapshot.docs.length === reqLimit,
  };
});