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
  registerCustomer,
  updateLastLogin,
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
import {
  createProduct,
  updateProduct,
  archiveProduct,
  createCategory,
  updateCategory,
  deleteCategory,
} from "./queries/products";

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
  // Customer Auth
  registerCustomer,
  updateLastLogin,
  // Customer Management
  updateCustomerProfile,
  addAddress,
  deleteAddress,
  getAddresses,
  addToWishlist,
  removeFromWishlist,
  getWishlist,
  getAllCustomers,
  // Product & Category Management
  createProduct,
  updateProduct,
  archiveProduct,
  createCategory,
  updateCategory,
  deleteCategory,
};