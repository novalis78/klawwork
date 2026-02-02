/**
 * Authentication routes
 * /auth/register, /auth/login, /auth/me
 */

import { Router, error, json } from 'itty-router';
import { Env } from '../index';
import { generateToken, hashPassword, verifyPassword, generateId } from '../utils/auth';
import { queryOne, execute } from '../utils/db';

export const authRouter = Router({ base: '/auth' });

// Register new worker
authRouter.post('/register', async (request: Request, env: Env) => {
  try {
    const body: any = await request.json();
    const { name, email, password } = body;

    // Validate input
    if (!name || !email || !password) {
      return error(400, 'Name, email, and password are required');
    }

    if (password.length < 6) {
      return error(400, 'Password must be at least 6 characters');
    }

    // Check if user exists
    const existing = await queryOne(
      env.DB,
      'SELECT id FROM users WHERE email = ?',
      [email.toLowerCase()]
    );

    if (existing) {
      return error(409, 'User with this email already exists');
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const userId = generateId('usr');
    await execute(
      env.DB,
      `INSERT INTO users (id, name, email, password_hash, trust_level)
       VALUES (?, ?, ?, ?, 'basic')`,
      [userId, name, email.toLowerCase(), passwordHash]
    );

    // Generate JWT token
    const token = await generateToken(
      {
        userId,
        email: email.toLowerCase(),
        exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // 30 days
      },
      env.JWT_SECRET
    );

    // Create session
    const sessionId = generateId('ses');
    await execute(
      env.DB,
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, datetime('now', '+30 days'))`,
      [sessionId, userId, await hashPassword(token)]
    );

    return json({
      success: true,
      message: 'Registration successful',
      token,
      user: {
        id: userId,
        name,
        email: email.toLowerCase(),
        trust_level: 'basic',
        isEmailVerified: false
      }
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    return error(500, err.message || 'Registration failed');
  }
});

// Login
authRouter.post('/login', async (request: Request, env: Env) => {
  try {
    const body: any = await request.json();
    const { email, password } = body;

    // Validate input
    if (!email || !password) {
      return error(400, 'Email and password are required');
    }

    // Find user
    const user = await queryOne(
      env.DB,
      `SELECT id, name, email, password_hash, trust_level, email_verified, phone_verified
       FROM users WHERE email = ?`,
      [email.toLowerCase()]
    );

    if (!user) {
      return error(401, 'Invalid email or password');
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return error(401, 'Invalid email or password');
    }

    // Generate JWT token
    const token = await generateToken(
      {
        userId: user.id,
        email: user.email,
        exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // 30 days
      },
      env.JWT_SECRET
    );

    // Create session
    const sessionId = generateId('ses');
    await execute(
      env.DB,
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, datetime('now', '+30 days'))`,
      [sessionId, user.id, await hashPassword(token)]
    );

    return json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        trust_level: user.trust_level,
        isEmailVerified: !!user.email_verified,
        isPhoneVerified: !!user.phone_verified,
        onboardingComplete: true
      }
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return error(500, err.message || 'Login failed');
  }
});

// Get current user
authRouter.get('/me', async (request: any, env: Env) => {
  try {
    const { user } = request;

    if (!user) {
      return error(401, 'Not authenticated');
    }

    // Fetch full user profile
    const profile = await queryOne(
      env.DB,
      `SELECT
        id, name, email, phone, trust_level, profile_image_url, bio,
        location, email_verified, phone_verified, keykeeper_verified,
        jobs_completed, total_earned, rating, rating_count,
        created_at
      FROM users WHERE id = ?`,
      [user.id]
    );

    if (!profile) {
      return error(404, 'User not found');
    }

    return json({ success: true, user: profile });
  } catch (err: any) {
    console.error('Me error:', err);
    return error(500, err.message || 'Failed to fetch user');
  }
});

// Password reset request
authRouter.post('/password/request-reset', async (request: Request, env: Env) => {
  try {
    const body: any = await request.json();
    const { email } = body;

    if (!email) {
      return error(400, 'Email is required');
    }

    // Check if user exists (don't reveal if they don't)
    const user = await queryOne(
      env.DB,
      'SELECT id FROM users WHERE email = ?',
      [email.toLowerCase()]
    );

    // Always return success to prevent email enumeration
    // In production, you would send an email here if user exists
    return json({
      success: true,
      message: 'If your email is in our system, you will receive a password reset code'
    });
  } catch (err: any) {
    console.error('Password reset error:', err);
    return error(500, 'Failed to process request');
  }
});

// Logout
authRouter.post('/logout', async (request: any, env: Env) => {
  try {
    const { user } = request;

    if (!user) {
      return error(401, 'Not authenticated');
    }

    // Get token from header
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.substring(7);

    if (token) {
      const tokenHash = await hashPassword(token);
      // Delete session
      await execute(
        env.DB,
        'DELETE FROM sessions WHERE token_hash = ?',
        [tokenHash]
      );
    }

    return json({ success: true, message: 'Logged out successfully' });
  } catch (err: any) {
    console.error('Logout error:', err);
    return error(500, 'Failed to logout');
  }
});
