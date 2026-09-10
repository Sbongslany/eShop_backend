// functions/src/types/order.ts
export interface Order {
  id: string;
  customerEmail: string;
  status: "pending" | "processing" | "shipped" | "delivered" | "flagged" | "refunded";
  flaggedReason?: string; // e.g., "Billing/Shipping mismatch"

  totalAmount: number; // Stored in cents to avoid float issues (e.g., 5000 = $50.00)
  currency: string; // e.g., 'USD'

  // Denormalized data for quick admin viewing without joining collections
  customerName: string;

  createdAt: any; // Firestore Timestamp (Crucial for sorting)
  updatedAt: any; // Firestore Timestamp (Crucial for concurrency checks)
}
