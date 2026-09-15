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


// ==========================================
// PUBLIC STOREFRONT FUNCTIONS (No Auth Required)
// ==========================================

export const getPublicBanners = onCall(async (request: CallableRequest) => {
  try {
    // Fetch without orderBy to avoid composite index requirements
    const snapshot = await db.collection("banners")
      .where("isActive", "==", true)
      .get();
    
    const banners = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    
    // Sort in memory by order
    banners.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
    
    return { success: true, banners };
  } catch (error: any) {
    console.error("🔥 Error fetching public banners:", error);
    throw new HttpsError("internal", `Failed to fetch banners: ${error.message}`);
  }
});

export const getPublicCategories = onCall(async (request: CallableRequest) => {
  try {
    // Fetch without orderBy to avoid composite index requirements
    const snapshot = await db.collection("categories")
      .where("isActive", "==", true)
      .get();
    
    const categories = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    
    // Sort in memory by name
    categories.sort((a: any, b: any) => a.name.localeCompare(b.name));
    
    return { success: true, categories };
  } catch (error: any) {
    console.error("🔥 Error fetching public categories:", error);
    throw new HttpsError("internal", `Failed to fetch categories: ${error.message}`);
  }
});

export const getPublicProducts = onCall(async (request: CallableRequest) => {
  try {
    const { limit = 20, isFeatured = false } = request.data || {};
    
    let query: any = db.collection("products").where("isActive", "==", true);
    
    if (isFeatured) {
      query = query.where("isFeatured", "==", true);
    }
    
    const snapshot = await query.limit(limit).get();
    const products = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    
    return { success: true, products };
  } catch (error: any) {
    console.error("🔥 Error fetching public products:", error);
    throw new HttpsError("internal", `Failed to fetch products: ${error.message}`);
  }
});