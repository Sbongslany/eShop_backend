import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { logAudit } from "../utils/audit";

const verifyAdmin = async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  
  const uid = request.auth.uid;
  const email = request.auth.token.email || "";
  const claimRole = request.auth.token.role as string;

  if (claimRole === "super_admin" || claimRole === "admin" || claimRole === "support") {
    return { uid, email, role: claimRole };
  }

  const customerDoc = await db.collection("customers").doc(uid).get();
  if (customerDoc.exists) {
    const data = customerDoc.data();
    if (data?.role === "super_admin" || data?.role === "admin" || data?.role === "support") {
      return { uid, email, role: data.role };
    }
  }

  throw new HttpsError("permission-denied", "Admin access required.");
};

const convertToCSV = (data: any[], headers: string[]): string => {
  const headerRow = headers.join(",");
  const rows = data.map((row) => {
    return headers
      .map((header) => {
        const val = row[header] !== undefined ? row[header] : "";
        const escaped = String(val).replace(/"/g, '""');
        return `"${escaped}"`;
      })
      .join(",");
  });
  return [headerRow, ...rows].join("\n");
};

export const generateReport = onCall(async (request: CallableRequest) => {
  const adminUser = await verifyAdmin(request);
  const { reportType, startDate, endDate } = request.data;

  if (!reportType || !startDate || !endDate) {
    throw new HttpsError("invalid-argument", "reportType, startDate, and endDate are required.");
  }

  const reportId = db.collection("report_requests").doc().id;
  const startTs = Timestamp.fromDate(new Date(startDate));
  const endTs = Timestamp.fromDate(new Date(endDate));

  await db.collection("report_requests").doc(reportId).set({
    id: reportId,
    requestedByUid: adminUser.uid,
    requestedByEmail: adminUser.email,
    reportType,
    startDate: startTs,
    endDate: endTs,
    status: "processing",
    createdAt: Timestamp.now(),
  });

  try {
    let csvData: any[] = [];
    let headers: string[] = [];

    if (reportType === "sales_daily") {
      headers = ["date", "totalOrders", "totalRevenueCents", "netRevenueCents"];
      const snapshot = await db.collection("daily_sales_summary")
        .where("date", ">=", startTs)
        .where("date", "<=", endTs)
        .orderBy("date", "asc")
        .get();
      
      csvData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          date: data.date ? data.date.toDate().toISOString().split("T")[0] : "Unknown",
          totalOrders: data.totalOrders || 0,
          totalRevenueCents: (data.totalRevenueCents || 0) / 100,
          netRevenueCents: (data.netRevenueCents || 0) / 100,
        };
      });
    } 
    else if (reportType === "best_sellers") {
      headers = ["productName", "totalUnitsSold", "totalRevenueCents"];
      const snapshot = await db.collection("product_sales_metrics")
        .orderBy("totalUnitsSold", "desc")
        .limit(100)
        .get();
      
      csvData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          productName: data.productName || "Unknown",
          totalUnitsSold: data.totalUnitsSold || 0,
          totalRevenueCents: (data.totalRevenueCents || 0) / 100,
        };
      });
    }
    else if (reportType === "customer_ltv") {
      headers = ["customerEmail", "totalOrders", "totalSpentCents", "segment"];
      const snapshot = await db.collection("customer_metrics")
        .orderBy("totalSpentCents", "desc")
        .limit(500)
        .get();
      
      csvData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          customerEmail: data.customerEmail || "Guest",
          totalOrders: data.totalOrders || 0,
          totalSpentCents: (data.totalSpentCents || 0) / 100,
          segment: data.segment || "new",
        };
      });
    } else {
      throw new HttpsError("invalid-argument", "Unsupported report type.");
    }

    const csvString = convertToCSV(csvData, headers);
    const fileName = `${reportType}_${startDate}_to_${endDate}.csv`;
    const filePath = `reports/${reportId}/${fileName}`;

    const bucket = admin.storage().bucket();
    const file = bucket.file(filePath);
    
    await file.save(csvString, { metadata: { contentType: "text/csv" } });

    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    await db.collection("report_requests").doc(reportId).update({
      status: "completed",
      downloadUrl: url,
      filePath: filePath,
      completedAt: Timestamp.now(),
    });

    return { success: true, reportId, downloadUrl: url };

  } catch (error: any) {
    console.error("🔥 REPORT GENERATION FAILED:", error);
    
    await db.collection("report_requests").doc(reportId).update({
      status: "failed",
      errorMessage: error.message || "Unknown error",
      completedAt: Timestamp.now(),
    });

    // THIS IS THE CRUCIAL FIX: It now tells you EXACTLY why it failed
    throw new HttpsError("internal", `Failed to generate report: ${error.message}`);
  }
});

export const getReportStatus = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  const { reportId } = request.data;
  if (!reportId) throw new HttpsError("invalid-argument", "reportId is required.");

  const doc = await db.collection("report_requests").doc(reportId).get();
  if (!doc.exists) throw new HttpsError("not-found", "Report request not found.");

  return { report: { id: doc.id, ...doc.data() } };
});

export const getAllReports = onCall(async (request: CallableRequest) => {
  await verifyAdmin(request);
  try {
    const snapshot = await db.collection("report_requests").orderBy("createdAt", "desc").limit(50).get();
    const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return { success: true, reports };
  } catch (error: any) {
    console.error("Error fetching reports:", error);
    throw new HttpsError("internal", "Failed to fetch reports.");
  }
});

export const deleteReport = onCall(async (request: CallableRequest) => {
  const adminUser = await verifyAdmin(request);
  const { reportId } = request.data;
  if (!reportId) throw new HttpsError("invalid-argument", "reportId is required.");

  const docRef = db.collection("report_requests").doc(reportId);
  const doc = await docRef.get();
  if (!doc.exists) throw new HttpsError("not-found", "Report not found.");

  const reportData = doc.data();
  if (reportData?.filePath) {
    try {
      const bucket = admin.storage().bucket();
      await bucket.file(reportData.filePath).delete();
    } catch (err) {
      console.warn("Could not delete file from storage:", err);
    }
  }

  await docRef.delete();
  await logAudit(adminUser.uid, adminUser.email, "DELETE", "report_requests", reportId, reportData, null);
  return { success: true, message: "Report deleted." };
});