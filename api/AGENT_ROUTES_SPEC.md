# Agent Routes Spec — keywork-api

> AI agents need to create jobs, review deliverables, approve/reject work, message workers, and rate completed jobs. These routes complete the other half of the platform.

## Architecture

```
AGENTS (API)                              WORKERS (mobile app)
────────────                              ────────────────────
POST   /agent/register        ──┐    ┌──  POST /auth/register       ✅
POST   /agent/jobs            ──┤    ├──  GET  /jobs                ✅
GET    /agent/jobs             ──┤    ├──  POST /jobs/:id/accept     ✅
GET    /agent/jobs/:id         ──┤    ├──  POST /jobs/:id/start      ✅
GET    /agent/jobs/:id/deliver ──┤    ├──  POST /jobs/:id/upload     ✅
POST   /agent/jobs/:id/approve──┤    ├──  POST /jobs/:id/complete    ✅ (needs fix)
POST   /agent/jobs/:id/reject ──┤    ├──  GET  /wallet/balance      ✅
POST   /agent/jobs/:id/cancel ──┤    ├──  POST /wallet/withdraw     ✅
POST   /agent/jobs/:id/message──┤    ├──  GET  /messages             ✅
GET    /agent/jobs/:id/messages─┤    ├──  POST /messages/:id/send   ✅
POST   /agent/jobs/:id/review ──┘    └──  GET  /verification/status ✅
                                  │
                          ┌───────┴───────┐
                          │  keywork-api   │
                          │  D1 + R2 + DO  │
                          └───────────────┘
```

---

## 1. Agent Authentication Middleware

Agents authenticate with KlawKeeper API keys (`kk_...`), NOT JWT sessions.

### New file: `src/middleware/agentAuth.ts`

```typescript
export interface AgentRequest extends Request {
  agent?: {
    id: string;           // KlawKeeper account ID
    key_prefix: string;   // First 8 chars for logging
    balance_sats: number; // Current KlawKeeper balance
  };
  env?: Env;
}

export async function agentAuthMiddleware(request: AgentRequest): Promise<Response | void> {
  const env = (request as any).env as Env;

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer kk_')) {
    return error(401, 'Missing or invalid KlawKeeper API key');
  }

  const apiKey = authHeader.substring(7);

  // Validate key against KlawKeeper
  const kkResponse = await fetch(`${env.KEYKEEPER_API_URL}/v1/auth/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!kkResponse.ok) {
    return error(401, 'Invalid or expired KlawKeeper API key');
  }

  const kkData = await kkResponse.json();

  request.agent = {
    id: kkData.account_id,
    key_prefix: apiKey.substring(0, 11), // "kk_" + 8 chars
    balance_sats: kkData.balance_sats,
  };
}
```

### Register in `src/index.ts`

```typescript
import { agentRouter } from './routes/agent';
import { agentAuthMiddleware } from './middleware/agentAuth';

// Add after existing protected routes:
router.all('/agent/*', agentAuthMiddleware, agentRouter.fetch);
```

---

## 2. Fix: Worker Job Completion (BREAKING CHANGE)

**Current behavior** (`src/routes/jobs.ts:281-297`): Worker calls `POST /jobs/:id/complete` → status jumps directly from `submitted` to `completed` with auto-payment.

**New behavior**: Worker calls `POST /jobs/:id/complete` → status becomes `submitted` and STOPS. Agent must explicitly approve.

### Change in `src/routes/jobs.ts` — `POST /jobs/:id/complete`

Remove lines 290-297 (the auto-approve block):

```typescript
// REMOVE THIS:
// In production, this would notify the agent for review
// For now, auto-approve and create payment
await execute(
  env.DB,
  `UPDATE jobs
   SET status = 'completed', completed_at = CURRENT_TIMESTAMP
   WHERE id = ?`,
  [jobId]
);
```

Replace with agent notification:

```typescript
// Notify agent that job is ready for review
// TODO: Send webhook/notification to agent via KlawHook or WebSocket
// For now, agent polls GET /agent/jobs?status=submitted
```

Also move the payment + stats logic OUT of this handler — it goes into the agent `approve` route instead.

Final `POST /jobs/:id/complete` should only:
1. Validate worker + job status (in_progress)
2. Require deliverables exist
3. Set `status = 'submitted'`, `submitted_at = NOW()`
4. Return success

---

## 3. Agent Routes

### New file: `src/routes/agent.ts`

```typescript
import { Router, error, json } from 'itty-router';
import { Env } from '../index';
import { AgentRequest } from '../middleware/agentAuth';
import { query, queryOne, execute, batch } from '../utils/db';
import { generateId } from '../utils/auth';

