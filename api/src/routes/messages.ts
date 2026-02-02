/**
 * Messages routes
 * GET /messages, GET /messages/:conversationId, POST /messages/:conversationId/send
 */

import { Router, error, json } from 'itty-router';
import { Env } from '../index';
import { AuthenticatedRequest } from '../middleware/auth';
import { query, queryOne, execute } from '../utils/db';
import { generateId } from '../utils/auth';

export const messagesRouter = Router({ base: '/messages' });

// Get all conversations for the user
messagesRouter.get('/', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;

    // Get all conversations (grouped by job or agent)
    const conversations = await query(
      env.DB,
      `SELECT
        m.job_id,
        m.agent_id,
        j.title as job_title,
        j.status as job_status,
        MAX(m.created_at) as last_message_at,
        COUNT(*) as message_count,
        SUM(CASE WHEN m.is_read = 0 AND m.sender_type = 'agent' THEN 1 ELSE 0 END) as unread_count
      FROM messages m
      LEFT JOIN jobs j ON m.job_id = j.id
      WHERE m.worker_id = ?
      GROUP BY m.job_id, m.agent_id
      ORDER BY last_message_at DESC`,
      [user!.id]
    );

    return json({ conversations });
  } catch (err: any) {
    console.error('Get conversations error:', err);
    return error(500, err.message || 'Failed to fetch conversations');
  }
});

// Get messages for a specific job
messagesRouter.get('/:jobId', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;
    const jobId = request.params?.jobId;
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const before = url.searchParams.get('before'); // Timestamp for pagination

    // Verify user has access to this job
    const job = await queryOne(
      env.DB,
      'SELECT * FROM jobs WHERE id = ? AND worker_id = ?',
      [jobId, user!.id]
    );

    if (!job) {
      return error(404, 'Job not found or not assigned to you');
    }

    // Get messages
    let sql = `
      SELECT *
      FROM messages
      WHERE job_id = ? AND worker_id = ?
    `;
    const params: any[] = [jobId, user!.id];

    if (before) {
      sql += ' AND created_at < ?';
      params.push(before);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const messages = await query(env.DB, sql, params);

    // Mark messages as read
    await execute(
      env.DB,
      `UPDATE messages
       SET is_read = 1
       WHERE job_id = ? AND worker_id = ? AND sender_type = 'agent' AND is_read = 0`,
      [jobId, user!.id]
    );

    // Reverse to show oldest first
    messages.reverse();

    return json({
      job: {
        id: job.id,
        title: job.title,
        status: job.status,
        agent_id: job.agent_id,
      },
      messages,
    });
  } catch (err: any) {
    console.error('Get messages error:', err);
    return error(500, err.message || 'Failed to fetch messages');
  }
});

// Send a message
messagesRouter.post('/:jobId/send', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;
    const jobId = request.params?.jobId;
    const { message, message_type = 'text' } = await request.json();

    if (!message || !message.trim()) {
      return error(400, 'Message content is required');
    }

    // Verify user has access to this job
    const job = await queryOne(
      env.DB,
      'SELECT * FROM jobs WHERE id = ? AND worker_id = ?',
      [jobId, user!.id]
    );

    if (!job) {
      return error(404, 'Job not found or not assigned to you');
    }

    // Create message
    const messageId = generateId('msg');
    await execute(
      env.DB,
      `INSERT INTO messages
       (id, job_id, agent_id, worker_id, sender_type, message, message_type)
       VALUES (?, ?, ?, ?, 'worker', ?, ?)`,
      [messageId, jobId, job.agent_id, user!.id, message, message_type]
    );

    const newMessage = await queryOne(
      env.DB,
      'SELECT * FROM messages WHERE id = ?',
      [messageId]
    );

    // In production, this would trigger a WebSocket event or push notification to the agent
    // For now, we'll just return the message

    return json({
      message: 'Message sent successfully',
      data: newMessage,
    });
  } catch (err: any) {
    console.error('Send message error:', err);
    return error(500, err.message || 'Failed to send message');
  }
});

// Get unread message count
messagesRouter.get('/unread/count', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;

    const result = await queryOne(
      env.DB,
      `SELECT COUNT(*) as unread_count
       FROM messages
       WHERE worker_id = ? AND sender_type = 'agent' AND is_read = 0`,
      [user!.id]
    );

    return json({
      unread_count: result?.unread_count || 0,
    });
  } catch (err: any) {
    console.error('Get unread count error:', err);
    return error(500, err.message || 'Failed to fetch unread count');
  }
});
