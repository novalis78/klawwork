# KeyWorker Mobile App — Backend Endpoints Needed

**From:** KeyWorker.app mobile team
**To:** KeyWork API team (keywork-api/)
**Date:** 2026-02-10
**Status:** Mobile app has been updated to match existing API routes. Only genuinely missing endpoints listed below.

---

## Context

The mobile app (`keyworker.app/app/services/api.js`) has been updated to call the correct existing routes:

| What | Mobile now calls | Status |
|---|---|---|
| Login | `POST /auth/login` | Working |
| Register | `POST /auth/register` | Working |
| Get profile | `GET /auth/me` | Working |
| Logout | `POST /auth/logout` | Working |
| List jobs | `GET /jobs` | Working |
| Job details | `GET /jobs/:id` | Working |
| Accept job | `POST /jobs/:id/accept` | Working |
| Start job | `POST /jobs/:id/start` | Working |
| Upload deliverable | `POST /jobs/:id/upload` | Working |
| Complete job | `POST /jobs/:id/complete` | Working |
| Active jobs | `GET /jobs/my/active` | Working |
| Job history | `GET /jobs/my/completed` | Working |
| Wallet balance | `GET /wallet/balance` | Working |
| Transactions | `GET /wallet/transactions` | Working |
| Withdraw | `POST /wallet/withdraw` | Working |
| Get messages | `GET /messages/:jobId` | Working |
| Send message | `POST /messages/:jobId/send` | Working |
| Verification status | `GET /verification/status` | Working |
| Submit verification | `POST /verification/submit` | Working |
| Health check | `GET /health` | Working |

---

## 5 Endpoints That Need Implementation

These are called by the mobile app but don't exist on the backend yet. None of them block the core job flow — they're profile management and device features.

### 1. `PATCH /auth/me/profile` — Update User Profile

**Auth:** Bearer token required

