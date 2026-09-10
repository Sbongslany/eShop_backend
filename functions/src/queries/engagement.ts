import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/admin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { logAudit } from "../utils/audit";

// Helper to check admin role
const verifyAdmin = (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const role = request.auth.token.role;
  if (role !== "super_admin" && role !== "admin" && role !== "support") {
    throw new HttpsError("permission-denied", "Admin/Support access required.");
  }
  return { uid: request.auth.uid, email: request.auth.token.email || "", role };
};

// Helper to generate Ticket Number
const generateTicketNumber = (): string => {
  const year = new Date().getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `TCK-${year}-${random}`;
};

// ==========================================
// 1. REVIEWS & RATINGS
// ==========================================

export const submitReview = onCall(async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in to review.");
  
  const { productId, rating, title, body, images } = request.data;
  const customerId = request.auth.uid;
  const customerName = `${request.auth.token.name || "Anonymous"}`;

  if (!productId || rating < 1 || rating > 5 || !body) {
    throw new HttpsError("invalid-argument", "productId, rating (1-5), and body are required.");
  }

  // 1. Check for Verified Purchase
  const ordersSnapshot = await db.collection("orders")
    .where("customerId", "==", customerId)
    .where("status", "==", "delivered")
    .get();

  let isVerifiedPurchase = false;
  for (const orderDoc of ordersSnapshot.docs) {
    const orderData = orderDoc.data() as any;
    const hasProduct = orderData.items.some((item: any) => item.productId === productId);
    if (hasProduct) {
      isVerifiedPurchase = true;
      break;
    }
  }

  // 2. Create Review
  const reviewRef = db.collection("reviews").doc();
  const newReview = {
    id: reviewRef.id,
    productId,
    customerId,
    customerName,
    customerAvatarUrl: request.auth.token.picture || null,
    rating: Number(rating),
    title: title || "",
    body,
    images: images || [],
    isVerifiedPurchase,
    isApproved: false, // Requires admin moderation
    isFlagged: false,
    helpfulCount: 0,
    reportCount: 0,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  await reviewRef.set(newReview);

  // 3. Notify Admins
  await db.collection("notifications").add({
    type: "new_review",
    severity: "info",
    title: `New Review for Product`,
    message: `${customerName} submitted a ${rating}-star review. Pending approval.`,
    targetEntity: { collection: "reviews", docId: reviewRef.id },
    readBy: [],
    createdAt: Timestamp.now(),
    resolvedAt: null,
  });

  return { success: true, reviewId: reviewRef.id, isVerifiedPurchase };
});

export const moderateReview = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { reviewId, action } = request.data; // action: "approve" | "reject" | "flag"

  if (!reviewId || !["approve", "reject", "flag"].includes(action)) {
    throw new HttpsError("invalid-argument", "reviewId and valid action are required.");
  }

  const reviewRef = db.collection("reviews").doc(reviewId);
  const updateData: any = { updatedAt: Timestamp.now() };

  if (action === "approve") updateData.isApproved = true;
  if (action === "reject") updateData.isApproved = false;
  if (action === "flag") updateData.isFlagged = true;

  await reviewRef.update(updateData);
  await logAudit(admin.uid, admin.email, `REVIEW_${action.toUpperCase()}`, "reviews", reviewId, null, updateData);

  return { success: true, message: `Review ${action}d.` };
});

export const updateReviewMetrics = onCall(async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const { reviewId, action } = request.data; // action: "helpful" | "report"

  if (!reviewId || !["helpful", "report"].includes(action)) {
    throw new HttpsError("invalid-argument", "Invalid action.");
  }

  const reviewRef = db.collection("reviews").doc(reviewId);
  const fieldToUpdate = action === "helpful" ? "helpfulCount" : "reportCount";

  await reviewRef.update({
[fieldToUpdate]: FieldValue.increment(1),
    updatedAt: Timestamp.now(),
  });

  return { success: true };
});

// ==========================================
// 2. QUESTIONS & ANSWERS (Q&A)
// ==========================================

export const submitQuestion = onCall(async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in to ask a question.");
  
  const { productId, question } = request.data;
  if (!productId || !question) {
    throw new HttpsError("invalid-argument", "productId and question are required.");
  }

  const questionRef = db.collection("product_questions").doc();
  await questionRef.set({
    id: questionRef.id,
    productId,
    customerId: request.auth.uid,
    customerName: request.auth.token.name || "Anonymous",
    question,
    answers: [],
    isApproved: false,
    isFeatured: false,
    createdAt: Timestamp.now(),
  });

  return { success: true, questionId: questionRef.id };
});

export const submitAnswer = onCall(async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in to answer.");
  
  const { questionId, body } = request.data;
  if (!questionId || !body) {
    throw new HttpsError("invalid-argument", "questionId and body are required.");
  }

  const role = request.auth.token.role === "admin" || request.auth.token.role === "support" ? "admin" : "customer";
  const responderName = role === "admin" ? "Official Support" : (request.auth.token.name || "Anonymous");

  const newAnswer = {
    id: db.collection("product_questions").doc().id, // Generate a unique ID for the answer
    responderId: request.auth.uid,
    responderName,
    responderRole: role,
    body,
    createdAt: Timestamp.now(),
  };

  const questionRef = db.collection("product_questions").doc(questionId);
  await questionRef.update({
  answers: FieldValue.arrayUnion(newAnswer),
  });

  return { success: true, message: "Answer submitted." };
});

