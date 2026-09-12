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

  // If neither check passes, deny access
  throw new HttpsError("permission-denied", "Admin access required.");
};

// ==========================================
// PRODUCT CRUD
// ==========================================

export const createProduct = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request); // <-- Added await
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

  await logAudit(
    admin.uid,
    admin.email,
    "CREATE",
    "products",
    docRef.id,
    null,
    newProduct
  );

  return { success: true, productId: docRef.id };
});

export const updateProduct = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request); // <-- Added await
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
  
  // Ensure updatedAt is always refreshed
  const newData = {
    ...updateData,
    updatedAt: Timestamp.now(),
  };

  // If name changes, update slug (unless slug is explicitly provided)
  if (updateData.name && !updateData.slug) {
    newData.slug = generateSlug(updateData.name);
  }

  await docRef.update(newData);

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
  const admin = await verifyAdmin(request); // <-- Added await
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

  // Soft delete: set isActive to false instead of hard deleting
  // This preserves order history and analytics
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
  const admin = await verifyAdmin(request); // <-- Added await
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
  const admin = await verifyAdmin(request); // <-- Added await
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
  const admin = await verifyAdmin(request); // <-- Added await
  const { categoryId } = request.data;

  if (!categoryId) {
    throw new HttpsError("invalid-argument", "categoryId is required.");
  }

  const docRef = db.collection("categories").doc(categoryId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new HttpsError("not-found", "Category not found.");
  }

  // Check if category has products (optional but recommended)
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
  // Anyone can read categories (storefront needs them too)
  
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