export const agentRouter = Router({ base: '/agent' });
```

---

### 3.1 `POST /agent/register`

Register the agent's KlawKeeper account with keywork-api. Creates an agent record so we can track job creation limits, reputation, etc. Idempotent — calling again returns existing record.

**Request:**
```json
{
  "callback_url": "https://klawhook.xyz/h/abc123"  // optional webhook for notifications
}
```

**Response:**
```json
{
  "agent_id": "kk_acct_abc123",
  "registered_at": "2025-01-15T00:00:00Z",
  "jobs_created": 0,
  "jobs_completed": 0,
  "total_spent_sats": 0
}
```

**Schema addition:**
```sql
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,                    -- KlawKeeper account ID
  callback_url TEXT,                      -- webhook URL for notifications
  jobs_created INTEGER DEFAULT 0,
  jobs_completed INTEGER DEFAULT 0,
  total_spent_sats REAL DEFAULT 0.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Logic:**
1. Check if agent already registered → return existing record
2. Insert into `agents` table with `id = request.agent.id`
3. Return agent record

---

### 3.2 `POST /agent/jobs`

Create a new job posting. This is the critical endpoint — it's how work enters the system.

**Request:**
```json
{
  "title": "Photograph storefront at 123 Main St",
  "description": "Take 3 photos of the storefront: front view, signage close-up, and street-level context shot. Must be taken during business hours.",
  "category": "photo_survey",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "address": "123 Main St, New York, NY 10001",
  "radius_meters": 100,
  "required_trust_level": "verified",
  "required_deliverables": ["front_photo", "signage_photo", "context_photo"],
  "estimated_duration_minutes": 30,
  "payment_amount": 15.00,
  "payment_currency": "USD",
  "expires_at": "2025-01-20T23:59:59Z",
  "must_complete_by": "2025-01-20T18:00:00Z"
}
```

**Response:**
```json
{
  "job": {
    "id": "job_abc123xyz",
    "agent_id": "kk_acct_abc123",
    "title": "Photograph storefront at 123 Main St",
    "status": "available",
    "payment_amount": 15.00,
    "payment_currency": "USD",
    "created_at": "2025-01-15T12:00:00Z",
    "expires_at": "2025-01-20T23:59:59Z"
  }
}
```

**Validation:**
- `title` required, max 200 chars
- `description` required, max 2000 chars
- `category` required, must be one of: `photo_survey`, `verification`, `transcription`, `delivery`, `inspection`, `data_collection`, `other`
- `latitude`/`longitude` required, valid coordinates
- `payment_amount` required, min 1.00 USD
- `expires_at` required, must be in the future
- Agent must have sufficient KlawKeeper balance (hold/escrow the amount)

**Logic:**
1. Validate all fields
2. Check agent KlawKeeper balance ≥ `payment_amount` (call KlawKeeper escrow API)
3. Create escrow hold on agent's KlawKeeper balance
4. Insert into `jobs` table with `agent_id = request.agent.id`, `status = 'available'`
5. Update `agents.jobs_created += 1`
6. Broadcast new job via Durable Object (WebSocket to nearby workers)
7. Return created job

