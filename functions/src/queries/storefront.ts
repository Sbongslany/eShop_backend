import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp, FieldPath } from "firebase-admin/firestore";

// ==========================================
// 1. HOMEPAGE AGGREGATION
// ==========================================

export const getHomePageData = onCall(async (request: CallableRequest) => {
  // 1. Fetch Active Banners (Sorted by admin-defined order)
  const bannersSnap = await db.collection("banners")
    .where("isActive", "==", true)
    .orderBy("order", "asc")
    .limit(5)
    .get();
  const banners = bannersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 2. Fetch Featured Collections
  const collectionsSnap = await db.collection("collections")
    .where("isActive", "==", true)
    .limit(4)
    .get();
  const collections = collectionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 3. Fetch Trending Products (Based on our Phase 9 analytics triggers)
  const trendingMetricsSnap = await db.collection("product_sales_metrics")
    .orderBy("unitsSoldLast7Days", "desc")
    .limit(10)
    .get();
  
  const trendingProductIds = trendingMetricsSnap.docs.map(doc => doc.id);
  let trendingProducts: any[] = [];
  
  if (trendingProductIds.length > 0) {
    // Use FieldPath.documentId() to query Firestore documents by their ID
    const productsSnap = await db.collection("products")
      .where(FieldPath.documentId(), "in", trendingProductIds)
      .get();
      
    // Map back to maintain the exact sorting order from the metrics query
    const productsMap = new Map(productsSnap.docs.map(doc => [doc.id, { id: doc.id, ...doc.data() }]));
    trendingProducts = trendingProductIds.map(id => productsMap.get(id)).filter(Boolean);
  }

  // 4. Fetch New Arrivals
  const newProductsSnap = await db.collection("products")
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();
  const newProducts = newProductsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 5. Fetch Global Site Settings (SEO, Site Name, etc.)
  const settingsDoc = await db.collection("site_settings").doc("global").get();
  const siteSettings = settingsDoc.exists ? settingsDoc.data() : null;

  return {
    banners,
    collections,
    trendingProducts,
    newProducts,
    siteSettings,
    cachedAt: Timestamp.now().toMillis()
  };
});

// ==========================================
// 2. PRODUCT DETAILS PAGE AGGREGATION
// ==========================================

export const getProductDetails = onCall(async (request: CallableRequest) => {
  const { productId, warehouseId } = request.data;
  if (!productId) throw new HttpsError("invalid-argument", "productId is required.");

  // 1. Fetch Product Data
  const productDoc = await db.collection("products").doc(productId).get();
  if (!productDoc.exists) throw new HttpsError("not-found", "Product not found.");
  const product = { id: productDoc.id, ...productDoc.data() };

  // 2. Fetch Approved Reviews
  const reviewsSnap = await db.collection("reviews")
    .where("productId", "==", productId)
    .where("isApproved", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();
  const reviews = reviewsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 3. Fetch Approved Q&A
  const qaSnap = await db.collection("product_questions")
    .where("productId", "==", productId)
    .where("isApproved", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();
  const questions = qaSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 4. Fetch Real-time Inventory for the selected warehouse
  let inventory = null;
  if (warehouseId) {
    const invId = `${productId}_${warehouseId}`;
    const invDoc = await db.collection("inventory").doc(invId).get();
    if (invDoc.exists) {
      inventory = invDoc.data();
    }
  }

  return {
    product,
    reviews,
    questions,
    inventory,
  };
});