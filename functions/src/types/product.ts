// functions/src/types/product.ts
export interface Product {
  id: string;
  name: string;
  sku: string; // Stock Keeping Unit (unique)

  currentStock: number;
  lowStockThreshold: number; // e.g., 5. Triggers alert when currentStock <= 5

  price: number; // In cents
  category: string; // Denormalized category name for easy filtering

  isActive: boolean; // Soft delete / hide from storefront

  updatedAt: any; // Firestore Timestamp
}
