/**
 * Authentication middleware
 * Verifies JWT tokens and attaches user to request
 */

import { error } from 'itty-router';
import { Env } from '../index';
import { verifyToken } from '../utils/auth';
import { queryOne } from '../utils/db';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    trust_level: string;
  };
  env?: Env;
}

export async function authMiddleware(request: AuthenticatedRequest): Promise<Response | void> {
  const env = (request as any).env as Env;

  // Extract token from Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return error(401, 'Missing or invalid authorization header');
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    // Verify JWT token
    const payload = await verifyToken(token, env.JWT_SECRET);

    // Fetch user from database
    const user = await queryOne(
      env.DB,
      'SELECT id, email, name, trust_level FROM users WHERE id = ?',
      [payload.userId]
    );

    if (!user) {
      return error(401, 'User not found');
    }

    // Attach user to request
    request.user = user as any;

    // Update last active timestamp
    await env.DB.prepare(
      'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?'
    )
      .bind(user.id)
      .run();
  } catch (err: any) {
    console.error('Auth error:', err);
    return error(401, err.message || 'Invalid token');
  }
}
