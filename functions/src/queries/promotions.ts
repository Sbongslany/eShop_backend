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

  // 1. Check Custom Claim first
  if (claimRole === "super_admin" || claimRole === "admin" || claimRole === "support") {
    return { uid, email, role: claimRole };
  }

  // 2. FALLBACK: Check Firestore document
  const customerDoc = await db.collection("customers").doc(uid).get();
  if (customerDoc.exists) {
    const data = customerDoc.data();
    if (data?.role === "super_admin" || data?.role === "admin" || data?.role === "support") {
      return { uid, email, role: data.role };
    }
  }

  throw new HttpsError("permission-denied", "Admin access required.");
};

// ==========================================
// 1. ADMIN: CREATE PROMOTION
// ==========================================
export const createPromotion = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request); // FIXED: Added await
  const { name, description, type, value, conditions, schedule } = request.data;

  if (!name || !type || value === undefined || !conditions || !schedule) {
    throw new HttpsError("invalid-argument", "Missing required promotion fields.");
  }

  const newPromotion = {
    name,
    description: description || "",
    type,
    value: Number(value),
    conditions: {
      minSubtotalCents: Number(conditions.minSubtotalCents || 0),
      requiredCategoryIds: conditions.requiredCategoryIds || [],
      excludedCategoryIds: conditions.excludedCategoryIds || [],
      targetCustomerSegments: conditions.targetCustomerSegments || ["all"],
      maxUsesPerCustomer: Number(conditions.maxUsesPerCustomer || 0),
    },
    schedule: {
      isActive: Boolean(schedule.isActive),
      startDate: schedule.startDate instanceof Timestamp ? schedule.startDate : Timestamp.fromDate(new Date(schedule.startDate)),
      endDate: schedule.endDate instanceof Timestamp ? schedule.endDate : Timestamp.fromDate(new Date(schedule.endDate)),
    },
    totalUsageCount: 0,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  const docRef = await db.collection("promotions").add(newPromotion);

  await logAudit(admin.uid, admin.email, "CREATE", "promotions", docRef.id, null, newPromotion);

  return { success: true, promotionId: docRef.id };
});

// ==========================================
// 2. ADMIN: UPDATE PROMOTION
// ==========================================
export const updatePromotion = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request); // FIXED: Added await
  const { promotionId, ...updateData } = request.data;

  if (!promotionId) {
    throw new HttpsError("invalid-argument", "promotionId is required.");
  }

  const docRef = db.collection("promotions").doc(promotionId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new HttpsError("not-found", "Promotion not found.");
  }

  const previousData = doc.data();
  const newData = {
    ...updateData,
    updatedAt: Timestamp.now(),
  };

  await docRef.update(newData);

  await logAudit(admin.uid, admin.email, "UPDATE", "promotions", promotionId, previousData, { ...previousData, ...newData });

  return { success: true, message: "Promotion updated." };
});

// ==========================================
// 3. ADMIN: GET ALL PROMOTIONS
// ==========================================
export const getAllPromotions = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);

  try {
    const snapshot = await db.collection("promotions").get();
    
    // Sort in memory to avoid composite index issues
    const promotions = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
    })).sort((a: any, b: any) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return timeB - timeA;
    });

    return { success: true, promotions };
  } catch (error: any) {
    console.error("Error fetching promotions:", error);
    throw new HttpsError("internal", "Failed to fetch promotions.");
  }
});

// ==========================================
// 4. ADMIN: DELETE PROMOTION
// ==========================================
export const deletePromotion = onCall(async (request: CallableRequest) => {
  const admin = await verifyAdmin(request); // FIXED: Added await
  const { promotionId } = request.data;

  if (!promotionId) {
    throw new HttpsError("invalid-argument", "promotionId is required.");
  }

  const docRef = db.collection("promotions").doc(promotionId);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new HttpsError("not-found", "Promotion not found.");
  }

  const previousData = doc.data();
  await docRef.delete();

  await logAudit(admin.uid, admin.email, "DELETE", "promotions", promotionId, previousData, null);

  return { success: true, message: "Promotion deleted." };
});

// ==========================================
// 5. ENGINE: EVALUATE PROMOTIONS FOR A CART
// ==========================================
export const evaluatePromotions = onCall(async (request: CallableRequest) => {
  const { cartItems, subtotalCents, customerSegment = "retail" } = request.data;

  if (!cartItems || !Array.isArray(cartItems) || subtotalCents === undefined) {
    throw new HttpsError("invalid-argument", "cartItems and subtotalCents are required.");
  }

  const now = Timestamp.now();

  const promotionsSnapshot = await db.collection("promotions")
    .where("schedule.isActive", "==", true)
    .where("schedule.startDate", "<=", now)
    .where("schedule.endDate", ">=", now)
    .get();

  const applicablePromotions = [];
  let maxDiscountCents = 0;
  let bestPromotion = null;

  const cartCategoryIds = new Set(cartItems.map((item: any) => item.categoryId).filter(Boolean));

  for (const promoDoc of promotionsSnapshot.docs) {
    const promo = promoDoc.data() as any;

    if (!promo.conditions.targetCustomerSegments.includes("all") && 
        !promo.conditions.targetCustomerSegments.includes(customerSegment)) {
      continue;
    }

    if (subtotalCents < promo.conditions.minSubtotalCents) {
      continue;
    }

    const hasExcluded = promo.conditions.excludedCategoryIds.some((catId: string) => cartCategoryIds.has(catId));
    if (hasExcluded) {
      continue;
    }

    if (promo.conditions.requiredCategoryIds.length > 0) {
      const hasRequired = promo.conditions.requiredCategoryIds.some((catId: string) => cartCategoryIds.has(catId));
      if (!hasRequired) {
        continue;
      }
    }

    let discountCents = 0;
    if (promo.type === "percentage_discount") {
      discountCents = Math.floor(subtotalCents * (promo.value / 100));
    } else if (promo.type === "fixed_discount") {
      discountCents = promo.value;
    } else if (promo.type === "free_shipping") {
      discountCents = 0; 
    } else if (promo.type === "bogo") {
      discountCents = Math.floor(subtotalCents * (promo.value / 100)); 
    }

    discountCents = Math.min(discountCents, subtotalCents);

    applicablePromotions.push({
      promotionId: promoDoc.id,
      name: promo.name,
      type: promo.type,
      discountCents,
    });

    if (discountCents > maxDiscountCents) {
      maxDiscountCents = discountCents;
      bestPromotion = {
        promotionId: promoDoc.id,
        name: promo.name,
        discountCents,
      };
    }
  }

  return {
    applicablePromotions,
    bestPromotion,
    maxDiscountCents,
  };
});