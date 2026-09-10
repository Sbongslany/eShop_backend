import { Timestamp } from "firebase-admin/firestore";

export type PromotionType = 
  | "percentage_discount" 
  | "fixed_discount" 
  | "bogo" // Buy One Get One
  | "free_shipping";

export type CustomerSegment = "all" | "new" | "vip" | "wholesale";

export interface PromotionCondition {
  minSubtotalCents: number; // e.g., 5000 for $50.00
  requiredCategoryIds: string[]; // Cart must contain at least one of these
  excludedCategoryIds: string[]; // Cart cannot contain these
  targetCustomerSegments: CustomerSegment[]; // Who is eligible? ["all", "vip"]
  maxUsesPerCustomer: number; // 0 = unlimited
}

export interface PromotionSchedule {
  isActive: boolean; // Master toggle
  startDate: Timestamp; // When it becomes valid
  endDate: Timestamp; // When it expires
}

export interface Promotion {
  id: string;
  name: string; // Internal admin name, e.g., "Black Friday Electronics"
  description: string; // Customer-facing description
  
  type: PromotionType;
  value: number; // e.g., 20 (for 20%), or 1000 (for $10.00)
  
  conditions: PromotionCondition;
  schedule: PromotionSchedule;
  
  // Tracking
  totalUsageCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AppliedPromotion {
  promotionId: string;
  name: string;
  discountCents: number;
  appliedToItems: string[]; // Array of productIds that got the discount
}