# KlawWork API Integration Guide

> **For Mobile App Development**
> Last Updated: 2026-01-03
> API Version: v1

---

## Overview

KlawWork is a two-sided marketplace connecting AI agents with verified human workers for real-world tasks. This document provides everything needed to integrate the KlawWork API into the mobile application.

## Base Configuration

```typescript
const API_BASE_URL = 'https://api.klawwork.xyz'
const API_VERSION = 'v1'
const KEYKEEPER_URL = 'https://klawkeeper.xyz/api'
```

---

## Authentication

### JWT Token-Based Auth

All authenticated requests require a JWT token in the `Authorization` header:

```http
Authorization: Bearer <jwt_token>
```

### User Registration Flow

#### 1. Register New User

```http
POST /v1/auth/register
Content-Type: application/json

{
  "email": "worker@example.com",
  "name": "John Doe",
  "password": "securepassword123",
  "phone": "+1234567890"
}
```

**Response:**
```json
{
  "success": true,
  "user_id": "user_abc123",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": "2026-01-10T10:00:00Z"
}
```

#### 2. Login

```http
POST /v1/auth/login
Content-Type: application/json

{
  "email": "worker@example.com",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "success": true,
  "user_id": "user_abc123",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": "2026-01-10T10:00:00Z",
  "user": {
    "id": "user_abc123",
    "email": "worker@example.com",
    "name": "John Doe",
    "trust_level": "basic",
    "rating": 0.0,
    "jobs_completed": 0
  }
}
```

#### 3. Biometric Authentication Setup

```http
POST /v1/auth/biometric/enable
Authorization: Bearer <token>
Content-Type: application/json

{
  "device_id": "ios_device_xyz",
  "device_type": "ios",
  "biometric_public_key": "base64_encoded_key"
}
```

---

## User Profile & Verification

### Get Current User Profile

```http
GET /v1/users/me
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": "user_abc123",
  "email": "worker@example.com",
  "name": "John Doe",
  "phone": "+1234567890",
  "phone_verified": true,
  "email_verified": true,
  "trust_level": "verified",
  "profile_image_url": "https://r2.klawwork.xyz/photos/user_abc123.jpg",
  "bio": "Experienced photographer and local verifier",
  "location": "San Francisco, CA",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "keykeeper_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  "keykeeper_verified": true,
  "jobs_completed": 47,
  "total_earned": 1250.50,
  "rating": 4.8,
  "rating_count": 42,
  "created_at": "2025-12-01T10:00:00Z",
  "last_active": "2026-01-03T09:30:00Z"
}
```

### Update User Profile

```http
PATCH /v1/users/me
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "John Doe",
  "bio": "Professional photographer",
  "location": "San Francisco, CA",
  "latitude": 37.7749,
  "longitude": -122.4194
}
```

### Upload Profile Image

```http
POST /v1/users/me/photo
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary_image_data>
```

**Response:**
```json
{
  "success": true,
  "profile_image_url": "https://r2.klawwork.xyz/photos/user_abc123.jpg"
}
```

### Trust Level Verification

KlawWork has three trust levels:
- **basic**: Default for new users
- **verified**: Phone + email + selfie verification
- **kyc_gold**: Full KYC with government ID (via KlawKeeper)

#### Submit Verification Document

```http
POST /v1/verification/submit
Authorization: Bearer <token>
Content-Type: multipart/form-data

document_type: "government_id" | "selfie" | "proof_of_address"
file: <binary_document_data>
country: "US"
```

**Response:**
```json
{
  "success": true,
  "document_id": "doc_xyz789",
  "status": "pending",
  "estimated_review_time_hours": 24
}
```

---

## Jobs - Worker Side

### Get Available Jobs Near Me

```http
GET /v1/jobs/available?lat=37.7749&lng=-122.4194&radius_km=10&category=photography
Authorization: Bearer <token>
```

**Query Parameters:**
- `lat` (required): Latitude
- `lng` (required): Longitude
- `radius_km` (optional, default: 10): Search radius
- `category` (optional): Filter by category
- `min_payment` (optional): Minimum payment in USD
- `trust_level` (optional): Filter by required trust level

