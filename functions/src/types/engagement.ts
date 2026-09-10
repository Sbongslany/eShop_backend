import { Timestamp } from "firebase-admin/firestore";

// ==========================================
// 1. REVIEWS & RATINGS
// ==========================================

export interface ReviewImage {
  url: string;
  caption?: string;
}

export interface Review {
  id: string;
  productId: string;
  customerId: string;
  customerName: string; // Denormalized so we don't have to fetch the customer doc
  customerAvatarUrl?: string;
  
  rating: number; // 1 to 5
  
  title: string;
  body: string;
  images: ReviewImage[];
  
  // Trust & Moderation
  isVerifiedPurchase: boolean; // Set to true if backend finds this product in user's delivered orders
  isApproved: boolean; // Admin must approve before it shows on storefront
  isFlagged: boolean; // Auto-flagged for profanity/spam
  
  // Engagement metrics
  helpfulCount: number;
  reportCount: number;
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ==========================================
// 2. QUESTIONS & ANSWERS (Q&A)
// ==========================================

export interface QAAnswer {
  id: string;
  responderId: string; // CustomerId or Admin UID
  responderName: string; // "Admin" or "Jane Doe"
  responderRole: "customer" | "admin" | "support";
  body: string;
  createdAt: Timestamp;
}

export interface ProductQuestion {
  id: string;
  productId: string;
  customerId: string;
  customerName: string;
  
  question: string;
  
  // Can have multiple answers (from admins or other customers)
  answers: QAAnswer[];
  
  isApproved: boolean; // Admin must approve the question
  isFeatured: boolean; // Admin can pin the best questions to the top
  
  createdAt: Timestamp;
}

// ==========================================
// 3. SUPPORT TICKETS
// ==========================================

export type TicketStatus = "open" | "in_progress" | "waiting_on_customer" | "resolved" | "closed";

export interface TicketMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: "customer" | "support" | "admin";
  body: string;
  attachments: string[]; // Array of image/document URLs
  createdAt: Timestamp;
}

export interface SupportTicket {
  id: string;
  ticketNumber: string; // e.g., "TCK-2026-4921"
  
  customerId: string;
  customerEmail: string;
  
  orderId?: string; // Optional link to a specific order
  
  subject: string;
  status: TicketStatus;
  priority: "low" | "medium" | "high" | "urgent";
  
  messages: TicketMessage[];
  
  assignedToAdminUid?: string; // Optional assignment to a specific support agent
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
  resolvedAt?: Timestamp;
}