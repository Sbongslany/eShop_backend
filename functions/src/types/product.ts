import { Timestamp } from "firebase-admin/firestore";

export interface Product {
  id: string;
  name: string;
  slug: string; // URL-friendly name (e.g., "wireless-mouse")
  description: string;
  
  // Pricing & Inventory
  priceCents: number;
  compareAtPriceCents?: number; // For showing "was $X, now $Y"
  currentStock: number;
  lowStockThreshold: number;
  
  // Categorization
  categoryId: string;
  categoryName: string; // Denormalized for easy filtering
  brand?: string;
  
  // Media
  primaryImageUrl: string;
  imageUrls: string[];
  
  // Variants (e.g., Size, Color)
  hasVariants: boolean;
  variants?: ProductVariant[];
  
  // Metadata
  isActive: boolean;
  isFeatured: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProductVariant {
  id: string;
  sku: string;
  name: string; // e.g., "Red / Large"
  attributes: Record<string, string>; // e.g., { color: "Red", size: "Large" }
  priceCents: number; // Can override base price
  currentStock: number;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId?: string; // For nested categories (e.g., Electronics > Laptops)
  imageUrl?: string;
  isActive: boolean;
  createdAt: Timestamp;
}