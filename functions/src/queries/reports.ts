import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin"; // For Storage access

// Helper to check admin role
const verifyAdmin = (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const role = request.auth.token.role;
  if (role !== "super_admin" && role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return { uid: request.auth.uid, email: request.auth.token.email || "" };
};

// Helper to convert data to CSV string
const convertToCSV = (data: any[], headers: string[]): string => {
  const headerRow = headers.join(",");
  const rows = data.map((row) => {
    return headers
      .map((header) => {
        const val = row[header] !== undefined ? row[header] : "";
        // Escape commas and quotes in CSV values
        const escaped = String(val).replace(/"/g, '""');
        return `"${escaped}"`;
      })
      .join(",");
  });
  return [headerRow, ...rows].join("\n");
};

export const generateReport = onCall(async (request: CallableRequest) => {
  const adminUser = verifyAdmin(request);
  const { reportType, startDate, endDate } = request.data;

  if (!reportType || !startDate || !endDate) {
    throw new HttpsError("invalid-argument", "reportType, startDate, and endDate are required.");
  }

  const reportId = db.collection("report_requests").doc().id;
  const startTs = Timestamp.fromDate(new Date(startDate));
  const endTs = Timestamp.fromDate(new Date(endDate));

  // 1. Create Pending Report Request
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

    // 2. Fetch Data Based on Report Type
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
          date: data.date.toDate().toISOString().split("T")[0],
          totalOrders: data.totalOrders || 0,
          totalRevenueCents: (data.totalRevenueCents || 0) / 100, // Convert to dollars
          netRevenueCents: (data.netRevenueCents || 0) / 100,
        };
      });
    } 
    else if (reportType === "best_sellers") {
      headers = ["productName", "totalUnitsSold", "totalRevenueCents"];
      const snapshot = await db.collection("product_sales_metrics")
        .orderBy("totalUnitsSold", "desc")
        .limit(100) // Top 100
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

    // 3. Generate CSV
    const csvString = convertToCSV(csvData, headers);
    const fileName = `${reportType}_${startDate}_to_${endDate}.csv`;
    const filePath = `reports/${reportId}/${fileName}`;

    // 4. Upload to Firebase Storage
    const bucket = admin.storage().bucket();
    const file = bucket.file(filePath);
    
    await file.save(csvString, {
      metadata: { contentType: "text/csv" },
    });

    // 5. Get Signed Download URL (valid for 7 days)
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    // 6. Mark Report as Completed
    await db.collection("report_requests").doc(reportId).update({
      status: "completed",
      downloadUrl: url,
      completedAt: Timestamp.now(),
    });

    return { success: true, reportId, downloadUrl: url };

  } catch (error: any) {
    console.error("Report generation failed:", error);
    
    await db.collection("report_requests").doc(reportId).update({
      status: "failed",
      errorMessage: error.message || "Unknown error",
      completedAt: Timestamp.now(),
    });

    throw new HttpsError("internal", "Failed to generate report.");
  }
});

export const getReportStatus = onCall(async (request: CallableRequest) => {
    verifyAdmin(request);
  const { reportId } = request.data;

  if (!reportId) {
    throw new HttpsError("invalid-argument", "reportId is required.");
  }

  const doc = await db.collection("report_requests").doc(reportId).get();
  if (!doc.exists) {
    throw new HttpsError("not-found", "Report request not found.");
  }

  return { report: { id: doc.id, ...doc.data() } };
});