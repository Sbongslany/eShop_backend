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
import {
  createWarehouse,
  updateInventory,
  reserveStock,
  releaseStock,
  confirmStockDeduction,
} from "./queries/inventory";
import {
  getCart,
  addToCart,
  updateCartItemQuantity,
  clearCart,
  applyPromoCode,
  removePromoCode,
} from "./queries/cart";
import { createOrder } from "./queries/checkout";
import {
  requestReturn,
  updateReturnStatus,
  updateOrderStatus,
} from "./queries/returns";

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
  // Inventory Management
  createWarehouse,
  updateInventory,
  reserveStock,
  releaseStock,
  confirmStockDeduction,
  // Cart & Promo Management
  getCart,
  addToCart,
  updateCartItemQuantity,
  clearCart,
  applyPromoCode,
  removePromoCode,
  // Checkout
  createOrder,
  // Order & Returns Management
  requestReturn,
  updateReturnStatus,
  updateOrderStatus,
};