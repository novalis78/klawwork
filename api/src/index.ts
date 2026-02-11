/**
 * KlawWorker API - Cloudflare Workers
 * Main entry point and router
 */

import { Router, error, json } from 'itty-router';
import { authRouter } from './routes/auth';
import { jobsRouter } from './routes/jobs';
import { walletRouter } from './routes/wallet';
import { messagesRouter } from './routes/messages';
import { verificationRouter } from './routes/verification';
import { agentRouter } from './routes/agent';
import { authMiddleware } from './middleware/auth';
import { agentAuthMiddleware } from './middleware/agentAuth';
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
  timestamp: new Date().toISOString()
}));

// Public routes (no auth required)
router.all('/auth/*', authRouter.fetch);

// Protected routes (auth required)
router.all('/jobs/*', authMiddleware, jobsRouter.fetch);
router.all('/wallet/*', authMiddleware, walletRouter.fetch);
router.all('/messages/*', authMiddleware, messagesRouter.fetch);
router.all('/verification/*', authMiddleware, verificationRouter.fetch);

// Agent routes (KlawKeeper API key auth)
router.all('/agent/*', agentAuthMiddleware, agentRouter.fetch);

// WebSocket upgrade for real-time messaging
router.get('/ws', async (request, env: Env) => {
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return error(426, 'Expected WebSocket upgrade');
  }

  // Get Durable Object
  const id = env.JOBS_ROOM.idFromName('global');
  const stub = env.JOBS_ROOM.get(id);

  return stub.fetch(request);
});

// 404 handler
router.all('*', () => error(404, 'Not found'));

// Main worker fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      console.log('Incoming request:', request.method, request.url);

      // Add env to request for middleware access
      (request as any).env = env;

      // Call router with just the request
      console.log('Calling router...');
      const response = await router.fetch(request, env, ctx);
      console.log('Router returned:', response?.status);

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
