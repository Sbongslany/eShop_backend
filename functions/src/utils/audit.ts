import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";

export const logAudit = async (
  actorUid: string,
  actorEmail: string,
  action: string,
  targetCollection: string,
  targetDocId: string,
  previousData?: any,
  newData?: any
) => {
  try {
    await db.collection("audit_logs").add({
      actorUid: actorUid,
      actorEmail: actorEmail,
      action: action,
      targetCollection: targetCollection,
      targetDocId: targetDocId,
      previousData: previousData || null,
      newData: newData || null,
      timestamp: Timestamp.now(),
    });
  } catch (error) {
    console.error("Failed to write audit log:", error);
    // Don't throw - audit log failure shouldn't break the main operation
  }
};