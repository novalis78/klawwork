# KlawWorker API Deployment Guide

This guide walks you through deploying the KlawWorker API to Cloudflare Workers.

## Prerequisites

1. **Cloudflare Account**: Sign up at [cloudflare.com](https://cloudflare.com)
2. **Wrangler CLI**: Install globally
   ```bash
   npm install -g wrangler
   ```
3. **Login to Wrangler**:
   ```bash
   wrangler login
   ```

## Step 1: Create D1 Databases

Create databases for production and staging:

```bash
# Production database
wrangler d1 create keywork-db

# Staging database
wrangler d1 create keywork-db-staging
```

**Important**: Copy the `database_id` values from the output. You'll need them in the next step.

## Step 2: Update wrangler.toml

Open `wrangler.toml` and replace the placeholder database IDs:

```toml
# Replace this:
database_id = "YOUR_PRODUCTION_DB_ID"

# With your actual database ID:
database_id = "abc123-def456-ghi789"
```

Do this for both production and staging environments.

## Step 3: Run Database Migrations

Initialize the database schema:

```bash
# Production
wrangler d1 execute keywork-db --file=./schema.sql --env=production

# Staging
wrangler d1 execute keywork-db-staging --file=./schema.sql --env=staging
```

## Step 4: Create R2 Buckets

Create storage buckets for photos and verification documents:

```bash
# Production buckets
wrangler r2 bucket create keywork-photos
wrangler r2 bucket create keywork-documents

# Staging buckets
wrangler r2 bucket create keywork-photos-staging
wrangler r2 bucket create keywork-documents-staging
```

## Step 5: Create KV Namespaces

Create key-value stores for session management:

```bash
# Production KV
wrangler kv:namespace create "SESSIONS"

# Staging KV
wrangler kv:namespace create "SESSIONS" --env=staging
```

**Important**: Copy the namespace IDs from the output and update `wrangler.toml`:

```toml
# Replace this:
id = "YOUR_KV_ID"

# With your actual namespace ID:
id = "abc123def456ghi789"
```

## Step 6: Set Environment Variables

Generate a secure JWT secret:

```bash
openssl rand -base64 32
```

Update the `[vars]` section in `wrangler.toml`:

```toml
[vars]
ENVIRONMENT = "production"
JWT_SECRET = "paste-your-generated-secret-here"
KEYKEEPER_API_URL = "https://klawkeeper.xyz/api"
```

**Security Note**: Never commit real JWT secrets to version control. Consider using Wrangler secrets for production:

```bash
wrangler secret put JWT_SECRET --env=production
# Then paste your secret when prompted
```

## Step 7: Deploy to Staging

Test the deployment on staging first:

```bash
npm run deploy:staging
```

Wait for the deployment to complete. You should see output like:

```
✨ Successfully published your worker to
   https://keywork-api-staging.your-subdomain.workers.dev
```

## Step 8: Test Staging Deployment

Test the health endpoint:

```bash
curl https://api-staging.klawwork.xyz/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "keywork-api",
  "timestamp": "2024-01-15T12:00:00.000Z"
}
```

Test user registration:

```bash
curl -X POST https://api-staging.klawwork.xyz/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "password123"
  }'
```

## Step 9: Deploy to Production

Once staging tests pass, deploy to production:

```bash
npm run deploy
```

## Step 10: Configure DNS (Production Only)

In your Cloudflare dashboard:

1. Go to your domain `klawwork.xyz`
2. Click **DNS** > **Records**
3. The Worker routes should already be configured via `wrangler.toml`
4. Verify `api.klawwork.xyz` resolves correctly:
   ```bash
   curl https://api.klawwork.xyz/health
   ```

## Step 11: Update Mobile App

Update the mobile app's API configuration:

**File**: `keyworker.app/app/services/api.js`

```javascript
const API_CONFIG = {
  PRODUCTION: 'https://api.klawwork.xyz',
  DEVELOPMENT: 'https://api-staging.klawwork.xyz',
  FALLBACK: 'https://api.klawwork.xyz'
};
```

## Monitoring and Maintenance

### View Live Logs

```bash
# Production logs
wrangler tail --env=production

# Staging logs
wrangler tail --env=staging
```

### Update Database Schema

After making changes to `schema.sql`:

```bash
# Create a migration file with your changes
# Then apply it:
wrangler d1 execute keywork-db --file=./migrations/001_add_column.sql --env=production
```

### Rollback a Deployment

Cloudflare doesn't support automatic rollbacks, but you can:

1. Check out the previous commit
2. Run `npm run deploy` again

Or use version tags:

```bash
git checkout v1.0.0
npm run deploy
```

### Database Backup

Export your D1 database:

```bash
wrangler d1 export keywork-db --output=backup.sql --env=production
```

## Troubleshooting

### "Database not found"

Make sure the database IDs in `wrangler.toml` match the IDs from the create command.

### "Bucket not found"

Verify bucket names match exactly between `wrangler.toml` and the created buckets:

```bash
wrangler r2 bucket list
```

### "KV namespace not found"

Check that the KV namespace IDs in `wrangler.toml` are correct:

```bash
wrangler kv:namespace list
```

### CORS errors from mobile app

Check that the mobile app's origin is allowed in `src/utils/cors.ts`:

```typescript
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',  // Or specify your domain
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
```

### JWT token issues

Ensure the JWT_SECRET is the same across all environments and is stored securely:

```bash
# Set as a secret (recommended for production)
wrangler secret put JWT_SECRET --env=production
```

## Cost Estimates

Cloudflare Workers pricing (as of 2024):

- **Workers**: $5/month for 10M requests
- **D1**: $5/month for 5GB storage + 25M reads
- **R2**: $0.015/GB/month storage + $0.36/million reads
- **KV**: $0.50/million reads

Expected monthly costs for KlawWorker (1000 active users):
- Workers: ~$5
- D1: ~$5
- R2: ~$2
- KV: <$1
- **Total**: ~$13/month

Free tier should cover initial development and testing.

## Security Checklist

Before going to production:

- [ ] Change JWT_SECRET to a strong random value
- [ ] Store JWT_SECRET as a Wrangler secret (not in wrangler.toml)
- [ ] Set up rate limiting (consider using Cloudflare's Rate Limiting rules)
- [ ] Enable Cloudflare Web Application Firewall (WAF)
- [ ] Review CORS settings in `src/utils/cors.ts`
- [ ] Set up monitoring and alerts in Cloudflare dashboard
- [ ] Enable HTTPS only (should be automatic with Cloudflare)
- [ ] Review and limit R2 bucket permissions
- [ ] Set up backup strategy for D1 database

## Next Steps

1. Implement WebSocket connection in mobile app
2. Set up push notifications (FCM tokens in sessions table)
3. Implement rate limiting middleware
4. Add Sentry or similar error tracking
5. Set up CI/CD pipeline for automated deployments
6. Create admin dashboard for job management
7. Implement KlawKeeper wallet integration