**Request body** (all fields optional, only update what's present):
```json
{
  "name": "New Name",
  "bio": "Updated bio",
  "phone": "+1234567890",
  "location": "New York, NY",
  "latitude": 40.7128,
  "longitude": -74.0060
}
```

**Implementation:**
```typescript
authRouter.patch('/me/profile', async (request: any, env: Env) => {
  const { user } = request;
  if (!user) return error(401, 'Not authenticated');

  const body = await request.json();
  const allowedFields = ['name', 'bio', 'phone', 'location', 'latitude', 'longitude'];
  const updates = [];
  const values = [];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(body[field]);
    }
  }

  if (updates.length === 0) return error(400, 'No valid fields to update');

  updates.push("updated_at = CURRENT_TIMESTAMP");
  values.push(user.id);

  await execute(env.DB, `UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

  const profile = await queryOne(env.DB,
    `SELECT id, name, email, phone, trust_level, profile_image_url, bio,
     location, latitude, longitude, email_verified, phone_verified, keykeeper_verified,
     jobs_completed, total_earned, rating, rating_count, created_at
     FROM users WHERE id = ?`,
    [user.id]
  );

  return json({ user: profile });
});
```

**Expected response:**
```json
{
  "user": { ...full user profile object... }
}
```

---

### 2. `POST /auth/me/photo` — Upload Profile Photo

**Auth:** Bearer token required
**Content-Type:** multipart/form-data
**Field:** `file` — image blob (image/jpeg or image/png)

**Implementation:**
```typescript
authRouter.post('/me/photo', async (request: any, env: Env) => {
  const { user } = request;
  if (!user) return error(401, 'Not authenticated');

  const formData = await request.formData();
  const file = formData.get('file') as File;
  if (!file) return error(400, 'No file provided');

  const fileId = generateId('photo');
  const ext = file.name?.split('.').pop() || 'jpg';
  const fileKey = `profiles/${user.id}/${fileId}.${ext}`;

  await env.PHOTOS.put(fileKey, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  // Build the public URL for the photo
  const profileImageUrl = `https://photos.keywork.world/${fileKey}`;

  await execute(env.DB,
    `UPDATE users SET profile_image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [profileImageUrl, user.id]
  );

  return json({ success: true, profile_image_url: profileImageUrl });
});
```

**Expected response:**
```json
{
  "success": true,
  "profile_image_url": "https://photos.keywork.world/profiles/usr_abc/photo_123.jpg"
}
```

The mobile checks `response.success && response.profile_image_url` (`authSlice.js:189`).

---

### 3. `POST /auth/biometric/enable` — Enable Biometric Auth

**Auth:** Bearer token required

**Request body:**
```json
{
  "device_id": "device_abc123",
  "biometric_type": "fingerprint"
}
```

**Implementation:**
```typescript
authRouter.post('/biometric/enable', async (request: any, env: Env) => {
  const { user } = request;
  if (!user) return error(401, 'Not authenticated');

  const { device_id, biometric_type } = await request.json();

  // Update the session's biometric flag
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.substring(7);
  if (token) {
    const tokenHash = await hashPassword(token);
    await execute(env.DB,
      `UPDATE sessions SET biometric_enabled = 1, device_id = ? WHERE token_hash = ?`,
      [device_id, tokenHash]
    );
  }

  return json({ success: true, message: 'Biometric authentication enabled' });
});
```

---

### 4. `POST /notifications/register` — Register Push Token

**Auth:** Bearer token required

**Request body:**
```json
{
  "fcm_token": "ExponentPushToken[abc123]",
  "device_id": "device_abc123",
  "device_type": "ios"
}
```

**Note:** This requires adding a new route group since `/notifications` isn't an existing router. Add it to `src/index.ts`:
```typescript
router.all('/notifications/*', authMiddleware, notificationsRouter.handle);
```

**Implementation** (new file `src/routes/notifications.ts`):
```typescript
import { Router, error, json } from 'itty-router';
import { Env } from '../index';
import { execute } from '../utils/db';
import { hashPassword } from '../utils/auth';

export const notificationsRouter = Router({ base: '/notifications' });

notificationsRouter.post('/register', async (request: any, env: Env) => {
  const { user } = request;
  if (!user) return error(401, 'Not authenticated');

  const { fcm_token, device_id, device_type } = await request.json();

  if (!fcm_token) return error(400, 'FCM token is required');

  // Update the current session with push token
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.substring(7);
  if (token) {
    const tokenHash = await hashPassword(token);
    await execute(env.DB,
      `UPDATE sessions SET fcm_token = ?, device_id = ?, device_type = ? WHERE token_hash = ?`,
      [fcm_token, device_id, device_type, tokenHash]
    );
  }

  return json({ success: true, message: 'Push token registered' });
});
```

---

### 5. `POST /keykeeper/link` — Link KeyKeeper Account

**Auth:** Bearer token required

**Request body:**
```json
{
  "keykeeper_address": "kk_abc123",
  "signature": "signed_challenge_hex"
}
```

**Note:** This also requires a new route group. Add to `src/index.ts`:
```typescript
router.all('/keykeeper/*', authMiddleware, keykeeperRouter.handle);
```

**Implementation** (new file `src/routes/keykeeper.ts`):
```typescript
import { Router, error, json } from 'itty-router';
import { Env } from '../index';
import { execute } from '../utils/db';

export const keykeeperRouter = Router({ base: '/keykeeper' });

keykeeperRouter.post('/link', async (request: any, env: Env) => {
  const { user } = request;
  if (!user) return error(401, 'Not authenticated');

  const { keykeeper_address, signature } = await request.json();

  if (!keykeeper_address) return error(400, 'KeyKeeper address is required');

  // TODO: Optionally verify signature against KeyKeeper API
  // const isValid = await fetch(`${env.KEYKEEPER_API_URL}/verify`, { ... });

  await execute(env.DB,
    `UPDATE users SET keykeeper_address = ?, keykeeper_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [keykeeper_address, user.id]
  );

  return json({
    success: true,
    keykeeper_address,
    keykeeper_verified: true,
  });
});
```

---

## One Minor Enhancement (Optional)

### Login response: include `latitude`/`longitude` in user object

The mobile `authSlice.js` has selectors for `selectUserLatitude` and `selectUserLongitude`, but the current login response only returns `id, name, email, trust_level, isEmailVerified, isPhoneVerified`.

The `GET /auth/me` endpoint already returns the full profile with lat/lng. Since the mobile calls `/auth/me` right after login anyway (via `checkAuth`), this isn't blocking — but including more fields in the login response would save one round-trip.

---

## Summary

**5 endpoints to add, in priority order:**

1. `PATCH /auth/me/profile` — Profile editing (users will want this immediately)
2. `POST /auth/me/photo` — Profile photo upload (R2 upload, same pattern as job deliverables)
3. `POST /notifications/register` — Push tokens (needed for job notifications)
4. `POST /auth/biometric/enable` — Biometric auth (nice-to-have for UX)
5. `POST /keykeeper/link` — KeyKeeper linking (needed for crypto withdrawals)

All 5 are simple — mostly single UPDATE statements. Endpoints 1-2 go in `src/routes/auth.ts`. Endpoints 3-5 need new route files.

**Nothing else is needed for the mobile app to work with the existing API.**
