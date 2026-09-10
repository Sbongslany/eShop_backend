import { Timestamp } from "firebase-admin/firestore";

// ==========================================
// 1. SALES DASHBOARD AGGREGATES
// ==========================================

// Document ID format: "YYYY-MM-DD" (e.g., "2026-09-10")
export interface DailySalesSummary {
  id: string; // The date string
  date: Timestamp;
  
  totalOrders: number;
  totalRevenueCents: number; // Gross revenue
  totalDiscountCents: number;
  netRevenueCents: number; // totalRevenueCents - totalDiscountCents
  
  newCustomersCount: number; // First-time buyers today
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ==========================================
// 2. BEST-SELLERS & PRODUCT METRICS
// ==========================================

// Document ID: productId
export interface ProductSalesMetrics {
  id: string; // productId
  productName: string; // Denormalized for easy dashboard display
  categoryId: string;
  
  totalUnitsSold: number;
  totalRevenueCents: number;
  
  // For "Trending" calculations (e.g., sales in the last 7 days)
  // In a full enterprise system, this would be a map of daily counts, 
  // but for this phase, a rolling 7-day counter is highly effective.
  unitsSoldLast7Days: number;
  revenueLast7DaysCents: number;
  
  lastSoldAt?: Timestamp;
  updatedAt: Timestamp;
}

// ==========================================
// 3. CUSTOMER LIFETIME VALUE (LTV)
// ==========================================

// Document ID: customerId
export interface CustomerMetrics {
  id: string; // customerId
  customerEmail: string;
  
  totalOrders: number;
  totalSpentCents: number; // This is the LTV
  averageOrderValueCents: number;
  
  firstOrderDate?: Timestamp;
  lastOrderDate?: Timestamp;
  
  // Segmentation based on spending (updated via Cloud Function)
  segment: "new" | "retail" | "vip" | "wholesale"; 
  
  updatedAt: Timestamp;
}

// ==========================================
// 4. EXPORTABLE REPORT CONFIGURATION
// ==========================================

export type ReportType = "sales_daily" | "sales_monthly" | "best_sellers" | "abandoned_carts" | "customer_ltv";

export interface ReportRequest {
  id: string;
  requestedByUid: string;
  requestedByEmail: string;
  reportType: ReportType;
  startDate: Timestamp;
  endDate: Timestamp;
  
  status: "pending" | "processing" | "completed" | "failed";
  downloadUrl?: string; // Firebase Storage URL to the generated CSV
  errorMessage?: string;
  
  createdAt: Timestamp;
  completedAt?: Timestamp;
}

// ==========================================
// 5. ORDER RISK & FRAUD SCORING
// ==========================================

export type RiskFlag = 
  | "high_value"               // Order total exceeds a certain threshold
  | "velocity"                 // Multiple orders from same user/IP in short time
  | "mismatched_address"       // Billing and shipping addresses are completely different
  | "new_account_high_value"   // Account created < 24 hours ago making a large purchase
  | "international_shipping";  // Shipping to a country different from billing or store base

export interface OrderRisk {
  score: number; // 0 to 100 (e.g., > 70 is high risk)
  flags: RiskFlag[];
  reviewedBy?: string; // Admin UID who reviewed it
  reviewedAt?: Timestamp;
  decision?: "approved" | "cancelled" | "manual_review";
}

// ==========================================
// 6. BULK OPERATIONS (CSV Import/Export)
// ==========================================

export type BulkOperationType = 
  | "import_products" 
  | "import_inventory" 
  | "export_orders";

export type BulkOperationStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface BulkOperation {
  id: string;
  type: BulkOperationType;
  initiatedByUid: string;
  initiatedByEmail: string;
  
  // For imports: URL of the uploaded CSV in Firebase Storage
  // For exports: URL of the generated CSV in Firebase Storage
  fileUrl?: string; 
  
  status: BulkOperationStatus;
  
  // Progress tracking
  totalRecords: number;
  processedRecords: number;
  successCount: number;
  errorCount: number;
  errorMessage?: string; // High-level error if the whole job fails
  
  createdAt: Timestamp;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
}