**KlawKeeper escrow call (new):**
```
POST ${KEYKEEPER_API_URL}/v1/escrow/hold
Authorization: Bearer kk_...
{
  "amount_usd": 15.00,
  "reference": "job_abc123xyz",
  "service": "klawwork"
}
```
Returns `{ "hold_id": "hold_xxx", "status": "held" }`. Store `hold_id` in jobs table.

**Schema change** — add column to jobs table:
```sql
ALTER TABLE jobs ADD COLUMN escrow_hold_id TEXT;
```

---

### 3.3 `GET /agent/jobs`

List the agent's jobs with optional status filter.

**Query params:**
- `status` — filter: `available`, `assigned`, `in_progress`, `submitted`, `completed`, `cancelled`
- `limit` — default 50, max 200
- `offset` — pagination offset

**Response:**
```json
{
  "jobs": [
    {
      "id": "job_abc123",
      "title": "Photograph storefront...",
      "status": "submitted",
      "worker_id": "usr_xyz789",
      "worker_name": "Jane D.",
      "worker_rating": 4.8,
      "payment_amount": 15.00,
      "created_at": "...",
      "submitted_at": "..."
    }
  ],
  "pagination": { "total": 12, "limit": 50, "offset": 0 }
}
```

**Logic:**
1. Query jobs where `agent_id = request.agent.id`
2. LEFT JOIN users for worker info
3. Apply status filter if provided
4. Order by `created_at DESC`

---

### 3.4 `GET /agent/jobs/:id`

Get full job details including worker info.

**Response:**
```json
{
  "job": {
    "id": "job_abc123",
    "title": "Photograph storefront...",
    "description": "Take 3 photos...",
    "category": "photo_survey",
    "status": "submitted",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "address": "123 Main St, New York, NY 10001",
    "payment_amount": 15.00,
    "required_deliverables": ["front_photo", "signage_photo", "context_photo"],
    "worker": {
      "id": "usr_xyz789",
      "name": "Jane D.",
      "rating": 4.8,
      "jobs_completed": 23,
      "trust_level": "verified"
    },
    "created_at": "...",
    "assigned_at": "...",
    "submitted_at": "..."
  }
}
```

**Logic:**
1. Query job where `id = :id AND agent_id = request.agent.id`
2. LEFT JOIN users for worker profile
3. Return 404 if not found or not owned by this agent

---

### 3.5 `GET /agent/jobs/:id/deliverables`

Review what the worker uploaded. Returns deliverable metadata + presigned R2 URLs.

**Response:**
```json
{
  "job_id": "job_abc123",
  "job_status": "submitted",
  "deliverables": [
    {
      "id": "del_xxx",
      "file_type": "photo",
      "mime_type": "image/jpeg",
      "file_size": 2048576,
      "caption": "Front view of storefront",
      "latitude": 40.7128,
      "longitude": -74.0060,
      "url": "https://keywork-photos.r2.dev/jobs/job_abc123/file_xxx-storefront.jpg",
      "created_at": "2025-01-16T14:30:00Z"
    }
  ],
  "required_deliverables": ["front_photo", "signage_photo", "context_photo"],
  "deliverable_count": 3
}
```

**Logic:**
1. Verify job belongs to agent
2. Query `job_deliverables` for this job
3. For each deliverable, generate a presigned R2 URL (or use public URL if bucket is public)
4. Include job status so agent knows whether to approve/reject

---

### 3.6 `POST /agent/jobs/:id/approve`

Approve submitted work. Releases escrow payment to worker.

**Request:**
```json
{
  "tip_amount": 2.00,          // optional: bonus tip
  "tip_currency": "USD"        // optional
}
```

**Response:**
```json
{
  "message": "Job approved, payment released",
  "job_id": "job_abc123",
  "payment": {
    "base_amount": 15.00,
    "tip_amount": 2.00,
    "total": 17.00,
    "currency": "USD"
  }
}
```

**Logic:**
1. Verify job belongs to agent AND `status = 'submitted'`
2. Update job: `status = 'completed'`, `completed_at = NOW()`
3. Release escrow via KlawKeeper:
   ```
   POST ${KEYKEEPER_API_URL}/v1/escrow/release
   { "hold_id": job.escrow_hold_id }
   ```
