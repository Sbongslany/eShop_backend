import { Timestamp } from "firebase-admin/firestore";

// Individual items being returned from a specific order
export interface ReturnItem {
  productId: string;
  variantId?: string;
  name: string; // Denormalized from order
  quantity: number;
  reason: string; // e.g., "Defective", "Wrong size", "Changed mind"
  condition?: "new" | "used" | "damaged" | "missing_parts"; // Filled by admin/warehouse upon receipt
}

export type ReturnStatus = 
  | "requested"    // Customer just submitted the request
  | "approved"     // Admin approved, waiting for customer to ship
  | "rejected"     // Admin denied the request
  | "received"     // Warehouse received the package, pending inspection
  | "refunded"     // Inspection passed, refund issued
  | "closed";      // Completed or cancelled

export interface ReturnRequest {
  id: string; // Firestore document ID
  rmaNumber: string; // Human-readable tracking number (e.g., "RMA-2026-9021")
  
  // Links
  orderId: string;
  customerId: string;
  
  // What is being returned
  items: ReturnItem[];
  
  // Current State
  status: ReturnStatus;
  
  // Financials
  requestedRefundCents: number; // What the customer expects
  restockingFeeCents: number;   // Deductions (e.g., 15% for opened electronics)
  approvedRefundCents: number;  // Final amount to be refunded
  
  // Communication & Logistics
  customerNotes?: string;
  adminNotes?: string;
  returnTrackingNumber?: string; // Tracking number for the return shipment
  returnShippingLabelUrl?: string; // If the store provides a pre-paid label
  
  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
  receivedAt?: Timestamp; // When warehouse scanned it
  resolvedAt?: Timestamp; // When refund was issued
}