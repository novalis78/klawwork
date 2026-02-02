# KlawWorker API

Cloudflare Workers API for the KlawWorker mobile application. Built with TypeScript, D1 Database, R2 Storage, and Durable Objects for WebSocket support.

## Features

- **Authentication**: JWT-based authentication with email/password and KlawKeeper integration
- **Jobs Management**: Location-based job discovery, acceptance, completion with deliverable uploads
- **Wallet**: Balance tracking, transaction history, withdrawal requests
- **Messages**: Real-time messaging between workers and AI agents
- **Verification**: Trust level system with document uploads (basic → verified → kyc_gold)
- **WebSocket**: Real-time updates for job status and new messages

## Architecture

- **Runtime**: Cloudflare Workers (edge computing)
- **Database**: D1 (SQLite at the edge)
- **Storage**: R2 (object storage for photos and documents)
- **Cache**: KV (session management)
- **Real-time**: Durable Objects (WebSocket connections)

## Setup

### Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Cloudflare account

### Installation

```bash
npm install
```

### Database Setup

1. Create D1 databases:
```bash
# Production
npx wrangler d1 create keywork-db

# Staging
npx wrangler d1 create keywork-db-staging
```

2. Update `wrangler.toml` with the database IDs returned from the commands above.

3. Run migrations:
```bash
# Production
npx wrangler d1 execute keywork-db --file=./schema.sql --env=production

# Staging
npx wrangler d1 execute keywork-db-staging --file=./schema.sql --env=staging
```

### R2 Storage Setup

1. Create R2 buckets:
```bash
# Production
npx wrangler r2 bucket create keywork-photos
npx wrangler r2 bucket create keywork-documents

# Staging
npx wrangler r2 bucket create keywork-photos-staging
npx wrangler r2 bucket create keywork-documents-staging
```

### KV Namespace Setup

1. Create KV namespaces:
```bash
# Production
npx wrangler kv:namespace create "SESSIONS"

# Staging
npx wrangler kv:namespace create "SESSIONS" --env=staging
```

2. Update `wrangler.toml` with the KV namespace IDs.

### Environment Variables

Update the `[vars]` section in `wrangler.toml`:

```toml
[vars]
ENVIRONMENT = "production"
JWT_SECRET = "your-secure-jwt-secret-here"
KEYKEEPER_API_URL = "https://klawkeeper.xyz/api"
```

**IMPORTANT**: Generate a strong JWT secret:
```bash
openssl rand -base64 32
```

## Development

Run the development server:

```bash
npm run dev
```

The API will be available at `http://localhost:8787`

## Deployment

### Staging

```bash
npm run deploy:staging
```

### Production

```bash
npm run deploy
```

## API Endpoints

### Public Endpoints

- `GET /health` - Health check
- `POST /auth/register` - Register new worker
- `POST /auth/login` - Login with email/password

### Protected Endpoints (require JWT)

#### Authentication
- `GET /auth/me` - Get current user profile
- `POST /auth/logout` - Logout

#### Jobs
- `GET /jobs` - Get available jobs (with location filtering)
- `GET /jobs/:id` - Get job details
- `POST /jobs/:id/accept` - Accept a job
- `POST /jobs/:id/start` - Start job
- `POST /jobs/:id/upload` - Upload deliverable photo
- `POST /jobs/:id/complete` - Complete job
- `GET /jobs/my/active` - Get user's active jobs
- `GET /jobs/my/completed` - Get user's completed jobs

#### Wallet
- `GET /wallet/balance` - Get wallet balance and stats
- `GET /wallet/transactions` - Get transaction history
- `POST /wallet/withdraw` - Request withdrawal

#### Messages
- `GET /messages` - Get all conversations
- `GET /messages/:jobId` - Get messages for a job
- `POST /messages/:jobId/send` - Send a message
- `GET /messages/unread/count` - Get unread count

#### Verification
- `GET /verification/status` - Get verification status
- `POST /verification/submit` - Submit verification documents

#### WebSocket
- `GET /ws` - WebSocket connection for real-time updates

## WebSocket Events

### Client → Server

```json
// Ping to keep connection alive
{"type": "ping"}

// Subscribe to job updates
{"type": "subscribe_job", "jobId": "job_xxx"}

// Unsubscribe from job updates
{"type": "unsubscribe_job", "jobId": "job_xxx"}
```

### Server → Client

```json
// Connection established
{"type": "connected", "message": "Connected to KlawWorker", "sessionId": "xxx"}

// Pong response
{"type": "pong", "timestamp": 1234567890}

// New job posted
{"type": "new_job", "data": {...}, "timestamp": 1234567890}

// Job status updated
{"type": "job_update", "data": {"jobId": "job_xxx", "status": "completed"}, "timestamp": 1234567890}

// New message received
{"type": "new_message", "data": {...}, "timestamp": 1234567890}
```

## Trust Level System

Workers progress through trust levels:

1. **basic** - Initial level, can access basic jobs
   - Cannot withdraw funds
   - Limited job categories

2. **verified** - Upload government ID + selfie
   - Can withdraw funds
   - Access to more job categories
   - Higher pay rates

3. **kyc_gold** - Complete KYC Gold verification
   - Access to premium jobs
   - Highest pay rates
   - Priority job matching
   - Highest withdrawal limits

## Database Schema

See `schema.sql` for the complete database structure.

Key tables:
- `users` - Worker profiles and stats
- `jobs` - Job listings and status
- `job_deliverables` - Photos/files uploaded for jobs
- `transactions` - Payment and withdrawal records
- `messages` - Messages between workers and agents
- `verification_documents` - KYC/verification uploads
- `reviews` - Job reviews and ratings
- `sessions` - Active JWT sessions

## Security

- JWT tokens for authentication
- Password hashing with SHA-256
- Trust level requirements for sensitive operations
- Session invalidation on logout
- CORS enabled for mobile app origins
- Rate limiting (recommended to add)

## Monitoring

View logs:
```bash
npx wrangler tail --env=production
```

## Contributing

1. Create feature branch
2. Make changes
3. Test locally with `npm run dev`
4. Deploy to staging: `npm run deploy:staging`
5. Test on staging
6. Deploy to production: `npm run deploy`

## License

Proprietary - KlawWork Inc.