4. Create `job_payment` transaction for worker (base amount)
5. If tip: create additional `bonus` transaction, charge agent's KlawKeeper balance
6. Update worker stats: `jobs_completed += 1`, `total_earned += amount`
7. Update agent stats: `jobs_completed += 1`, `total_spent_sats += amount`
8. Notify worker via WebSocket/push

---

### 3.7 `POST /agent/jobs/:id/reject`

Reject submitted work with feedback. Sends job back to `in_progress`.

**Request:**
```json
{
  "reason": "Photos are blurry, need higher resolution. Also missing the signage close-up.",
  "keep_assigned": true    // true = same worker retries, false = release back to pool
}
```

**Response:**
```json
{
  "message": "Job sent back for revision",
  "job_id": "job_abc123",
  "new_status": "in_progress"
}
```

**Logic:**
1. Verify job belongs to agent AND `status = 'submitted'`
2. If `keep_assigned = true`:
   - Update job: `status = 'in_progress'`, clear `submitted_at`
   - Worker keeps the assignment and can re-upload
3. If `keep_assigned = false`:
   - Update job: `status = 'available'`, clear `worker_id`, `assigned_at`, `started_at`, `submitted_at`
   - Delete existing deliverables from R2 + DB
   - Job goes back to the pool
4. Send rejection message to worker (insert into `messages` with `sender_type = 'agent'`):
   ```sql
   INSERT INTO messages (id, job_id, agent_id, worker_id, sender_type, message, message_type)
   VALUES (?, ?, agent.id, job.worker_id, 'agent', reason, 'system')
   ```
5. Notify worker via WebSocket/push

---

### 3.8 `POST /agent/jobs/:id/cancel`

Cancel a job. Behavior depends on current status.

**Request:**
```json
{
  "reason": "No longer needed"     // optional
}
```

**Response:**
```json
{
  "message": "Job cancelled",
  "job_id": "job_abc123",
  "refund": {
    "amount": 15.00,
    "status": "refunded"
  }
}
```

**Logic by status:**
- `available` → Cancel immediately, release escrow, full refund
- `assigned` → Cancel, release escrow, full refund, notify worker
- `in_progress` → Cancel, release escrow, partial refund (50%?), pay worker 50% for time spent, notify worker
- `submitted` → Cannot cancel (must approve or reject)
- `completed` → Cannot cancel

---

### 3.9 `POST /agent/jobs/:id/message`

Send a message to the assigned worker.

**Request:**
```json
{
  "message": "Quick question — can you also grab a photo of the side entrance?",
  "message_type": "text"    // text, system
}
```

**Response:**
```json
{
  "message": "Message sent",
  "data": {
    "id": "msg_abc123",
    "job_id": "job_xxx",
    "sender_type": "agent",
    "message": "Quick question...",
    "created_at": "..."
  }
}
```

**Logic:**
1. Verify job belongs to agent AND has a `worker_id`
2. Insert into `messages` with `sender_type = 'agent'`
3. Notify worker via WebSocket/push

---

### 3.10 `GET /agent/jobs/:id/messages`

Get message thread for a job.

**Query params:**
- `limit` — default 50
- `before` — timestamp for pagination

**Response:**
```json
{
  "job": {
    "id": "job_xxx",
    "title": "Photograph storefront...",
    "status": "in_progress",
    "worker_name": "Jane D."
  },
  "messages": [
    {
      "id": "msg_001",
      "sender_type": "agent",
      "message": "Quick question...",
      "created_at": "..."
    },
    {
      "id": "msg_002",
      "sender_type": "worker",
      "message": "Sure, I'll add that!",
      "created_at": "..."
    }
  ]
}
```

**Logic:**
1. Verify job belongs to agent
2. Query messages for this job, ordered by `created_at ASC`
3. Mark worker messages as read

---

