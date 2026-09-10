// functions/src/types/savedView.ts
export interface SavedView {
  id: string;
  ownerUid: string; // The admin who created it
  name: string; // e.g., "High-Value Pending Orders"
  targetPage: "/orders" | "/products";

  // The exact filter state to reconstruct the query
  filterState: {
    status?: string[]; // e.g., ['pending', 'flagged']
    minTotal?: number;
    maxTotal?: number;
    category?: string;
    // Add other specific filters as needed
  };

  sortState: {
    field: string; // e.g., 'createdAt'
    direction: "asc" | "desc";
  };

  isGlobal: boolean; // If true, all admins can see it. If false, only ownerUid can.
  createdAt: any; // Firestore Timestamp
}
