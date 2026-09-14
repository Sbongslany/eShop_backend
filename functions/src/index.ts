import { setAdminRole } from "./auth/setRole";
import {
  getDashboardStats,
  getDashboardSales,
  getDashboardTopProducts,
  getDashboardRecentOrders,
  getDashboardRiskOrders
} from "./queries/dashboard";

import { getAllCategories, getInventoryList, updateProductStock } from "./queries/products";
import {
  onProductStockUpdate,
  onOrderStatusUpdate,
} from "./triggers/notifications";
import { onOrderCompleted } from "./triggers/analytics";
import { evaluateOrderRisk } from "./triggers/risk";
import { paystackWebhook } from "./triggers/paystack";
import { getOrderDetails } from "./queries/orders";
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

  getCustomerDetails,
  getCustomerOrders,
  getCustomerReturns,
  getCustomerReviews,
  getCustomerTickets,
  getCustomerWishlist,
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
  getAllWarehouses,      // <-- ADD
  getWarehouseDetails,   // <-- ADD
  getLowStockAlerts,     // <-- ADD\
  backfillInventoryRecords,
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
  getAllReturns,      // <-- ADD
  getReturnDetails,   // <-- ADD
} from "./queries/returns";
import {
  createPromotion,
  updatePromotion,
  evaluatePromotions,
  getAllPromotions,
  deletePromotion

} from "./queries/promotions";
import {
  submitReview,
  moderateReview,
  updateReviewMetrics,
  submitQuestion,
  submitAnswer,
  moderateQuestion,
  createSupportTicket,
  addTicketMessage,
  updateTicketStatus,
  getAllReviews,
  getAllSupportTickets,
} from "./queries/engagement";
import {
  createBanner,
  updateBanner,
  deleteBanner,
  updateSiteSettings,
  createCollection,
  updateCollection,
  deleteCollection,
} from "./queries/content";
import {
  generateReport,
  getReportStatus,
} from "./queries/reports";
import {
  initiateBulkOperation,
  getBulkOperations,
  updateBulkOperationStatus,
} from "./queries/operations";
import { initializePayment } from "./queries/payments";
import {
  getHomePageData,
  getProductDetails,
} from "./queries/storefront";

// Export all Cloud Functions
export {
  // Admin RBAC
  setAdminRole,
  // Product & Order Triggers
  onProductStockUpdate,
  onOrderStatusUpdate,
  // Analytics & Risk Triggers
  onOrderCompleted,
  evaluateOrderRisk,
  // Paystack Webhook
  paystackWebhook,
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

  getCustomerDetails,
  getCustomerOrders,
  getCustomerReturns,
  getCustomerReviews,
  getCustomerTickets,
  getCustomerWishlist,
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
  getAllWarehouses,      // <-- ADD
  getWarehouseDetails,   // <-- ADD
  getLowStockAlerts,     // <-- ADD
  backfillInventoryRecords,
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
  getAllReturns,      // <-- ADD
  getReturnDetails,   // <-- ADD
  // Advanced Promotions
  createPromotion,
  updatePromotion,
  evaluatePromotions,
  // Customer Engagement
  submitReview,
  moderateReview,
  updateReviewMetrics,
  submitQuestion,
  submitAnswer,
  moderateQuestion,
  createSupportTicket,
  addTicketMessage,
  updateTicketStatus,
  getAllReviews,
  getAllSupportTickets,
  // Content & Merchandising
  createBanner,
  updateBanner,
  deleteBanner,
  updateSiteSettings,
  createCollection,
  updateCollection,
  deleteCollection,
  // Reporting & Analytics
  generateReport,
  getReportStatus,
  // Risk & Bulk Operations
  initiateBulkOperation,
  getBulkOperations,
  updateBulkOperationStatus,
  // Payments
  initializePayment,
  // Storefront Optimization
  getHomePageData,
  getProductDetails,

  getDashboardStats,
  getDashboardSales,
  getDashboardTopProducts,
  getDashboardRecentOrders,
  getDashboardRiskOrders,
  getAllCategories,
  getOrderDetails,

  getInventoryList, 
  updateProductStock,


  getAllPromotions,
  deletePromotion
};

