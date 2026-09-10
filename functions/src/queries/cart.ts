import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";

// Helper to get cart ID (customerId for logged in, sessionId for guest)
const getCartId = (request: CallableRequest, sessionId?: string): string => {
  if (request.auth) return request.auth.uid;
  if (sessionId) return `guest_${sessionId}`;
  throw new HttpsError("unauthenticated", "Must be logged in or provide a sessionId.");
};

// ==========================================
// 1. CART MANAGEMENT
// ==========================================

export const getCart = onCall(async (request: CallableRequest) => {
  const { sessionId } = request.data;
  const cartId = getCartId(request, sessionId);

  const doc = await db.collection("carts").doc(cartId).get();
  
  if (!doc.exists) {
    return { 
      cart: { 
        id: cartId, 
        items: [], 
        subtotalCents: 0, 
        discountCents: 0, 
        totalCents: 0 
      } 
    };
  }

  return { cart: { id: doc.id, ...doc.data() } };
});

export const addToCart = onCall(async (request: CallableRequest) => {
  const { sessionId, productId, variantId, warehouseId, name, priceCents, quantity } = request.data;
  const cartId = getCartId(request, sessionId);

  if (!productId || !warehouseId || !name || priceCents === undefined || quantity <= 0) {
    throw new HttpsError("invalid-argument", "Missing required item fields or invalid quantity.");
  }

  const cartRef = db.collection("carts").doc(cartId);

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(cartRef);
    const cartData = doc.exists ? (doc.data() as any) : { items: [], subtotalCents: 0, discountCents: 0, totalCents: 0 };

    // Check if item already exists in cart
    const existingIndex = cartData.items.findIndex(
      (item: any) => item.productId === productId && item.variantId === (variantId || null)
    );

    let newItems = [...cartData.items];
    if (existingIndex >= 0) {
      newItems[existingIndex].quantity += quantity;
    } else {
      newItems.push({ productId, variantId: variantId || null, warehouseId, name, priceCents, quantity });
    }

    // Recalculate subtotal
    const subtotalCents = newItems.reduce((sum: number, item: any) => sum + (item.priceCents * item.quantity), 0);
    
    // Note: Discount recalculates in applyPromoCode, but we reset it here if cart changes significantly, 
    // or we can just keep the existing discountCents. Let's keep it simple and recalculate total.
    const totalCents = subtotalCents - (cartData.discountCents || 0);

    transaction.set(cartRef, {
      customerId: request.auth?.uid || null,
      sessionId: sessionId || null,
      items: newItems,
      subtotalCents,
      discountCents: cartData.discountCents || 0,
      totalCents: Math.max(0, totalCents),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });

  return { success: true, message: "Item added to cart." };
});

export const updateCartItemQuantity = onCall(async (request: CallableRequest) => {
  const { sessionId, productId, variantId, quantity } = request.data;
  const cartId = getCartId(request, sessionId);

  if (quantity < 0) {
    throw new HttpsError("invalid-argument", "Quantity cannot be negative.");
  }

  const cartRef = db.collection("carts").doc(cartId);

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(cartRef);
    if (!doc.exists) throw new HttpsError("not-found", "Cart not found.");

    const cartData = doc.data() as any;
    const itemIndex = cartData.items.findIndex(
      (item: any) => item.productId === productId && item.variantId === (variantId || null)
    );

    if (itemIndex < 0) throw new HttpsError("not-found", "Item not in cart.");

    if (quantity === 0) {
      cartData.items.splice(itemIndex, 1);
    } else {
      cartData.items[itemIndex].quantity = quantity;
    }

    const subtotalCents = cartData.items.reduce((sum: number, item: any) => sum + (item.priceCents * item.quantity), 0);
    const totalCents = Math.max(0, subtotalCents - (cartData.discountCents || 0));

    transaction.update(cartRef, {
      items: cartData.items,
      subtotalCents,
      totalCents,
      updatedAt: Timestamp.now(),
    });
  });

  return { success: true, message: "Cart updated." };
});

export const clearCart = onCall(async (request: CallableRequest) => {
  const { sessionId } = request.data;
  const cartId = getCartId(request, sessionId);

  await db.collection("carts").doc(cartId).set({
    items: [],
    subtotalCents: 0,
    discountCents: 0,
    totalCents: 0,
    appliedPromoCode: null,
    updatedAt: Timestamp.now(),
  }, { merge: true });

  return { success: true, message: "Cart cleared." };
});

