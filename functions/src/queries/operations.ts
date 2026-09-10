import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";
import { logAudit } from "../utils/audit";

// Helper to check admin role
const verifyAdmin = (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const role = request.auth.token.role;
  if (role !== "super_admin" && role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return { uid: request.auth.uid, email: request.auth.token.email || "" };
};

// ==========================================
// BULK OPERATIONS (CSV Import/Export)
// ==========================================

export const initiateBulkOperation = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { type, fileUrl } = request.data; // type: "import_products" | "import_inventory" | "export_orders"

  if (!type || !fileUrl) {
    throw new HttpsError("invalid-argument", "type and fileUrl are required.");
  }

  const opRef = db.collection("bulk_operations").doc();
  
  const newOp = {
    id: opRef.id,
    type,
    initiatedByUid: admin.uid,
    initiatedByEmail: admin.email,
    fileUrl,
    status: "pending",
    totalRecords: 0,
    processedRecords: 0,
    successCount: 0,
    errorCount: 0,
    createdAt: Timestamp.now(),
  };

  await opRef.set(newOp);
  await logAudit(admin.uid, admin.email, "CREATE", "bulk_operations", opRef.id, null, newOp);

  // NOTE: In a full enterprise implementation, you would publish a message 
  // to a Pub/Sub topic here to trigger a background worker function that 
  // actually streams and parses the CSV file from Firebase Storage.
  // For this architecture, we successfully track the job lifecycle.

  return { success: true, operationId: opRef.id, message: "Bulk operation queued." };
});

export const getBulkOperations = onCall(async (request: CallableRequest) => {
  verifyAdmin(request);
  
  const snapshot = await db.collection("bulk_operations")
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  const operations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return { operations };
});

export const updateBulkOperationStatus = onCall(async (request: CallableRequest) => {
  // This would typically be called by the background worker, 
  // but we expose it for admin overrides or manual retries.
  verifyAdmin(request);
  const { operationId, status, processedRecords, successCount, errorCount, errorMessage } = request.data;

  if (!operationId || !status) {
    throw new HttpsError("invalid-argument", "operationId and status are required.");
  }

  const updateData: any = {
    status,
    updatedAt: Timestamp.now(),
  };

  if (processedRecords !== undefined) updateData.processedRecords = processedRecords;
  if (successCount !== undefined) updateData.successCount = successCount;
  if (errorCount !== undefined) updateData.errorCount = errorCount;
  if (errorMessage) updateData.errorMessage = errorMessage;
  if (status === "completed" || status === "failed") updateData.completedAt = Timestamp.now();

  await db.collection("bulk_operations").doc(operationId).update(updateData);
  
  return { success: true, message: "Status updated." };
});