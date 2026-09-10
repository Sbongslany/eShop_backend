import { setAdminRole } from "./auth/setRole";
import {
  onProductStockUpdate,
  onOrderStatusUpdate,
} from "./triggers/notifications";
import {
  getFilteredOrders,
  getFilteredProducts,
  saveView,
  getSavedViews,
} from "./queries/catalog";
import {
  onCustomerCreated,
  onCustomerLogin,
} from "./auth/customerAuth";
import {
  updateCustomerProfile,
  addAddress,
  deleteAddress,
  getAddresses,
  addToWishlist,
  removeFromWishlist,
  getWishlist,
  getAllCustomers,
} from "./queries/customers";

// Export all Cloud Functions
export {
  // Admin RBAC
  setAdminRole,
  // Product & Order Triggers
  onProductStockUpdate,
  onOrderStatusUpdate,
  // Catalog Queries
  getFilteredOrders,
  getFilteredProducts,
  saveView,
  getSavedViews,
  // Customer Auth Triggers
  onCustomerCreated,
  onCustomerLogin,
  // Customer Management
  updateCustomerProfile,
  addAddress,
  deleteAddress,
  getAddresses,
  addToWishlist,
  removeFromWishlist,
  getWishlist,
  getAllCustomers,
};