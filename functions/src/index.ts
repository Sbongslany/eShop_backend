import {setAdminRole} from "./auth/setRole";
import {onProductStockUpdate, onOrderStatusUpdate} from "./triggers/notifications";
import {getFilteredOrders, getFilteredProducts, saveView, getSavedViews} from "./queries/catalog";

// Export all Cloud Functions here
export {
  setAdminRole,
  onProductStockUpdate,
  onOrderStatusUpdate,
  getFilteredOrders,
  getFilteredProducts,
  saveView,
  getSavedViews,
};
