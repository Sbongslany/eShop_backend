import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";
import { logAudit } from "../utils/audit";

// Helper to check admin role
const verifyAdmin = (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const role = request.auth.token.role;
  if (role !== "super_admin" && role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return { uid: request.auth.uid, email: request.auth.token.email || "" };
};

// Helper to generate URL-friendly slugs
const generateSlug = (name: string): string => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

// ==========================================
// 1. HOMEPAGE BANNERS
// ==========================================

export const createBanner = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { title, imageUrl, linkUrl, altText, order, startDate, endDate } = request.data;

  if (!title || !imageUrl || !altText) {
    throw new HttpsError("invalid-argument", "title, imageUrl, and altText are required.");
  }

  const newBanner = {
    title,
    imageUrl,
    linkUrl: linkUrl || null,
    altText,
    isActive: true,
    order: Number(order || 0),
    startDate: startDate ? Timestamp.fromDate(new Date(startDate)) : null,
    endDate: endDate ? Timestamp.fromDate(new Date(endDate)) : null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  const docRef = await db.collection("banners").add(newBanner);
  await logAudit(admin.uid, admin.email, "CREATE", "banners", docRef.id, null, newBanner);

  return { success: true, bannerId: docRef.id };
});

export const updateBanner = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { bannerId, ...updateData } = request.data;

  if (!bannerId) {
    throw new HttpsError("invalid-argument", "bannerId is required.");
  }

  const docRef = db.collection("banners").doc(bannerId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new HttpsError("not-found", "Banner not found.");
  }

  const previousData = doc.data();
  const newData = {
    ...updateData,
    updatedAt: Timestamp.now(),
  };

  // Handle date conversions if provided
  if (updateData.startDate) newData.startDate = Timestamp.fromDate(new Date(updateData.startDate));
  if (updateData.endDate) newData.endDate = Timestamp.fromDate(new Date(updateData.endDate));

  await docRef.update(newData);
  await logAudit(admin.uid, admin.email, "UPDATE", "banners", bannerId, previousData, { ...previousData, ...newData });

  return { success: true, message: "Banner updated." };
});

export const deleteBanner = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { bannerId } = request.data;

  if (!bannerId) {
    throw new HttpsError("invalid-argument", "bannerId is required.");
  }

  const docRef = db.collection("banners").doc(bannerId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new HttpsError("not-found", "Banner not found.");
  }

  const previousData = doc.data();
  await docRef.delete();
  await logAudit(admin.uid, admin.email, "DELETE", "banners", bannerId, previousData, null);

  return { success: true, message: "Banner deleted." };
});

// ==========================================
// 2. SITE SETTINGS & GLOBAL SEO
// ==========================================

export const updateSiteSettings = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { siteName, defaultSeoTitle, defaultSeoDescription, faviconUrl, ogImageUrl, twitterHandle, supportEmail, footerText } = request.data;

  if (!siteName || !supportEmail) {
    throw new HttpsError("invalid-argument", "siteName and supportEmail are required.");
  }

  // We use a single document with ID "global" for site settings
  const docRef = db.collection("site_settings").doc("global");
  const doc = await docRef.get();
  const previousData = doc.exists ? doc.data() : null;

  const newData = {
    siteName,
    defaultSeoTitle: defaultSeoTitle || "",
    defaultSeoDescription: defaultSeoDescription || "",
    faviconUrl: faviconUrl || null,
    ogImageUrl: ogImageUrl || null,
    twitterHandle: twitterHandle || null,
    supportEmail,
    footerText: footerText || "",
    updatedAt: Timestamp.now(),
  };

  await docRef.set(newData, { merge: true });
  await logAudit(admin.uid, admin.email, "UPDATE", "site_settings", "global", previousData, newData);

  return { success: true, message: "Site settings updated." };
});

// ==========================================
// 3. MERCHANDISING COLLECTIONS
// ==========================================

export const createCollection = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { name, description, seoTitle, seoDescription, ogImageUrl, productIds, sortOrder } = request.data;

  if (!name) {
    throw new HttpsError("invalid-argument", "Collection name is required.");
  }

  const newCollection = {
    name,
    slug: generateSlug(name),
    description: description || "",
    seoTitle: seoTitle || null,
    seoDescription: seoDescription || null,
    ogImageUrl: ogImageUrl || null,
    productIds: Array.isArray(productIds) ? productIds : [],
    sortOrder: sortOrder || "manual",
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  const docRef = await db.collection("collections").add(newCollection);
  await logAudit(admin.uid, admin.email, "CREATE", "collections", docRef.id, null, newCollection);

  return { success: true, collectionId: docRef.id };
});

export const updateCollection = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { collectionId, ...updateData } = request.data;

  if (!collectionId) {
    throw new HttpsError("invalid-argument", "collectionId is required.");
  }

  const docRef = db.collection("collections").doc(collectionId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new HttpsError("not-found", "Collection not found.");
  }

  const previousData = doc.data();
  const newData = {
    ...updateData,
    updatedAt: Timestamp.now(),
  };

  // If name changes, update slug (unless slug is explicitly provided)
  if (updateData.name && !updateData.slug) {
    newData.slug = generateSlug(updateData.name);
  }

  await docRef.update(newData);
  await logAudit(admin.uid, admin.email, "UPDATE", "collections", collectionId, previousData, { ...previousData, ...newData });

  return { success: true, message: "Collection updated." };
});

export const deleteCollection = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { collectionId } = request.data;

  if (!collectionId) {
    throw new HttpsError("invalid-argument", "collectionId is required.");
  }

  const docRef = db.collection("collections").doc(collectionId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new HttpsError("not-found", "Collection not found.");
  }

  const previousData = doc.data();
  await docRef.delete();
  await logAudit(admin.uid, admin.email, "DELETE", "collections", collectionId, previousData, null);

  return { success: true, message: "Collection deleted." };
});