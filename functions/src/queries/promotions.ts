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

// ==========================================
// 1. ADMIN: CREATE/UPDATE PROMOTIONS
// ==========================================

export const createPromotion = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
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

export const updatePromotion = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
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
// 2. ENGINE: EVALUATE PROMOTIONS FOR A CART
// ==========================================

export const evaluatePromotions = onCall(async (request: CallableRequest) => {
  // Can be called by guest or authenticated user
  const { cartItems, subtotalCents, customerSegment = "retail" } = request.data;

  if (!cartItems || !Array.isArray(cartItems) || subtotalCents === undefined) {
    throw new HttpsError("invalid-argument", "cartItems and subtotalCents are required.");
  }

  const now = Timestamp.now();

  // 1. Fetch all active promotions within the current date range
  const promotionsSnapshot = await db.collection("promotions")
    .where("schedule.isActive", "==", true)
    .where("schedule.startDate", "<=", now)
    .where("schedule.endDate", ">=", now)
    .get();

  const applicablePromotions = [];
  let maxDiscountCents = 0;
  let bestPromotion = null;

  // Extract category IDs from cart items for fast lookup
  const cartCategoryIds = new Set(cartItems.map((item: any) => item.categoryId).filter(Boolean));

  for (const promoDoc of promotionsSnapshot.docs) {
    const promo = promoDoc.data() as any;

    // 2. Check Customer Segment
    if (!promo.conditions.targetCustomerSegments.includes("all") && 
        !promo.conditions.targetCustomerSegments.includes(customerSegment)) {
      continue;
    }

    // 3. Check Min Subtotal
    if (subtotalCents < promo.conditions.minSubtotalCents) {
      continue;
    }

    // 4. Check Excluded Categories
    const hasExcluded = promo.conditions.excludedCategoryIds.some((catId: string) => cartCategoryIds.has(catId));
    if (hasExcluded) {
      continue;
    }

    // 5. Check Required Categories (if any are specified)
    if (promo.conditions.requiredCategoryIds.length > 0) {
      const hasRequired = promo.conditions.requiredCategoryIds.some((catId: string) => cartCategoryIds.has(catId));
      if (!hasRequired) {
        continue;
      }
    }

    // 6. Calculate Discount
    let discountCents = 0;
    if (promo.type === "percentage_discount") {
      discountCents = Math.floor(subtotalCents * (promo.value / 100));
    } else if (promo.type === "fixed_discount") {
      discountCents = promo.value;
    } else if (promo.type === "free_shipping") {
      discountCents = 0; // Handled in shipping calculation
    } else if (promo.type === "bogo") {
      // Simplified BOGO: 50% off the cheapest item (or full price of 1 if value=100)
      // For this phase, we'll treat BOGO as a percentage discount on the subtotal for simplicity, 
      // or you can expand this logic to find the cheapest item.
      discountCents = Math.floor(subtotalCents * (promo.value / 100)); 
    }

    // Cap discount at subtotal
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