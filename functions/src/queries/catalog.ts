import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import {db} from "../config/admin";
import {Timestamp} from "firebase-admin/firestore";

// 1. FETCH FILTERED ORDERS (with cursor pagination)
export const getFilteredOrders = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const {filters, sortBy = "createdAt", sortDirection = "desc", limit = 50, startAfterId} = request.data;

  let query: any = db.collection("orders");

  // Apply filters
  if (filters?.status) {
    query = query.where("status", "in", filters.status);
  }
  if (filters?.minTotal) {
    query = query.where("totalCents", ">=", filters.minTotal);
  }
  if (filters?.maxTotal) {
    query = query.where("totalCents", "<=", filters.maxTotal);
  }

  // Apply sorting
  query = query.orderBy(sortBy, sortDirection);

  // Apply cursor pagination
  if (startAfterId) {
    const startAfterDoc = await db.collection("orders").doc(startAfterId).get();
    if (startAfterDoc.exists) {
      query = query.startAfter(startAfterDoc);
    }
  }

  // Limit results
  query = query.limit(limit);

  const snapshot = await query.get();

  const orders = snapshot.docs.map((doc: any) => ({
    id: doc.id,
    ...doc.data(),
  }));

  const lastVisible = snapshot.docs[snapshot.docs.length - 1];

  return {
    orders,
    lastDocId: lastVisible?.id || null,
    hasMore: snapshot.docs.length === limit,
  };
});

// 2. FETCH FILTERED PRODUCTS (with cursor pagination)
// 2. FETCH FILTERED PRODUCTS (with cursor pagination & prefix search)
export const getFilteredProducts = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const { 
    filters, 
    searchQuery, 
    sortBy = "name", 
    sortDirection = "asc", 
    limit = 50, 
    startAfterId 
  } = request.data;

  let query: any = db.collection("products");

  // 1. Apply Text Search (Prefix Matching)
  // This finds documents where the name starts with the searchQuery string
  if (searchQuery && typeof searchQuery === "string" && searchQuery.trim() !== "") {
    const searchString = searchQuery.trim().toLowerCase();
    const endString = searchString + "\uf8ff"; // Unicode character that sorts after all regular characters
    
    query = query
      .where("name", ">=", searchString)
      .where("name", "<=", endString);
  }

  // 2. Apply Filters
  if (filters?.category) {
    query = query.where("categoryId", "==", filters.category);
  }
  if (filters?.isActive !== undefined) {
    query = query.where("isActive", "==", filters.isActive);
  }
  if (filters?.isFeatured !== undefined) {
    query = query.where("isFeatured", "==", filters.isFeatured);
  }
  if (filters?.lowStock !== undefined) {
    // Note: Firestore only allows ONE range/inequality filter per query. 
    // If searchQuery is used, this lowStock filter will cause an error. 
    // We handle this by prioritizing search, or you can create a specific "low stock view" function.
    if (!searchQuery) {
      query = query.where("currentStock", "<=", filters.lowStock);
    }
  }

  // 3. Apply Sorting
  // Ensure the sort field is valid to prevent injection/errors
  const validSortFields = ["name", "priceCents", "currentStock", "createdAt", "updatedAt"];
  const finalSortBy = validSortFields.includes(sortBy) ? sortBy : "name";
  const finalSortDir = sortDirection === "desc" ? "desc" : "asc";
  
  query = query.orderBy(finalSortBy, finalSortDir);

  // 4. Apply Cursor Pagination
  if (startAfterId) {
    const startAfterDoc = await db.collection("products").doc(startAfterId).get();
    if (startAfterDoc.exists) {
      query = query.startAfter(startAfterDoc);
    }
  }

  // 5. Limit Results
  query = query.limit(limit);

  const snapshot = await query.get();
  
  const products = snapshot.docs.map((doc: any) => ({
    id: doc.id,
    ...doc.data(),
  }));

  const lastVisible = snapshot.docs[snapshot.docs.length - 1];

  return {
    products: products,
    lastDocId: lastVisible?.id || null,
    hasMore: snapshot.docs.length === limit,
  };
});

// 3. SAVE A VIEW
export const saveView = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const {name, target, filters, sortBy, sortDirection, isShared = false} = request.data;

  if (!name || !target) {
    throw new HttpsError("invalid-argument", "Name and target are required.");
  }

  const viewData = {
    ownerUid: request.auth.uid,
    name,
    target,
    filters: filters || {},
    sortBy: sortBy || "createdAt",
    sortDirection: sortDirection || "desc",
    isShared,
    createdAt: Timestamp.now(),
  };

  const docRef = await db.collection("saved_views").add(viewData);

  return {success: true, viewId: docRef.id};
});

// 4. GET ALL SAVED VIEWS (personal + shared)
export const getSavedViews = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const adminUid = request.auth.uid;

  const snapshot = await db.collection("saved_views")
    .where("ownerUid", "==", adminUid)
    .get();

  const sharedSnapshot = await db.collection("saved_views")
    .where("isShared", "==", true)
    .get();

  const personalViews = snapshot.docs.map((doc: any) => ({
    id: doc.id,
    ...doc.data(),
  }));

  const sharedViews = sharedSnapshot.docs
    .filter((doc: any) => doc.data().ownerUid !== adminUid)
    .map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
    }));

  return {
    personalViews,
    sharedViews,
  };
});
