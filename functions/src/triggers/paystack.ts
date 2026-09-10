import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as crypto from "crypto";
import { db } from "../config/admin";
import { Timestamp } from "firebase-admin/firestore";

// Define secrets (v2 way)
const PAYSTACK_WEBHOOK_SECRET = defineSecret("PAYSTACK_WEBHOOK_SECRET");

// Helper to read raw body for signature verification
const getRawBody = (req: any): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    req.on("data", (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]);
    });
    req.on("end", () => {
      resolve(data);
    });
    req.on("error", reject);
  });
};

export const paystackWebhook = onRequest(
  {
    secrets: [PAYSTACK_WEBHOOK_SECRET],
  },
  async (req, res) => {
    try {
      // 1. Verify the signature
      const signature = req.headers["x-paystack-signature"] as string;
      const webhookSecret = PAYSTACK_WEBHOOK_SECRET.value();

      if (!webhookSecret) {
        console.error("Paystack webhook secret not configured");
        res.status(500).send("Webhook secret not configured");
        return;
      }

      const rawBody = await getRawBody(req);
      const hash = crypto
        .createHmac("sha512", webhookSecret)
        .update(rawBody)
        .digest("hex");

      if (hash !== signature) {
        console.error("Invalid Paystack webhook signature");
        res.status(401).send("Invalid signature");
        return;
      }

      // 2. Parse the event
      const event = JSON.parse(rawBody.toString());
      const eventType = event.event;
      const eventData = event.data;

      console.log(`Paystack Webhook Received: ${eventType}`);

      if (eventType === "charge.success") {
        const reference = eventData.reference;
        const metadata = eventData.metadata || {};
        const orderId = metadata.orderId;

        if (!orderId) {
          res.status(400).send("Missing orderId in metadata");
          return;
        }

        // Use a transaction to ensure atomic updates
        await db.runTransaction(async (transaction) => {
          // Find the payment record
          const paymentQuery = await db.collection("payments").where("paystackReference", "==", reference).limit(1).get();
          if (paymentQuery.empty) {
            throw new Error("Payment record not found");
          }
          const paymentDoc = paymentQuery.docs[0];
          const paymentRef = paymentDoc.ref;

          // Update Payment Status
          transaction.update(paymentRef, {
            status: "success",
            paymentChannel: eventData.channel || "card",
            paystackAuthorizationCode: eventData.authorization?.authorization_code || null,
            completedAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          });

          // Update Order Status
          const orderRef = db.collection("orders").doc(orderId);
          const orderDoc = await transaction.get(orderRef);
          if (orderDoc.exists) {
            const orderData = orderDoc.data() as any;
            
            transaction.update(orderRef, {
              paymentStatus: "paid",
              status: orderData.status === "flagged" ? "flagged" : "processing",
              updatedAt: Timestamp.now(),
            });

            // 3. Confirm Stock Deduction
            if (orderData.items && Array.isArray(orderData.items)) {
              for (const item of orderData.items) {
                const invId = `${item.productId}_${item.warehouseId}`;
                const invRef = db.collection("inventory").doc(invId);
                const invDoc = await transaction.get(invRef);

                if (invDoc.exists) {
                  const invData = invDoc.data() as any;
                  transaction.update(invRef, {
                    quantityOnHand: Math.max(0, (invData.quantityOnHand || 0) - item.quantity),
                    quantityReserved: Math.max(0, (invData.quantityReserved || 0) - item.quantity),
                    updatedAt: Timestamp.now(),
                  });
                }
              }
            }
          }
        });

        console.log(`Successfully processed payment for order: ${orderId}`);
        res.status(200).send("Webhook processed successfully");
        return;
      } 
      
      else if (eventType === "charge.failed" || eventType === "abandoned") {
        const reference = eventData.reference;
        
        const paymentQuery = await db.collection("payments").where("paystackReference", "==", reference).limit(1).get();
        if (!paymentQuery.empty) {
          const paymentRef = paymentQuery.docs[0].ref;
          await paymentRef.update({
            status: eventType === "abandoned" ? "abandoned" : "failed",
            failureReason: eventData.gateway_response || "Payment failed",
            updatedAt: Timestamp.now(),
          });
        }
        res.status(200).send("Webhook processed successfully");
        return;
      }

      // Acknowledge all other events
      res.status(200).send("Webhook received");
      return;

    } catch (error: any) {
      console.error("Error processing Paystack webhook:", error);
      res.status(500).send("Internal server error");
      return;
    }
  }
);