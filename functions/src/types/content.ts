import { Timestamp } from "firebase-admin/firestore";

// ==========================================
// 1. HOMEPAGE BANNERS & PROMOS
// ==========================================

export interface Banner {
  id: string;
  title: string; // Internal admin name, e.g., "Summer Sale Hero"
  imageUrl: string; // URL to the hosted image (e.g., Firebase Storage)
  linkUrl?: string; // Where the banner clicks through to (e.g., "/collections/summer")
  altText: string; // Crucial for SEO and accessibility
  
  // Display Logic
  isActive: boolean;
  order: number; // Lower numbers appear first
  startDate?: Timestamp; // Optional: Auto-activate
  endDate?: Timestamp; // Optional: Auto-deactivate
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ==========================================
// 2. SITE SETTINGS & GLOBAL SEO
// ==========================================

export interface SiteSettings {
  id: string; // Typically just "global"
  siteName: string;
  defaultSeoTitle: string; // e.g., "My Store | Premium Electronics"
  defaultSeoDescription: string;
  faviconUrl?: string;
  
  // Social / Open Graph Defaults
  ogImageUrl?: string;
  twitterHandle?: string;
  
  // Contact / Legal
  supportEmail: string;
  footerText?: string;
  
  updatedAt: Timestamp;
}

// ==========================================
// 3. MERCHANDISING COLLECTIONS
// ==========================================

export type CollectionSortOrder = "manual" | "price_asc" | "price_desc" | "newest" | "best_selling";

export interface Collection {
  id: string;
  name: string; // e.g., "Summer Essentials"
  slug: string; // e.g., "summer-essentials" (for URL routing)
  description?: string;
  
  // SEO Overrides for this specific collection page
  seoTitle?: string;
  seoDescription?: string;
  ogImageUrl?: string;
  
  // Merchandising Logic
  productIds: string[]; // Array of product IDs to display. 
                        // If sortOrder is "manual", this array dictates the exact order.
  sortOrder: CollectionSortOrder; 
  
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}