/**
 * KeyWorker API - Cloudflare Workers
 * Main entry point and router
 */

import { Router, error, json } from 'itty-router';
import { authRouter } from './routes/auth';
import { jobsRouter } from './routes/jobs';
import { walletRouter } from './routes/wallet';
import { messagesRouter } from './routes/messages';
import { verificationRouter } from './routes/verification';
import { agentRouter } from './routes/agent';
import { workersRouter } from './routes/workers';
import { authMiddleware } from './middleware/auth';
import { agentAuthMiddleware } from './middleware/agentAuth';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { corsHeaders } from './utils/cors';

// Environment bindings type
export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  DOCUMENTS: R2Bucket;
  SESSIONS: KVNamespace;
  JOBS_ROOM: DurableObjectNamespace;
  JWT_SECRET: string;
  ENVIRONMENT: string;
  KEYKEEPER_API_URL: string;
}

// Create router
const router = Router();

// CORS preflight
router.options('*', () => new Response(null, { headers: corsHeaders }));

// Health check
router.get('/health', () => json({
  status: 'healthy',
  service: 'keywork-api',
  version: '2.0.0',
  timestamp: new Date().toISOString()
}));

// Public auth routes (no auth required)
router.post('/auth/register', authRouter.fetch);
router.post('/auth/login', authRouter.fetch);
router.post('/auth/password/*', authRouter.fetch);

// Protected auth routes (auth required)
router.get('/auth/me', authMiddleware, authRouter.fetch);
router.post('/auth/logout', authMiddleware, authRouter.fetch);

// Protected worker routes (JWT auth + rate limiting)
router.all('/jobs/*', authMiddleware, rateLimitMiddleware, jobsRouter.fetch);
router.all('/wallet/*', authMiddleware, rateLimitMiddleware, walletRouter.fetch);
router.all('/messages/*', authMiddleware, rateLimitMiddleware, messagesRouter.fetch);
router.all('/verification/*', authMiddleware, rateLimitMiddleware, verificationRouter.fetch);

// Agent routes (KlawKeeper API key auth + rate limiting)
router.all('/agent/*', agentAuthMiddleware, rateLimitMiddleware, agentRouter.fetch);

// Worker search (agent-facing, KlawKeeper auth + rate limiting)
router.all('/workers/*', agentAuthMiddleware, rateLimitMiddleware, workersRouter.fetch);

// WebSocket upgrade for real-time messaging
router.get('/ws', async (request, env: Env) => {
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return error(426, 'Expected WebSocket upgrade');
  }

  // Get Durable Object — use job ID for per-job rooms, or global
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId') || 'global';
  const id = env.JOBS_ROOM.idFromName(jobId);
  const stub = env.JOBS_ROOM.get(id);

  return stub.fetch(request);
});

// 404 handler
router.all('*', () => error(404, 'Not found'));

// Main worker fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Add env to request for middleware access
      (request as any).env = env;

      const response = await router.fetch(request, env, ctx);

      // Add CORS headers to response
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (err: any) {
      console.error('Unhandled error:', err);
      return json(
        { error: 'Internal server error', message: err.message },
        { status: 500, headers: corsHeaders }
      );
    }
  }
};

// Export Durable Object
export { JobsRoom } from './durable/jobs-room';
