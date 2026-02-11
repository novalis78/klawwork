/**
 * Rate limiting middleware
 * Uses D1 for sliding window counters per API key + endpoint category
 */

import { error } from 'itty-router';
import { Env } from '../index';

interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'worker_search': { maxRequests: 100, windowSeconds: 60 },
  'job_create':    { maxRequests: 20,  windowSeconds: 60 },
  'job_status':    { maxRequests: 200, windowSeconds: 60 },
  'messages':      { maxRequests: 50,  windowSeconds: 60 },
  'default':       { maxRequests: 120, windowSeconds: 60 },
};

/**
 * Get the rate limit category from the request path + method
 */
function getCategory(method: string, path: string): string {
  if (path.includes('/workers/search')) return 'worker_search';
  if (path.includes('/agent/jobs') && method === 'POST' && !path.includes('/')) return 'job_create';
  if (path.includes('/agent/jobs') && method === 'GET') return 'job_status';
  if (path.includes('/message')) return 'messages';
  return 'default';
}

/**
 * Extract the rate limit key (agent ID or user ID)
 */
function getKey(request: any): string {
  if (request.agent?.id) return `agent:${request.agent.id}`;
  if (request.user?.id) return `user:${request.user.id}`;
  // Fallback to IP
  return `ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
}

/**
 * Rate limit check using KV for fast lookups
 */
export async function rateLimitMiddleware(request: any): Promise<Response | void> {
  const env = request.env as Env;
  if (!env.SESSIONS) return; // KV not available — skip

  const key = getKey(request);
  const url = new URL(request.url);
  const category = getCategory(request.method, url.pathname);
  const config = RATE_LIMITS[category] || RATE_LIMITS.default;

  const windowKey = `rl:${key}:${category}`;

  try {
    const current = await env.SESSIONS.get(windowKey);
    const count = current ? parseInt(current) : 0;

    if (count >= config.maxRequests) {
      return new Response(
        JSON.stringify({
          status: 429,
          error: 'Rate limit exceeded',
          retry_after_seconds: config.windowSeconds,
          limit: config.maxRequests,
          window: `${config.windowSeconds}s`,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(config.windowSeconds),
            'X-RateLimit-Limit': String(config.maxRequests),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + config.windowSeconds),
          },
        }
      );
    }

    // Increment counter
    await env.SESSIONS.put(windowKey, String(count + 1), {
      expirationTtl: config.windowSeconds,
    });
  } catch (err: any) {
    // Rate limiting should never block requests on failure
    console.error('Rate limit error:', err.message);
  }
}
