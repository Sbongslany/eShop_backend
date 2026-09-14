import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";
import { logAudit } from "../utils/audit";

// Helper to generate URL-friendly slugs
const generateSlug = (name: string): string => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

// Check if user is admin (Checks Custom Claims FIRST, then falls back to Firestore)
const verifyAdmin = async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }
  
  const uid = request.auth.uid;
  const email = request.auth.token.email || "";
  const claimRole = request.auth.token.role as string;

  // 1. Check Custom Claim first (most secure)
  if (claimRole === "super_admin" || claimRole === "admin") {
    return { uid, email, role: claimRole };
  }

  // 2. FALLBACK: Check Firestore document (allows Console editing)
  const customerDoc = await db.collection("customers").doc(uid).get();
  if (customerDoc.exists) {
    const data = customerDoc.data();
    if (data?.role === "super_admin" || data?.role === "admin") {
      return { uid, email, role: data.role };
    }
  }

  throw new HttpsError("permission-denied", "Admin access required.");
};

// ==========================================
// PRODUCT CRUD
// ==========================================

export const createProduct = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request);
  const data = request.data;

  if (!data.name || !data.priceCents || !data.categoryId || !data.categoryName) {
    throw new HttpsError("invalid-argument", "Missing required fields: name, priceCents, categoryId, categoryName.");
  }

  const newProduct = {
    name: data.name,
    slug: data.slug || generateSlug(data.name),
    description: data.description || "",
    priceCents: Number(data.priceCents),
    compareAtPriceCents: data.compareAtPriceCents ? Number(data.compareAtPriceCents) : null,
    currentStock: Number(data.currentStock || 0),
    lowStockThreshold: Number(data.lowStockThreshold || 5),
    categoryId: data.categoryId,
    categoryName: data.categoryName,
    brand: data.brand || "",
    primaryImageUrl: data.primaryImageUrl || "",
    imageUrls: data.imageUrls || [],
    hasVariants: Boolean(data.hasVariants),
    variants: data.variants || [],
    isActive: true,
    isFeatured: Boolean(data.isFeatured),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  const docRef = await db.collection("products").add(newProduct);
  const productId = docRef.id;

  // ==========================================
  // AUTO-CREATE INVENTORY RECORDS FOR ALL WAREHOUSES
  // ==========================================
  try {
    const warehousesSnap = await db.collection("warehouses")
      .where("isActive", "==", true)
      .get();

    const inventoryPromises = warehousesSnap.docs.map(async (warehouseDoc) => {
      const warehouseId = warehouseDoc.id;
      const invId = `${productId}_${warehouseId}`;
      const invRef = db.collection("inventory").doc(invId);

      await invRef.set({
        productId: productId,
        warehouseId: warehouseId,
        quantityOnHand: 0,
        quantityReserved: 0,
        quantityAvailable: 0,
        lowStockThreshold: Number(data.lowStockThreshold || 5),
        allowBackorder: false,
        updatedAt: Timestamp.now(),
      });
    });

    await Promise.all(inventoryPromises);
    console.log(`Created ${warehousesSnap.size} inventory records for product ${productId}`);
  } catch (error: any) {
    console.error("Error creating inventory records:", error);
    // Don't fail the product creation if inventory creation fails
    // Just log the error and continue
  }

  await logAudit(
    admin.uid,
    admin.email,
    "CREATE",
    "products",
    productId,
    null,
    newProduct
  );

  return { success: true, productId: productId };
});

export const updateProduct = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request);
  const { productId, ...updateData } = request.data;

  if (!productId) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }

  const docRef = db.collection("products").doc(productId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new HttpsError("not-found", "Product not found.");
  }

  const previousData = doc.data();
  
  const newData = {
    ...updateData,
    updatedAt: Timestamp.now(),
  };

  if (updateData.name && !updateData.slug) {
    newData.slug = generateSlug(updateData.name);
  }

  await docRef.update(newData);

  // If lowStockThreshold changed, update all inventory records for this product
  if (updateData.lowStockThreshold !== undefined) {
    try {
      const inventorySnap = await db.collection("inventory")
        .where("productId", "==", productId)
        .get();

      const updatePromises = inventorySnap.docs.map((invDoc) => {
        return invDoc.ref.update({
          lowStockThreshold: Number(updateData.lowStockThreshold),
          updatedAt: Timestamp.now(),
        });
      });

      await Promise.all(updatePromises);
      console.log(`Updated lowStockThreshold for ${inventorySnap.size} inventory records`);
    } catch (error: any) {
      console.error("Error updating inventory thresholds:", error);
    }
  }

  await logAudit(
    admin.uid,
    admin.email,
    "UPDATE",
    "products",
    productId,
    previousData,
    { ...previousData, ...newData }
  );

  return { success: true, message: "Product updated." };
});

