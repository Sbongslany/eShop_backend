import { Timestamp } from "firebase-admin/firestore";

export interface Customer {
  id: string;
  uid: string; // Firebase Auth UID
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  createdAt: Timestamp;
  lastLogin: Timestamp;
  isGuest: boolean;
}

export interface Address {
  id: string;
  customerId: string;
  type: "shipping" | "billing";
  firstName: string;
  lastName: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault: boolean;
  createdAt: Timestamp;
}

export interface WishlistItem {
  id: string;
  customerId: string;
  productId: string;
  addedAt: Timestamp;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  targetCollection: string;
  targetDocId: string;
  previousData?: any;
  newData?: any;
  timestamp: Timestamp;
}