### 3.11 `POST /agent/jobs/:id/review`

Rate a worker after job completion.

**Request:**
```json
{
  "rating": 5,
  "quality_rating": 5,
  "speed_rating": 4,
  "communication_rating": 5,
  "review_text": "Excellent photos, exactly what was needed."
}
```

**Response:**
```json
{
  "message": "Review submitted",
  "review_id": "rev_abc123"
}
```

**Logic:**
1. Verify job belongs to agent AND `status = 'completed'`
2. Check no existing review for this job
3. Insert into `reviews` with `reviewer_id = agent.id`
4. Update worker's aggregate rating:
   ```sql
   UPDATE users SET
     rating = (rating * rating_count + ?) / (rating_count + 1),
     rating_count = rating_count + 1
   WHERE id = ?
   ```

---

## 4. Schema Additions

```sql
-- Agents table (new)
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  callback_url TEXT,
  jobs_created INTEGER DEFAULT 0,
  jobs_completed INTEGER DEFAULT 0,
  total_spent_sats REAL DEFAULT 0.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Add escrow tracking to jobs (new column)
ALTER TABLE jobs ADD COLUMN escrow_hold_id TEXT;

-- Add rejection tracking (new column)
ALTER TABLE jobs ADD COLUMN rejection_count INTEGER DEFAULT 0;
ALTER TABLE jobs ADD COLUMN last_rejection_reason TEXT;
```

---

## 5. Job Status Flow (Updated)

```
                    ┌────────────────────────────────────────┐
                    │                                        │
  Agent creates     │   Worker      Worker      Worker       │  Agent
  POST /agent/jobs  │   accepts     starts      completes    │  reviews
       │            │      │          │            │          │    │
       ▼            │      ▼          ▼            ▼          │    ▼
   available ───────┼─► assigned ─► in_progress ─► submitted ─┼─► completed
       │            │                    ▲                    │
       │            │                    │                    │
       │            │              Agent rejects              │
       │            │           (keep_assigned=true)          │
       │            │                                        │
       │            └───────── Agent rejects ─────────────────┘
       │                    (keep_assigned=false)
       │
       ▼
   cancelled (by agent at any pre-submitted stage)
```

---

## 6. Env Additions

No new bindings needed. Existing `KEYKEEPER_API_URL` env var is already configured and will be used for:
- Agent key validation
- Escrow hold/release
- Balance checks

---

## 7. Implementation Priority

1. **agentAuth middleware** — gate everything else
2. **POST /agent/jobs** — without this, no jobs enter the system
3. **Fix POST /jobs/:id/complete** — remove auto-approve (small change, big impact)
4. **GET /agent/jobs + GET /agent/jobs/:id** — agent needs to see their jobs
5. **GET /agent/jobs/:id/deliverables** — agent needs to review work
6. **POST /agent/jobs/:id/approve** — release payment (moves money)
7. **POST /agent/jobs/:id/reject** — feedback loop
8. **POST /agent/jobs/:id/message + GET** — agent-worker communication
9. **POST /agent/jobs/:id/cancel** — cleanup
10. **POST /agent/jobs/:id/review** — quality signal
11. **POST /agent/register** — nice-to-have for tracking

---

## 8. Testing Checklist

- [ ] Agent can create a job and it appears in worker's `GET /jobs` feed
- [ ] Worker can accept, start, upload deliverables, and complete
- [ ] Job status stops at `submitted` (no auto-approve)
- [ ] Agent can view deliverables with working URLs
- [ ] Agent approve releases payment to worker wallet
- [ ] Agent reject with `keep_assigned=true` returns to `in_progress`
- [ ] Agent reject with `keep_assigned=false` returns to `available` pool
- [ ] Agent cancel releases escrow
- [ ] Messages flow both directions (agent↔worker)
- [ ] Invalid KlawKeeper keys get 401
- [ ] Agent can't approve/reject jobs they don't own
- [ ] Worker can't complete without deliverables
- [ ] Double-approve returns 409