// ==========================================
// 2. PROMO CODE VALIDATION & APPLICATION
// ==========================================

export const applyPromoCode = onCall(async (request: CallableRequest) => {
  const { sessionId, promoCodeString } = request.data;
  const cartId = getCartId(request, sessionId);

  if (!promoCodeString) {
    throw new HttpsError("invalid-argument", "Promo code is required.");
  }

  const codeUpper = promoCodeString.trim().toUpperCase();

  // 1. Fetch the promo code
  const promoQuery = await db.collection("promo_codes").where("code", "==", codeUpper).limit(1).get();
  
  if (promoQuery.empty) {
    throw new HttpsError("not-found", "Invalid promo code.");
  }

  const promoDoc = promoQuery.docs[0];
  const promoData = promoDoc.data() as any;

  // 2. Validate Promo Code
  if (!promoData.isActive) {
    throw new HttpsError("failed-precondition", "This promo code is no longer active.");
  }
  if (promoData.expiresAt && promoData.expiresAt.toMillis() < Date.now()) {
    throw new HttpsError("failed-precondition", "This promo code has expired.");
  }
  if (promoData.usageLimit && promoData.usageCount >= promoData.usageLimit) {
    throw new HttpsError("failed-precondition", "This promo code has reached its usage limit.");
  }

  // 3. Fetch Cart to check min purchase
  const cartDoc = await db.collection("carts").doc(cartId).get();
  if (!cartDoc.exists) {
    throw new HttpsError("not-found", "Cart not found.");
  }
  const cartData = cartDoc.data() as any;

  if (cartData.subtotalCents < promoData.minPurchaseCents) {
    throw new HttpsError(
      "failed-precondition", 
      `Minimum purchase of $${(promoData.minPurchaseCents / 100).toFixed(2)} required.`
    );
  }

  // 4. Calculate Discount
  let discountCents = 0;
  if (promoData.type === "percentage") {
    discountCents = Math.floor(cartData.subtotalCents * (promoData.value / 100));
    if (promoData.maxDiscountCents && discountCents > promoData.maxDiscountCents) {
      discountCents = promoData.maxDiscountCents;
    }
  } else if (promoData.type === "fixed") {
    discountCents = promoData.value;
  } else if (promoData.type === "free_shipping") {
    // Handled at checkout shipping calculation, but we can set a flag or 0 discount here
    discountCents = 0; 
  }

  discountCents = Math.min(discountCents, cartData.subtotalCents); // Cannot exceed subtotal

  // 5. Update Cart and Increment Promo Usage (Atomically)
  await db.runTransaction(async (transaction) => {
    transaction.update(db.collection("carts").doc(cartId), {
      appliedPromoCode: codeUpper,
      discountCents: discountCents,
      totalCents: cartData.subtotalCents - discountCents,
      updatedAt: Timestamp.now(),
    });

    // Increment usage count
    transaction.update(promoDoc.ref, {
      usageCount: (promoData.usageCount || 0) + 1,
    });
  });

  return { 
    success: true, 
    message: "Promo code applied.", 
    discountCents,
    totalCents: cartData.subtotalCents - discountCents 
  };
});

export const removePromoCode = onCall(async (request: CallableRequest) => {
  const { sessionId } = request.data;
  const cartId = getCartId(request, sessionId);

  const cartRef = db.collection("carts").doc(cartId);
  const cartDoc = await cartRef.get();

  if (!cartDoc.exists) {
    throw new HttpsError("not-found", "Cart not found.");
  }

  const cartData = cartDoc.data() as any;
  const promoCode = cartData.appliedPromoCode;

  if (promoCode) {
    // Decrement usage count
    const promoQuery = await db.collection("promo_codes").where("code", "==", promoCode).limit(1).get();
    if (!promoQuery.empty) {
      const promoDoc = promoQuery.docs[0];
      const promoData = promoDoc.data() as any;
      
      await db.collection("promo_codes").doc(promoDoc.id).update({
        usageCount: Math.max(0, (promoData.usageCount || 1) - 1),
      });
    }
  }

  await cartRef.update({
    appliedPromoCode: null,
    discountCents: 0,
    totalCents: cartData.subtotalCents,
    updatedAt: Timestamp.now(),
  });

  return { success: true, message: "Promo code removed." };
});