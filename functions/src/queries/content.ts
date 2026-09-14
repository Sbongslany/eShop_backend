import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";
import { logAudit } from "../utils/audit";

// Helper to check admin role (Async with Firestore Fallback)
const verifyAdmin = async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  
  const uid = request.auth.uid;
  const email = request.auth.token.email || "";
  const claimRole = request.auth.token.role as string;

  if (claimRole === "super_admin" || claimRole === "admin" || claimRole === "support") {
    return { uid, email, role: claimRole };
  }

  const customerDoc = await db.collection("customers").doc(uid).get();
  if (customerDoc.exists) {
    const data = customerDoc.data();
    if (data?.role === "super_admin" || data?.role === "admin" || data?.role === "support") {
      return { uid, email, role: data.role };
    }
  }

  throw new HttpsError("permission-denied", "Admin access required.");
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
  const admin = await verifyAdmin(request); // FIXED: Added await
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
  const admin = await verifyAdmin(request); // FIXED: Added await
  const { bannerId, ...updateData } = request.data;

  if (!bannerId) throw new HttpsError("invalid-argument", "bannerId is required.");

  const docRef = db.collection("banners").doc(bannerId);
  const doc = await docRef.get();
  if (!doc.exists) throw new HttpsError("not-found", "Banner not found.");

  const previousData = doc.data();
  const newData = { ...updateData, updatedAt: Timestamp.now() };

  if (updateData.startDate) newData.startDate = Timestamp.fromDate(new Date(updateData.startDate));
  if (updateData.endDate) newData.endDate = Timestamp.fromDate(new Date(updateData.endDate));

  await docRef.update(newData);
  await logAudit(admin.uid, admin.email, "UPDATE", "banners", bannerId, previousData, { ...previousData, ...newData });

  return { success: true, message: "Banner updated." };
});

export const deleteBanner = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request); // FIXED: Added await
  const { bannerId } = request.data;

  if (!bannerId) throw new HttpsError("invalid-argument", "bannerId is required.");

  const docRef = db.collection("banners").doc(bannerId);
  const doc = await docRef.get();
  if (!doc.exists) throw new HttpsError("not-found", "Banner not found.");

  const previousData = doc.data();
  await docRef.delete();
  await logAudit(admin.uid, admin.email, "DELETE", "banners", bannerId, previousData, null);

  return { success: true, message: "Banner deleted." };
});

export const getAllBanners = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  try {
    const snapshot = await db.collection("banners").orderBy("order", "asc").get();
    const banners = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    return { success: true, banners };
  } catch (error: any) {
    console.error("Error fetching banners:", error);
    throw new HttpsError("internal", "Failed to fetch banners.");
  }
});

// ==========================================
// 2. SITE SETTINGS & GLOBAL SEO
// ==========================================

export const updateSiteSettings = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request); // FIXED: Added await
  const { siteName, defaultSeoTitle, defaultSeoDescription, faviconUrl, ogImageUrl, twitterHandle, supportEmail, footerText } = request.data;

  if (!siteName || !supportEmail) {
    throw new HttpsError("invalid-argument", "siteName and supportEmail are required.");
  }

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

export const getSiteSettings = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  try {
    const doc = await db.collection("site_settings").doc("global").get();
    return { success: true, settings: doc.exists ? { id: doc.id, ...doc.data() } : null };
  } catch (error: any) {
    console.error("Error fetching site settings:", error);
    throw new HttpsError("internal", "Failed to fetch site settings.");
  }
});

// ==========================================
// 3. MERCHANDISING COLLECTIONS
// ==========================================

export const createCollection = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request); // FIXED: Added await
  const { name, description, seoTitle, seoDescription, ogImageUrl, productIds, sortOrder } = request.data;

  if (!name) throw new HttpsError("invalid-argument", "Collection name is required.");

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
  const admin = await verifyAdmin(request); // FIXED: Added await
  const { collectionId, ...updateData } = request.data;

  if (!collectionId) throw new HttpsError("invalid-argument", "collectionId is required.");

  const docRef = db.collection("collections").doc(collectionId);
  const doc = await docRef.get();
  if (!doc.exists) throw new HttpsError("not-found", "Collection not found.");

  const previousData = doc.data();
  const newData = { ...updateData, updatedAt: Timestamp.now() };

  if (updateData.name && !updateData.slug) {
    newData.slug = generateSlug(updateData.name);
  }

  await docRef.update(newData);
  await logAudit(admin.uid, admin.email, "UPDATE", "collections", collectionId, previousData, { ...previousData, ...newData });

  return { success: true, message: "Collection updated." };
});

export const deleteCollection = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request); // FIXED: Added await
  const { collectionId } = request.data;

  if (!collectionId) throw new HttpsError("invalid-argument", "collectionId is required.");

  const docRef = db.collection("collections").doc(collectionId);
  const doc = await docRef.get();
  if (!doc.exists) throw new HttpsError("not-found", "Collection not found.");

  const previousData = doc.data();
  await docRef.delete();
  await logAudit(admin.uid, admin.email, "DELETE", "collections", collectionId, previousData, null);

  return { success: true, message: "Collection deleted." };
});

export const getAllCollections = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  try {
    const snapshot = await db.collection("collections").get();
    const collections = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    return { success: true, collections };
  } catch (error: any) {
    console.error("Error fetching collections:", error);
    throw new HttpsError("internal", "Failed to fetch collections.");
  }
});