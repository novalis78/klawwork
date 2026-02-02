/**
 * Wallet routes
 * GET /wallet/balance, GET /wallet/transactions, POST /wallet/withdraw
 */

import { Router, error, json } from 'itty-router';
import { Env } from '../index';
import { AuthenticatedRequest } from '../middleware/auth';
import { query, queryOne, execute } from '../utils/db';
import { generateId } from '../utils/auth';

export const walletRouter = Router({ base: '/wallet' });

// Get wallet balance and stats
walletRouter.get('/balance', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;

    // Get user stats
    const userStats = await queryOne(
      env.DB,
      `SELECT total_earned, jobs_completed, rating, trust_level
       FROM users
       WHERE id = ?`,
      [user!.id]
    );

    if (!userStats) {
      return error(404, 'User not found');
    }

    // Get pending earnings (jobs submitted but not yet completed)
    const pendingEarnings = await queryOne(
      env.DB,
      `SELECT COALESCE(SUM(payment_amount), 0) as pending
       FROM jobs
       WHERE worker_id = ? AND status = 'submitted'`,
      [user!.id]
    );

    // Get available balance (completed jobs minus withdrawals)
    const withdrawals = await queryOne(
      env.DB,
      `SELECT COALESCE(SUM(amount), 0) as total_withdrawn
       FROM transactions
       WHERE user_id = ? AND type = 'withdrawal' AND status = 'completed'`,
      [user!.id]
    );

    const availableBalance = userStats.total_earned - (withdrawals?.total_withdrawn || 0);

    return json({
      balance: {
        available: availableBalance,
        pending: pendingEarnings?.pending || 0,
        total_earned: userStats.total_earned,
      },
      stats: {
        jobs_completed: userStats.jobs_completed,
        rating: userStats.rating,
        trust_level: userStats.trust_level,
      },
    });
  } catch (err: any) {
    console.error('Get balance error:', err);
    return error(500, err.message || 'Failed to fetch balance');
  }
});

// Get transaction history
walletRouter.get('/transactions', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const type = url.searchParams.get('type'); // 'job_payment', 'withdrawal', 'bonus'

    let sql = `
      SELECT
        t.*,
        j.title as job_title
      FROM transactions t
      LEFT JOIN jobs j ON t.job_id = j.id
      WHERE t.user_id = ?
    `;
    const params: any[] = [user!.id];

    if (type) {
      sql += ' AND t.type = ?';
      params.push(type);
    }

    sql += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const transactions = await query(env.DB, sql, params);

    // Get total count for pagination
    const countResult = await queryOne(
      env.DB,
      `SELECT COUNT(*) as total FROM transactions WHERE user_id = ?${type ? ' AND type = ?' : ''}`,
      type ? [user!.id, type] : [user!.id]
    );

    return json({
      transactions,
      pagination: {
        total: countResult?.total || 0,
        limit,
        offset,
      },
    });
  } catch (err: any) {
    console.error('Get transactions error:', err);
    return error(500, err.message || 'Failed to fetch transactions');
  }
});

// Request withdrawal
walletRouter.post('/withdraw', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;
    const { amount, currency, destination_address } = await request.json();

    // Validate inputs
    if (!amount || amount <= 0) {
      return error(400, 'Invalid withdrawal amount');
    }

    if (!currency) {
      return error(400, 'Currency is required');
    }

    if (!destination_address) {
      return error(400, 'Destination address is required');
    }

    // Check available balance
    const userStats = await queryOne(
      env.DB,
      'SELECT total_earned FROM users WHERE id = ?',
      [user!.id]
    );

    const withdrawals = await queryOne(
      env.DB,
      `SELECT COALESCE(SUM(amount), 0) as total_withdrawn
       FROM transactions
       WHERE user_id = ? AND type = 'withdrawal' AND status IN ('pending', 'completed')`,
      [user!.id]
    );

    const availableBalance = userStats.total_earned - (withdrawals?.total_withdrawn || 0);

    if (amount > availableBalance) {
      return error(400, 'Insufficient balance');
    }

    // Minimum withdrawal amount
    if (amount < 10) {
      return error(400, 'Minimum withdrawal amount is 10 USD');
    }

    // Check trust level for withdrawals
    const userProfile = await queryOne(
      env.DB,
      'SELECT trust_level FROM users WHERE id = ?',
      [user!.id]
    );

    if (userProfile?.trust_level === 'basic') {
      return error(403, 'You must verify your account before withdrawing funds');
    }

    // Create withdrawal transaction
    const transactionId = generateId('txn');
    await execute(
      env.DB,
      `INSERT INTO transactions
       (id, user_id, type, amount, currency, status, description, metadata)
       VALUES (?, ?, 'withdrawal', ?, ?, 'pending', ?, ?)`,
      [
        transactionId,
        user!.id,
        amount,
        currency,
        `Withdrawal to ${destination_address.substring(0, 10)}...`,
        JSON.stringify({ destination_address }),
      ]
    );

    // In production, this would trigger a background job to process the withdrawal
    // For now, we'll just return the pending transaction

    return json({
      message: 'Withdrawal request submitted',
      transaction: {
        id: transactionId,
        amount,
        currency,
        status: 'pending',
        estimated_completion: '1-3 business days',
      },
    });
  } catch (err: any) {
    console.error('Withdrawal error:', err);
    return error(500, err.message || 'Failed to process withdrawal');
  }
});