export const archiveProduct = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request);
  const { productId } = request.data;

  if (!productId) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }

  const docRef = db.collection("products").doc(productId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new HttpsError("not-found", "Product not found.");
  }

  const previousData = doc.data();

  await docRef.update({
    isActive: false,
    updatedAt: Timestamp.now(),
  });

  await logAudit(
    admin.uid,
    admin.email,
    "ARCHIVE",
    "products",
    productId,
    previousData,
    { ...previousData, isActive: false }
  );

  return { success: true, message: "Product archived." };
});

// ==========================================
// CATEGORY CRUD
// ==========================================

export const createCategory = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request);
  const data = request.data;

  if (!data.name) {
    throw new HttpsError("invalid-argument", "Category name is required.");
  }

  const newCategory = {
    name: data.name,
    slug: data.slug || generateSlug(data.name),
    parentId: data.parentId || null,
    imageUrl: data.imageUrl || "",
    isActive: true,
    createdAt: Timestamp.now(),
  };

  const docRef = await db.collection("categories").add(newCategory);

  await logAudit(
    admin.uid,
    admin.email,
    "CREATE",
    "categories",
    docRef.id,
    null,
    newCategory
  );

  return { success: true, categoryId: docRef.id };
});

export const updateCategory = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request);
  const { categoryId, ...updateData } = request.data;

  if (!categoryId) {
    throw new HttpsError("invalid-argument", "categoryId is required.");
  }

  const docRef = db.collection("categories").doc(categoryId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new HttpsError("not-found", "Category not found.");
  }

  const previousData = doc.data();
  const newData = { ...updateData };

  if (updateData.name && !updateData.slug) {
    newData.slug = generateSlug(updateData.name);
  }

  await docRef.update(newData);

  await logAudit(
    admin.uid,
    admin.email,
    "UPDATE",
    "categories",
    categoryId,
    previousData,
    { ...previousData, ...newData }
  );

  return { success: true, message: "Category updated." };
});

export const deleteCategory = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request);
  const { categoryId } = request.data;

  if (!categoryId) {
    throw new HttpsError("invalid-argument", "categoryId is required.");
  }

  const docRef = db.collection("categories").doc(categoryId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new HttpsError("not-found", "Category not found.");
  }

  const productsSnapshot = await db.collection("products")
    .where("categoryId", "==", categoryId)
    .limit(1)
    .get();

  if (!productsSnapshot.empty) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot delete category that contains products. Archive products first."
    );
  }

  const previousData = doc.data();
  await docRef.delete();

  await logAudit(
    admin.uid,
    admin.email,
    "DELETE",
    "categories",
    categoryId,
    previousData,
    null
  );

  return { success: true, message: "Category deleted." };
});

// ==========================================
// GET ALL CATEGORIES (For dropdowns)
// ==========================================
export const getAllCategories = onCall(async (request: CallableRequest) => {
  try {
    const categoriesSnap = await db.collection("categories")
      .orderBy("name", "asc")
      .get();
    
    const categories = categoriesSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return {
      success: true,
      categories
    };
  } catch (error: any) {
    console.error("Error fetching categories:", error);
    throw new HttpsError("internal", "Failed to fetch categories.");
  }
});

// ==========================================
// INVENTORY MANAGEMENT (Directly on Products)
// ==========================================

export const getInventoryList = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  try {
    const snapshot = await db.collection("products").where("isActive", "==", true).get();
    const products = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    return { success: true, products };
  } catch (error: any) {
    console.error("Error fetching inventory list:", error);
    throw new HttpsError("internal", "Failed to fetch inventory list.");
  }
});

export const updateProductStock = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  const { productId, currentStock, lowStockThreshold } = request.data;
  
  if (!productId || currentStock === undefined) {
    throw new HttpsError("invalid-argument", "productId and currentStock are required.");
  }

  const docRef = db.collection("products").doc(productId);
  const updateData = {
    currentStock: Number(currentStock),
    lowStockThreshold: Number(lowStockThreshold || 5),
    updatedAt: Timestamp.now(),
  };

  await docRef.update(updateData);
  return { success: true, message: "Stock updated." };
});