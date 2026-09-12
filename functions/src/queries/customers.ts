import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";
import { logAudit } from "../utils/audit";

// Check if user is admin (Checks Custom Claims FIRST, then falls back to Firestore)
const verifyAdmin = async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }
  
  const uid = request.auth.uid;
  const email = request.auth.token.email || "";
  const claimRole = request.auth.token.role as string;

  // 1. Check Custom Claim first (most secure)
  if (claimRole === "super_admin" || claimRole === "admin" || claimRole === "support") {
    return { uid, email, role: claimRole };
  }

  // 2. FALLBACK: Check Firestore document (allows Console editing)
  const customerDoc = await db.collection("customers").doc(uid).get();
  if (customerDoc.exists) {
    const data = customerDoc.data();
    if (data?.role === "super_admin" || data?.role === "admin" || data?.role === "support") {
      return { uid, email, role: data.role };
    }
  }

  throw new HttpsError("permission-denied", "Admin access required.");
};

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
  await verifyAdmin(request); // FIXED: Added await

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

// ==========================================
// GET CUSTOMER DETAILS (Aggregated view)
// ==========================================
export const getCustomerDetails = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  const { customerId } = request.data;

  if (!customerId) {
    throw new HttpsError("invalid-argument", "customerId is required.");
  }

  try {
    const customerDoc = await db.collection("customers").doc(customerId).get();
    if (!customerDoc.exists) throw new HttpsError("not-found", "Customer not found.");
    
    const addressesSnap = await db.collection("customers").doc(customerId).collection("addresses").get();
    const metricsDoc = await db.collection("customer_metrics").doc(customerId).get();

    return {
      success: true,
      customer: { id: customerDoc.id, ...customerDoc.data() },
      addresses: addressesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      metrics: metricsDoc.exists ? metricsDoc.data() : null,
      counts: { orders: 0, returns: 0, reviews: 0, tickets: 0, wishlist: 0 }
    };
  } catch (error: any) {
    console.error("🔥 getCustomerDetails FAILED:", error.message, error.details);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", `Failed to fetch details: ${error.message}`);
  }
});

// ==========================================
// FAIL-SAFE FETCH (Returns empty array on error, logs exact reason)
// ==========================================
async function safeFetch(collectionName: string, customerId: string, limit: number, dateField: string = "createdAt") {
  try {
    console.log(`🔍 Attempting to fetch ${collectionName} for customerId: ${customerId}`);
    
    const snapshot = await db.collection(collectionName)
      .where("customerId", "==", customerId)
      .limit(limit)
      .get();

    const results = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => {
        const timeA = a[dateField]?.toMillis ? a[dateField].toMillis() : 0;
        const timeB = b[dateField]?.toMillis ? b[dateField].toMillis() : 0;
        return timeB - timeA;
      });

    console.log(`✅ Successfully fetched ${results.length} items from ${collectionName}`);
    return results;
  } catch (error: any) {
    // Log the EXACT error but return empty array to prevent UI crash
    console.error(`🔥 CRITICAL: Failed to fetch ${collectionName} for ${customerId}`);
    console.error(`🔥 ERROR MESSAGE:`, error.message);
    console.error(`🔥 ERROR DETAILS:`, error.details);
    console.error(`🔥 FULL ERROR:`, error);
    
    // Return empty array instead of throwing
    return [];
  }
}

export const getCustomerOrders = onCall(async (request: CallableRequest) => {
  try {
    await verifyAdmin(request);
    const { customerId, limit = 20 } = request.data || {};
    if (!customerId) {
      console.warn("getCustomerOrders: No customerId provided");
      return { success: true, orders: [], hasMore: false };
    }
    
    const orders = await safeFetch("orders", customerId, limit, "createdAt");
    return { success: true, orders, hasMore: false };
  } catch (error: any) {
    console.error("🔥 getCustomerOrders wrapper failed:", error.message);
    return { success: true, orders: [], hasMore: false };
  }
});

export const getCustomerReturns = onCall(async (request: CallableRequest) => {
  try {
    await verifyAdmin(request);
    const { customerId, limit = 20 } = request.data || {};
    if (!customerId) {
      console.warn("getCustomerReturns: No customerId provided");
      return { success: true, returns: [] };
    }
    
    const returns = await safeFetch("returns", customerId, limit, "createdAt");
    return { success: true, returns };
  } catch (error: any) {
    console.error("🔥 getCustomerReturns wrapper failed:", error.message);
    return { success: true, returns: [] };
  }
});

export const getCustomerReviews = onCall(async (request: CallableRequest) => {
  try {
    await verifyAdmin(request);
    const { customerId, limit = 20 } = request.data || {};
    if (!customerId) {
      console.warn("getCustomerReviews: No customerId provided");
      return { success: true, reviews: [] };
    }
    
    const reviews = await safeFetch("reviews", customerId, limit, "createdAt");
    return { success: true, reviews };
  } catch (error: any) {
    console.error("🔥 getCustomerReviews wrapper failed:", error.message);
    return { success: true, reviews: [] };
  }
});

export const getCustomerTickets = onCall(async (request: CallableRequest) => {
  try {
    await verifyAdmin(request);
    const { customerId, limit = 20 } = request.data || {};
    if (!customerId) {
      console.warn("getCustomerTickets: No customerId provided");
      return { success: true, tickets: [] };
    }
    
    const tickets = await safeFetch("support_tickets", customerId, limit, "createdAt");
    return { success: true, tickets };
  } catch (error: any) {
    console.error("🔥 getCustomerTickets wrapper failed:", error.message);
    return { success: true, tickets: [] };
  }
});

export const getCustomerWishlist = onCall(async (request: CallableRequest) => {
  try {
    await verifyAdmin(request);
    const { customerId, limit = 50 } = request.data || {};
    if (!customerId) {
      console.warn("getCustomerWishlist: No customerId provided");
      return { success: true, wishlist: [] };
    }
    
    const snapshot = await db.collection("customers").doc(customerId).collection("wishlists").limit(limit).get();
    const wishlist = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => {
        const timeA = a.addedAt?.toMillis ? a.addedAt.toMillis() : 0;
        const timeB = b.addedAt?.toMillis ? b.addedAt.toMillis() : 0;
        return timeB - timeA;
      });
    return { success: true, wishlist };
  } catch (error: any) {
    console.error("🔥 getCustomerWishlist wrapper failed:", error.message);
    return { success: true, wishlist: [] };
  }
});