import { Timestamp } from "firebase-admin/firestore";

export interface Warehouse {
  id: string;
  name: string; // e.g., "Main Warehouse", "New York Store"
  code: string; // e.g., "WH-01", "NYC-01"
  address: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  isActive: boolean;
  createdAt: Timestamp;
}

export interface InventoryRecord {
  id: string; // Auto-generated
  productId: string;
  warehouseId: string;
  quantityOnHand: number; // Actual physical stock
  quantityReserved: number; // Stock currently held in active checkouts
  quantityAvailable: number; // quantityOnHand - quantityReserved (calculated or stored)
  lowStockThreshold: number; // Warehouse-specific threshold
  allowBackorder: boolean; // Can customers buy if quantityAvailable <= 0?
  updatedAt: Timestamp;
}

export interface StockReservation {
  id: string; // Auto-generated
  customerId?: string; // Null if guest
  sessionId: string; // Cart session ID or Checkout session ID
  productId: string;
  warehouseId: string;
  quantity: number;
  status: "pending" | "confirmed" | "released";
  expiresAt: Timestamp; // Auto-release if checkout isn't completed (e.g., 15 mins)
  createdAt: Timestamp;
}