export const moderateQuestion = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { questionId, action } = request.data; // action: "approve" | "feature" | "hide"

  if (!questionId || !["approve", "feature", "hide"].includes(action)) {
    throw new HttpsError("invalid-argument", "Invalid action.");
  }

  const questionRef = db.collection("product_questions").doc(questionId);
  const updateData: any = { isApproved: action !== "hide" };
  if (action === "feature") updateData.isFeatured = true;
  if (action === "approve") updateData.isFeatured = false; // Unfeature if just approving

  await questionRef.update(updateData);
  await logAudit(admin.uid, admin.email, `QUESTION_${action.toUpperCase()}`, "product_questions", questionId, null, updateData);

  return { success: true, message: `Question ${action}d.` };
});

// ==========================================
// 3. SUPPORT TICKETS
// ==========================================

export const createSupportTicket = onCall(async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  
  const { subject, body, orderId, priority = "medium" } = request.data;
  if (!subject || !body) {
    throw new HttpsError("invalid-argument", "subject and body are required.");
  }

  const ticketId = db.collection("support_tickets").doc().id;
  const ticketNumber = generateTicketNumber();
  const customerId = request.auth.uid;
  const customerEmail = request.auth.token.email || "";

  const initialMessage = {
    id: db.collection("support_tickets").doc().id,
    senderId: customerId,
    senderName: request.auth.token.name || "Customer",
    senderRole: "customer",
    body,
    attachments: [],
    createdAt: Timestamp.now(),
  };

  const newTicket = {
    id: ticketId,
    ticketNumber,
    customerId,
    customerEmail,
    orderId: orderId || null,
    subject,
    status: "open",
    priority,
    messages: [initialMessage],
    assignedToAdminUid: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  await db.collection("support_tickets").doc(ticketId).set(newTicket);

  // Notify Support Admins
  await db.collection("notifications").add({
    type: "new_ticket",
    severity: priority === "urgent" || priority === "high" ? "warning" : "info",
    title: `New Support Ticket: ${ticketNumber}`,
    message: subject,
    targetEntity: { collection: "support_tickets", docId: ticketId },
    readBy: [],
    createdAt: Timestamp.now(),
    resolvedAt: null,
  });

  return { success: true, ticketId, ticketNumber };
});

export const addTicketMessage = onCall(async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  
  const { ticketId, body, attachments = [] } = request.data;
  if (!ticketId || !body) {
    throw new HttpsError("invalid-argument", "ticketId and body are required.");
  }

  const ticketRef = db.collection("support_tickets").doc(ticketId);
  const ticketDoc = await ticketRef.get();
  if (!ticketDoc.exists) throw new HttpsError("not-found", "Ticket not found.");

  const ticketData = ticketDoc.data() as any;
  
  // Verify ownership or admin status
  const isAdmin = request.auth.token.role === "admin" || request.auth.token.role === "support";
  if (!isAdmin && ticketData.customerId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "You can only reply to your own tickets.");
  }

  const senderRole = isAdmin ? (request.auth.token.role as "admin" | "support") : "customer";
  const senderName = isAdmin ? "Support Team" : (request.auth.token.name || "Customer");

  const newMessage = {
    id: db.collection("support_tickets").doc().id,
    senderId: request.auth.uid,
    senderName,
    senderRole,
    body,
    attachments,
    createdAt: Timestamp.now(),
  };

  // If admin replies, change status to "waiting_on_customer" if it was "open"
  let newStatus = ticketData.status;
  if (isAdmin && ticketData.status === "open") {
    newStatus = "waiting_on_customer";
  } else if (!isAdmin && ticketData.status === "waiting_on_customer") {
    newStatus = "open";
  }

  await ticketRef.update({
messages: FieldValue.arrayUnion(newMessage),    
status: newStatus,
    updatedAt: Timestamp.now(),
  });

  return { success: true, message: "Message added." };
});

export const updateTicketStatus = onCall(async (request: CallableRequest) => {
  const admin = verifyAdmin(request);
  const { ticketId, status, assignedToAdminUid } = request.data;

  if (!ticketId || !status) {
    throw new HttpsError("invalid-argument", "ticketId and status are required.");
  }

  const ticketRef = db.collection("support_tickets").doc(ticketId);
  const updateData: any = { 
    status, 
    updatedAt: Timestamp.now() 
  };
  
  if (assignedToAdminUid !== undefined) updateData.assignedToAdminUid = assignedToAdminUid;
  if (status === "resolved" || status === "closed") updateData.resolvedAt = Timestamp.now();

  await ticketRef.update(updateData);
  await logAudit(admin.uid, admin.email, `TICKET_UPDATE`, "support_tickets", ticketId, null, updateData);

  return { success: true, message: "Ticket updated." };
});