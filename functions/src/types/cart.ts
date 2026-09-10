import { Timestamp } from "firebase-admin/firestore";

// ==========================================
// CART & CHECKOUT MODELS
// ==========================================

export interface CartItem {
  productId: string;
  variantId?: string; // Optional, if product has variants
  warehouseId: string; // Needed for stock reservation
categoryId: string; // <-- ADD THIS LINE
  name: string; // Denormalized for quick cart rendering
  priceCents: number; // Price at the time of adding to cart
  quantity: number;
}

export interface Cart {
  id: string; // For guests: sessionId. For users: customerId
  customerId?: string; // Null if guest
  sessionId?: string; // For guest cart tracking
  items: CartItem[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  appliedPromoCode?: string; // The code string (e.g., "SUMMER20")
  updatedAt: Timestamp;
}

export interface PromoCode {
  id: string;
  code: string; // e.g., "WELCOME10" (stored uppercase)
  type: "percentage" | "fixed" | "free_shipping";
  value: number; // e.g., 10 (for 10%) or 1000 (for $10.00)
  minPurchaseCents: number; // Minimum cart subtotal to apply
  maxDiscountCents?: number; // Cap on percentage discounts
  isActive: boolean;
  expiresAt?: Timestamp;
  usageLimit?: number; // Max times this code can be used globally
  usageCount: number; // Current usage count
  createdAt: Timestamp;
}

// ==========================================
// EXPANDED ORDER MODEL (From Phase 2)
// ==========================================

export interface OrderAddress {
  firstName: string;
  lastName: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
}

export interface OrderLineItem {
  productId: string;
  variantId?: string;
  name: string;
  priceCents: number;
  quantity: number;
  warehouseId: string;
}

export interface Order {
  id: string;
  orderNumber: string; // Human-readable, e.g., "ORD-2026-001"
  customerId?: string;
  customerEmail: string;
  isGuest: boolean;
  
  items: OrderLineItem[];
  
  // Financials
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  currency: string; // e.g., "USD"
  
  // Status & Payment
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled" | "refunded" | "flagged";
  paymentStatus: "unpaid" | "pending" | "paid" | "failed";
  paymentIntentId?: string; // Stripe Payment Intent ID
  
  // Shipping & Billing
  shippingAddress: OrderAddress;
  billingAddress: OrderAddress;
  
  // Metadata
  flaggedReason?: string;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}