import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";
import { logAudit } from "../utils/audit";

// Helper to generate a human-readable order number
const generateOrderNumber = (): string => {
  const year = new Date().getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000); // 4-digit random
  return `ORD-${year}-${random}`;
};

export const createOrder = onCall(async (request: CallableRequest) => {
  // Allow guests if they provide an email, otherwise require auth
  const isGuest = !request.auth;
  const customerId = request.auth?.uid || null;
  const customerEmail = request.data.customerEmail || (request.auth?.token?.email as string);

  if (!customerEmail) {
    throw new HttpsError("invalid-argument", "Customer email is required.");
  }

  const { sessionId, shippingAddress, billingAddress, notes } = request.data;
  const cartId = isGuest ? `guest_${sessionId}` : customerId!;

  if (!shippingAddress || !billingAddress) {
    throw new HttpsError("invalid-argument", "Shipping and billing addresses are required.");
  }

  const cartRef = db.collection("carts").doc(cartId);
  const orderRef = db.collection("orders").doc(); // Auto-generate ID
  const orderNumber = generateOrderNumber();

  try {
    await db.runTransaction(async (transaction) => {
      // 1. Fetch the cart
      const cartDoc = await transaction.get(cartRef);
      if (!cartDoc.exists || !cartDoc.data()?.items || cartDoc.data()!.items.length === 0) {
        throw new HttpsError("failed-precondition", "Cart is empty or does not exist.");
      }

      const cartData = cartDoc.data() as any;

      // 2. Prepare Order Data
      const orderData = {
        orderNumber: orderNumber,
        customerId: customerId,
        customerEmail: customerEmail,
        isGuest: isGuest,
        items: cartData.items,
        subtotalCents: cartData.subtotalCents,
        discountCents: cartData.discountCents || 0,
        taxCents: 0, // TODO: Integrate tax calculation service (e.g., Stripe Tax)
        shippingCents: 0, // TODO: Integrate shipping calculation service
        totalCents: cartData.totalCents,
        currency: "USD",
        status: "pending",
        paymentStatus: "unpaid",
        shippingAddress: shippingAddress,
        billingAddress: billingAddress,
        notes: notes || "",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      // 3. Create the Order
      transaction.set(orderRef, orderData);

      // 4. Clear the Cart (so they don't accidentally checkout twice)
      transaction.update(cartRef, {
        items: [],
        subtotalCents: 0,
        discountCents: 0,
        totalCents: 0,
        appliedPromoCode: null,
        updatedAt: Timestamp.now(),
      });
    });

    // 5. Log the audit (if authenticated)
    if (customerId) {
      await logAudit(
        customerId,
        customerEmail,
        "CREATE",
        "orders",
        orderRef.id,
        null,
        { action: "Order created from cart", orderNumber }
      );
    }

    return { 
      success: true, 
      orderId: orderRef.id, 
      orderNumber: orderNumber,
      totalCents: 0 // Will be populated by transaction, but we return the ID for Stripe
    };

  } catch (error: any) {
    if (error instanceof HttpsError) {
      throw error;
    }
    console.error("Order creation failed:", error);
    throw new HttpsError("internal", "Failed to create order. Please try again.");
  }
});