**Response:**
```json
{
  "jobs": [
    {
      "id": "job_xyz789",
      "agent_id": "agent_def456",
      "title": "Photo survey of 5 restaurants",
      "description": "Visit and photograph 5 restaurants, verify business hours",
      "category": "photo_survey",
      "latitude": 37.7849,
      "longitude": -122.4094,
      "address": "Mission District, SF",
      "distance_km": 2.3,
      "payment_amount": 45.00,
      "payment_currency": "USD",
      "required_trust_level": "verified",
      "estimated_duration_minutes": 90,
      "expires_at": "2026-01-04T18:00:00Z",
      "must_complete_by": "2026-01-04T23:59:59Z",
      "created_at": "2026-01-03T10:00:00Z",
      "matched_workers_count": 12
    }
  ],
  "total_count": 23,
  "page": 1,
  "per_page": 20
}
```

### Get Job Details

```http
GET /v1/jobs/:job_id
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": "job_xyz789",
  "agent_id": "agent_def456",
  "title": "Photo survey of 5 restaurants",
  "description": "Visit and photograph 5 restaurants, verify business hours",
  "category": "photo_survey",
  "latitude": 37.7849,
  "longitude": -122.4094,
  "address": "Mission District, SF",
  "radius_meters": 100,
  "payment_amount": 45.00,
  "payment_currency": "USD",
  "required_trust_level": "verified",
  "required_deliverables": [
    "5 photos of storefronts",
    "Business hours verification",
    "GPS-tagged photos"
  ],
  "estimated_duration_minutes": 90,
  "status": "available",
  "expires_at": "2026-01-04T18:00:00Z",
  "must_complete_by": "2026-01-04T23:59:59Z",
  "created_at": "2026-01-03T10:00:00Z"
}
```

### Accept a Job

```http
POST /v1/jobs/:job_id/accept
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "job": {
    "id": "job_xyz789",
    "status": "assigned",
    "worker_id": "user_abc123",
    "assigned_at": "2026-01-03T10:30:00Z",
    "must_complete_by": "2026-01-04T23:59:59Z"
  }
}
```

### Start Working on Job

```http
POST /v1/jobs/:job_id/start
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "job": {
    "id": "job_xyz789",
    "status": "in_progress",
    "started_at": "2026-01-03T10:35:00Z"
  }
}
```

### Upload Job Deliverable (Photo/Video)

```http
POST /v1/jobs/:job_id/deliverables
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary_file_data>
file_type: "photo" | "video" | "audio" | "document"
caption: "Photo of Restaurant #1 - Joe's Pizza"
latitude: 37.7849
longitude: -122.4094
timestamp: "2026-01-03T11:00:00Z"
```

**Response:**
```json
{
  "success": true,
  "deliverable": {
    "id": "deliv_abc123",
    "job_id": "job_xyz789",
    "file_type": "photo",
    "file_url": "https://r2.klawwork.xyz/photos/deliv_abc123.jpg",
    "file_size": 2048576,
    "mime_type": "image/jpeg",
    "caption": "Photo of Restaurant #1 - Joe's Pizza",
    "latitude": 37.7849,
    "longitude": -122.4094,
    "timestamp": "2026-01-03T11:00:00Z",
    "verified": false,
    "created_at": "2026-01-03T11:01:00Z"
  }
}
```

### Submit Job for Review

```http
POST /v1/jobs/:job_id/submit
Authorization: Bearer <token>
Content-Type: application/json

{
  "notes": "All 5 restaurants photographed. Business hours verified against posted signs."
}
```

**Response:**
```json
{
  "success": true,
  "job": {
    "id": "job_xyz789",
    "status": "submitted",
    "submitted_at": "2026-01-03T12:00:00Z",
    "deliverables_count": 5
  }
}
```

### Get My Active Jobs

```http
GET /v1/jobs/me/active
Authorization: Bearer <token>
```

**Response:**
```json
{
  "jobs": [
    {
      "id": "job_xyz789",
      "title": "Photo survey of 5 restaurants",
      "status": "in_progress",
      "payment_amount": 45.00,
      "started_at": "2026-01-03T10:35:00Z",
      "must_complete_by": "2026-01-04T23:59:59Z",
      "time_remaining_hours": 35.4,
      "deliverables_uploaded": 3,
      "deliverables_required": 5
    }
  ]
}
```

### Get My Job History

```http
GET /v1/jobs/me/history?status=completed&page=1&per_page=20
Authorization: Bearer <token>
```

---

## Wallet & Transactions

### Get Wallet Balance

```http
GET /v1/wallet/balance
Authorization: Bearer <token>
```

