import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { adminAuth } from '../config/admin';

// Define allowed roles for type safety
type AdminRole = 'super_admin' | 'admin' | 'support';
const ALLOWED_ROLES: AdminRole[] = ['super_admin', 'admin', 'support'];

export const setAdminRole = onCall(async (request: CallableRequest) => {
  // 1. Verify the user is authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be logged in to perform this action.');
  }

  // 2. Verify the caller is a super_admin
  const callerToken = await adminAuth.getUser(request.auth.uid);
  if (callerToken.customClaims?.role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only super admins can assign roles.');
  }

  // 3. Validate the input data
  const { uid, role } = request.data;
  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('invalid-argument', 'A valid user UID is required.');
  }
  if (!role || !ALLOWED_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', `Role must be one of: ${ALLOWED_ROLES.join(', ')}`);
  }

  // 4. Set the custom claims on the target user
  try {
    await adminAuth.setCustomUserClaims(uid, { role });
    return { success: true, message: `Successfully assigned role '${role}' to user ${uid}` };
  } catch (error) {
    console.error('Error setting custom claims:', error);
    throw new HttpsError('internal', 'An error occurred while assigning the role.');
  }
});