import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";

// Helper to check if user is admin (checks both Custom Claims AND Firestore)
const verifyAdmin = async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const uid = request.auth.uid;
  
  // 1. First, check the Custom Claim
  const claimRole = request.auth.token.role as string;
  if (claimRole === "admin" || claimRole === "super_admin" || claimRole === "support") {
    return true; // User is admin via Custom Claim
  }

  // 2. FALLBACK: Check the Firestore document
  const customerDoc = await db.collection("customers").doc(uid).get();
  if (customerDoc.exists) {
    const data = customerDoc.data();
    if (data?.role === "admin" || data?.role === "super_admin" || data?.role === "support") {
      return true; // User is admin via Firestore document
    }
  }

  // If neither check passes, deny access
  throw new HttpsError("permission-denied", "Admin access required.");
};

// ==========================================
// 1. GET DASHBOARD SALES DATA (Last N days)
// ==========================================
export const getDashboardSales = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  
  const days = request.data?.days || 7;
  
  try {
    const salesSnap = await db.collection("daily_sales_summary")
      .orderBy("date", "desc")
      .limit(days)
      .get();
    
    const salesData = salesSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return {
      success: true,
      days: salesData.reverse()
    };
  } catch (error: any) {
    console.error("Error fetching dashboard sales:", error);
    throw new HttpsError("internal", "Failed to fetch sales data.");
  }
});

// ==========================================
// 2. GET TOP PRODUCTS
// ==========================================
export const getDashboardTopProducts = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  
  const limit = request.data?.limit || 5;
  
  try {
    const metricsSnap = await db.collection("product_sales_metrics")
      .orderBy("unitsSoldLast7Days", "desc")
      .limit(limit)
      .get();
    
    const productIds = metricsSnap.docs.map(doc => doc.id);
    const products = [];

    for (const productId of productIds) {
      const productDoc = await db.collection("products").doc(productId).get();
      const metricDoc = metricsSnap.docs.find(d => d.id === productId);
      
      if (productDoc.exists && metricDoc) {
        products.push({
          id: productId,
          name: productDoc.data()?.name || "Unknown",
          unitsSoldLast7Days: metricDoc.data()?.unitsSoldLast7Days || 0,
          revenueLast7DaysCents: metricDoc.data()?.revenueLast7DaysCents || 0,
          trendPercent: metricDoc.data()?.trendPercent || 0
        });
      }
    }

    return {
      success: true,
      products
    };
  } catch (error: any) {
    console.error("Error fetching top products:", error);
    throw new HttpsError("internal", "Failed to fetch product data.");
  }
});

// ==========================================
// 3. GET RECENT ORDERS
// ==========================================
export const getDashboardRecentOrders = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  
  const limit = request.data?.limit || 10;
  
  try {
    const ordersSnap = await db.collection("orders")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    
    const orders = ordersSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return {
      success: true,
      orders
    };
  } catch (error: any) {
    console.error("Error fetching recent orders:", error);
    throw new HttpsError("internal", "Failed to fetch orders.");
  }
});

// ==========================================
// 4. GET FLAGGED/RISK ORDERS (In-memory filter to avoid index delays)
// ==========================================
export const getDashboardRiskOrders = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  
  try {
    // Fetch the 20 most recent orders
    const ordersSnap = await db.collection("orders")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();
    
    // Filter in memory for flagged or high-risk orders
    const riskOrders = ordersSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((order: any) => order.status === "flagged" || (order.risk && order.risk.score >= 40))
      .slice(0, 5); // Return only the top 5

    return {
      success: true,
      orders: riskOrders
    };
  } catch (error: any) {
    // Log the EXACT Firestore error so we can see what's wrong
    console.error("🔥 ERROR fetching risk orders:", error.message, error.details);
    throw new HttpsError("internal", `Failed to fetch risk orders: ${error.message}`);
  }
});