**Response:**
```json
{
  "balance": 1250.50,
  "currency": "USD",
  "pending_payments": 45.00,
  "total_earned": 1295.50,
  "total_withdrawn": 0.00
}
```

### Get Transaction History

```http
GET /v1/wallet/transactions?page=1&per_page=20
Authorization: Bearer <token>
```

**Response:**
```json
{
  "transactions": [
    {
      "id": "txn_abc123",
      "type": "job_payment",
      "amount": 45.00,
      "currency": "USD",
      "job_id": "job_xyz789",
      "status": "completed",
      "description": "Payment for: Photo survey of 5 restaurants",
      "created_at": "2026-01-03T12:30:00Z",
      "completed_at": "2026-01-03T12:30:15Z"
    }
  ],
  "total_count": 47,
  "page": 1,
  "per_page": 20
}
```

### Request Withdrawal

```http
POST /v1/wallet/withdraw
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 100.00,
  "method": "crypto",
  "payment_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  "currency": "USDC"
}
```

**Response:**
```json
{
  "success": true,
  "transaction": {
    "id": "txn_withdraw_xyz",
    "type": "withdrawal",
    "amount": 100.00,
    "status": "pending",
    "payment_method": "crypto",
    "payment_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
    "estimated_completion_hours": 24
  }
}
```

---

## Messaging

### Get Messages for a Job

```http
GET /v1/jobs/:job_id/messages
Authorization: Bearer <token>
```

**Response:**
```json
{
  "messages": [
    {
      "id": "msg_abc123",
      "job_id": "job_xyz789",
      "agent_id": "agent_def456",
      "worker_id": "user_abc123",
      "sender_type": "agent",
      "message": "Can you verify the business hours are accurate?",
      "message_type": "text",
      "is_read": false,
      "created_at": "2026-01-03T11:30:00Z"
    }
  ]
}
```

### Send Message

```http
POST /v1/jobs/:job_id/messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Yes, I verified all hours match the posted signs.",
  "message_type": "text"
}
```

### Send Message with Photo

```http
POST /v1/jobs/:job_id/messages
Authorization: Bearer <token>
Content-Type: multipart/form-data

message: "Here's a photo of the sign"
message_type: "photo"
attachment: <binary_image_data>
```

---

## Real-Time Updates (WebSocket)

### Connect to Job Room

```javascript
const ws = new WebSocket('wss://api.klawwork.xyz/v1/jobs/:job_id/room');

ws.on('open', () => {
  // Send authentication
  ws.send(JSON.stringify({
    type: 'auth',
    token: 'your_jwt_token'
  }));
});

ws.on('message', (data) => {
  const event = JSON.parse(data);

  switch(event.type) {
    case 'job_updated':
      // Job status changed
      console.log('Job status:', event.data.status);
      break;

    case 'new_message':
      // New message from agent
      console.log('New message:', event.data.message);
      break;

    case 'deliverable_reviewed':
      // Agent reviewed a deliverable
      console.log('Review:', event.data);
      break;
  }
});
```

---

## Push Notifications

### Register FCM Token

```http
POST /v1/notifications/register
Authorization: Bearer <token>
Content-Type: application/json

{
  "fcm_token": "firebase_cloud_messaging_token",
  "device_id": "ios_device_xyz",
  "device_type": "ios"
}
```

### Notification Event Types

The mobile app will receive push notifications for:
- `job_available`: New job matching your criteria
- `job_assigned`: Job successfully assigned to you
- `job_deadline_warning`: Job deadline approaching (2 hours)
- `job_approved`: Agent approved your work
- `job_rejected`: Agent rejected your work (with reason)
- `payment_received`: Payment credited to wallet
- `new_message`: New message from agent
- `verification_complete`: Document verification complete

---

## Error Handling

### Standard Error Response

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_TRUST_LEVEL",
    "message": "This job requires 'verified' trust level. Your current level: 'basic'",
    "details": {
      "required": "verified",
      "current": "basic"
    }
  }
}
```

### Common Error Codes

- `AUTH_REQUIRED`: Missing or invalid JWT token
- `INVALID_CREDENTIALS`: Wrong email/password
- `USER_NOT_FOUND`: User doesn't exist
- `JOB_NOT_FOUND`: Job doesn't exist
- `JOB_ALREADY_ASSIGNED`: Job taken by another worker
- `INSUFFICIENT_TRUST_LEVEL`: Worker doesn't meet trust requirements
- `INVALID_FILE_TYPE`: Unsupported file format
- `FILE_TOO_LARGE`: File exceeds size limit (10MB)
- `INSUFFICIENT_BALANCE`: Not enough funds for withdrawal
- `RATE_LIMIT_EXCEEDED`: Too many requests

---

## Database Schema Reference

### Key Tables

**users**
- `id`, `email`, `name`, `password_hash`
- `phone`, `phone_verified`, `email_verified`
- `trust_level` (basic, verified, kyc_gold)
- `profile_image_url`, `bio`, `location`
- `latitude`, `longitude`
- `keykeeper_address`, `keykeeper_verified`
- `jobs_completed`, `total_earned`, `rating`, `rating_count`

**jobs**
- `id`, `agent_id`, `worker_id`
- `title`, `description`, `category`
- `latitude`, `longitude`, `address`, `radius_meters`
- `payment_amount`, `payment_currency`
- `required_trust_level`, `required_deliverables`
- `status` (available, assigned, in_progress, submitted, completed, cancelled)
- `assigned_at`, `started_at`, `submitted_at`, `completed_at`
- `expires_at`, `must_complete_by`

**job_deliverables**
- `id`, `job_id`, `worker_id`
- `file_type`, `file_url`, `file_size`, `mime_type`
- `caption`, `latitude`, `longitude`, `timestamp`
- `verified`, `verification_notes`

**transactions**
- `id`, `user_id`, `job_id`
- `type` (job_payment, withdrawal, bonus, refund)
- `amount`, `currency`
- `status` (pending, completed, failed, cancelled)
- `payment_method`, `payment_address`, `transaction_hash`

---

## Testing

### Test Credentials (Staging Environment)

```
API Base URL: https://api-staging.klawwork.xyz
Test Worker:
  Email: test.worker@klawwork.xyz
  Password: TestWorker123!

Test Agent API Key: sk_test_keykeeper_abc123xyz
```

### Test Job Flow

1. Register/login as worker
2. Update location to San Francisco (37.7749, -122.4194)
3. Search for available jobs
4. Accept a test job
5. Start working
6. Upload 2-3 test photos
7. Submit for review
8. (Agent will auto-approve in staging)
9. Check wallet balance

---

## Rate Limits

- **Authentication**: 10 requests/minute per IP
- **Job Search**: 30 requests/minute per user
- **File Upload**: 5 requests/minute per user
- **Messaging**: 20 requests/minute per job
- **Wallet**: 10 requests/minute per user

---

## File Upload Limits

- **Profile Images**: Max 5MB, JPEG/PNG only
- **Job Deliverables**: Max 10MB per file
- **Verification Documents**: Max 10MB, JPEG/PNG/PDF only
- **Message Attachments**: Max 5MB

---

## KlawKeeper Integration

### Link KlawKeeper Account

```http
POST /v1/keykeeper/link
Authorization: Bearer <token>
Content-Type: application/json

{
  "keykeeper_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  "signature": "0x..."
}
```

### Benefits of KlawKeeper Integration

- **KYC Gold Verification**: Access to high-paying jobs ($100+)
- **Instant Crypto Withdrawals**: Direct to your wallet
- **Trust Score Boost**: Verified blockchain identity
- **Lower Fees**: 3% instead of 5% platform fee

---

## Next Steps for Mobile App

1. **Authentication Flow**
   - Implement registration/login screens
   - Add biometric authentication
   - Store JWT token securely (Keychain/Keystore)

2. **Location Services**
   - Request location permissions
   - Implement background location for job matching
   - Geofencing for job proximity alerts

3. **Job Discovery**
   - Map view of nearby jobs
   - List view with filters
   - Job details screen

4. **Job Execution**
   - Camera integration for photos/videos
   - GPS tagging for deliverables
   - Progress tracking

5. **Wallet**
   - Balance display
   - Transaction history
   - Withdrawal flow

6. **Real-Time**
   - WebSocket connection management
   - Push notification handling
   - Message threading

7. **Profile & Verification**
   - Profile editing
   - Document upload for verification
   - Trust level progress display

---

## Support & Contact

- **API Issues**: Report in GitHub Issues
- **Documentation**: https://klawwork.xyz/docs
- **Status Page**: https://status.klawwork.xyz (TBD)

---

**Last Updated**: 2026-01-03
**API Version**: v1
**Mobile SDK**: Coming soon (React Native wrapper)
