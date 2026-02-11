/**
 * Agent routes
 * POST /agent/register, POST /agent/jobs, GET /agent/jobs, etc.
 * Authenticated via KlawKeeper API keys (agentAuthMiddleware)
 */

import { Router, error, json } from 'itty-router';
import { Env } from '../index';
import { AgentRequest } from '../middleware/agentAuth';
import { query, queryOne, execute } from '../utils/db';
import { generateId } from '../utils/auth';

export const agentRouter = Router({ base: '/agent' });

const VALID_CATEGORIES = [
  'photo_survey', 'verification', 'transcription',
  'delivery', 'inspection', 'data_collection', 'other'
];

// ─── POST /agent/register ───────────────────────────────────────────────────
// Register agent's KlawKeeper account. Idempotent.
agentRouter.post('/register', async (request: AgentRequest, env: Env) => {
  try {
    const { agent } = request;
    const body: any = await request.json().catch(() => ({}));

    // Check if already registered
    const existing = await queryOne(
      env.DB,
      'SELECT * FROM agents WHERE id = ?',
      [agent!.id]
    );

    if (existing) {
      // Update callback_url if provided
      if (body.callback_url) {
        await execute(
          env.DB,
          'UPDATE agents SET callback_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [body.callback_url, agent!.id]
        );
        (existing as any).callback_url = body.callback_url;
      }
      return json({ agent: existing });
    }

    // Create new agent record
    await execute(
      env.DB,
      `INSERT INTO agents (id, callback_url) VALUES (?, ?)`,
      [agent!.id, body.callback_url || null]
    );

    const newAgent = await queryOne(
      env.DB,
      'SELECT * FROM agents WHERE id = ?',
      [agent!.id]
    );

    return json({ agent: newAgent }, { status: 201 });
  } catch (err: any) {
    console.error('Agent register error:', err);
    return error(500, err.message || 'Failed to register agent');
  }
});

// ─── POST /agent/jobs ───────────────────────────────────────────────────────
// Create a new job posting
agentRouter.post('/jobs', async (request: AgentRequest, env: Env) => {
  try {
    const { agent } = request;
    const body: any = await request.json();

    // Validate required fields
    if (!body.title || typeof body.title !== 'string' || body.title.length > 200) {
      return error(400, 'title is required (max 200 chars)');
    }
    if (!body.description || typeof body.description !== 'string' || body.description.length > 2000) {
      return error(400, 'description is required (max 2000 chars)');
    }
    if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
      return error(400, `category must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }
    if (typeof body.latitude !== 'number' || body.latitude < -90 || body.latitude > 90) {
      return error(400, 'Valid latitude is required (-90 to 90)');
    }
    if (typeof body.longitude !== 'number' || body.longitude < -180 || body.longitude > 180) {
      return error(400, 'Valid longitude is required (-180 to 180)');
    }
    if (typeof body.payment_amount !== 'number' || body.payment_amount < 1.0) {
      return error(400, 'payment_amount is required (min 1.00)');
    }
    if (!body.expires_at) {
      return error(400, 'expires_at is required');
    }

    const expiresAt = new Date(body.expires_at);
    if (isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      return error(400, 'expires_at must be a valid future datetime');
    }

    // Escrow: hold funds on agent's KlawKeeper balance
    let escrowHoldId: string | null = null;
    try {
      const escrowResponse = await fetch(`${env.KEYKEEPER_API_URL}/v1/escrow/hold`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': request.headers.get('Authorization')!,
        },
        body: JSON.stringify({
          amount_usd: body.payment_amount,
          reference: `klawwork_job_pending`,
          service: 'klawwork',
        }),
      });

      if (!escrowResponse.ok) {
        const escrowErr: any = await escrowResponse.json().catch(() => ({}));
        return error(402, escrowErr.message || 'Insufficient KlawKeeper balance to fund this job');
      }

      const escrowData: any = await escrowResponse.json();
      escrowHoldId = escrowData.hold_id;
    } catch (err: any) {
      console.error('Escrow hold error:', err);
      return error(502, 'Failed to communicate with KlawKeeper for escrow');
    }

    // Insert job
    const jobId = generateId('job');
    await execute(
      env.DB,
      `INSERT INTO jobs
       (id, agent_id, title, description, category,
        latitude, longitude, address, radius_meters,
        required_trust_level, required_deliverables, estimated_duration_minutes,
        payment_amount, payment_currency,
        status, expires_at, must_complete_by, escrow_hold_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?)`,
      [
        jobId,
        agent!.id,
        body.title,
        body.description,
        body.category,
        body.latitude,
        body.longitude,
        body.address || null,
        body.radius_meters || 100,
        body.required_trust_level || 'basic',
        body.required_deliverables ? JSON.stringify(body.required_deliverables) : null,
        body.estimated_duration_minutes || null,
        body.payment_amount,
        body.payment_currency || 'USD',
        body.expires_at,
        body.must_complete_by || null,
        escrowHoldId,
      ]
    );

    // Update agent stats
    await execute(
      env.DB,
      'UPDATE agents SET jobs_created = jobs_created + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [agent!.id]
    );

    const job = await queryOne(env.DB, 'SELECT * FROM jobs WHERE id = ?', [jobId]);

    return json({ job }, { status: 201 });
  } catch (err: any) {
    console.error('Create job error:', err);
    return error(500, err.message || 'Failed to create job');
  }
});

// ─── GET /agent/jobs ────────────────────────────────────────────────────────
// List agent's jobs with optional status filter
agentRouter.get('/jobs', async (request: AgentRequest, env: Env) => {
  try {
    const { agent } = request;
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    let sql = `
      SELECT j.*, u.name as worker_name, u.rating as worker_rating
      FROM jobs j
      LEFT JOIN users u ON j.worker_id = u.id
      WHERE j.agent_id = ?
    `;
    const params: any[] = [agent!.id];

    if (status) {
      sql += ' AND j.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY j.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const jobs = await query(env.DB, sql, params);

    // Get total count
    const countSql = status
      ? 'SELECT COUNT(*) as total FROM jobs WHERE agent_id = ? AND status = ?'
      : 'SELECT COUNT(*) as total FROM jobs WHERE agent_id = ?';
    const countParams = status ? [agent!.id, status] : [agent!.id];
    const countResult = await queryOne(env.DB, countSql, countParams);

    return json({
      jobs,
      pagination: { total: countResult?.total || 0, limit, offset },
    });
  } catch (err: any) {
    console.error('List agent jobs error:', err);
    return error(500, err.message || 'Failed to fetch jobs');
  }
});

// ─── GET /agent/jobs/:id ────────────────────────────────────────────────────
// Get full job details
agentRouter.get('/jobs/:id', async (request: AgentRequest, env: Env) => {
  try {
    const { agent } = request;
    const jobId = request.params?.id;

    const job = await queryOne(
      env.DB,
      `SELECT j.*, u.name as worker_name, u.rating as worker_rating,
              u.jobs_completed as worker_jobs_completed, u.trust_level as worker_trust_level
       FROM jobs j
       LEFT JOIN users u ON j.worker_id = u.id
       WHERE j.id = ? AND j.agent_id = ?`,
      [jobId, agent!.id]
    );

    if (!job) {
      return error(404, 'Job not found');
    }

    // Reshape worker info
    const result: any = { ...job };
    if (job.worker_id) {
      result.worker = {
        id: job.worker_id,
        name: job.worker_name,
        rating: job.worker_rating,
        jobs_completed: job.worker_jobs_completed,
        trust_level: job.worker_trust_level,
      };
    }
    delete result.worker_name;
    delete result.worker_rating;
    delete result.worker_jobs_completed;
    delete result.worker_trust_level;

    return json({ job: result });
  } catch (err: any) {
    console.error('Get agent job error:', err);
    return error(500, err.message || 'Failed to fetch job');
  }
});

// ─── GET /agent/jobs/:id/deliverables ───────────────────────────────────────
// Review worker uploads
agentRouter.get('/jobs/:id/deliverables', async (request: AgentRequest, env: Env) => {
  try {
    const { agent } = request;
    const jobId = request.params?.id;

    const job = await queryOne(
      env.DB,
      'SELECT id, status, required_deliverables FROM jobs WHERE id = ? AND agent_id = ?',
      [jobId, agent!.id]
    );

    if (!job) {
      return error(404, 'Job not found');
    }

    const deliverables = await query(
      env.DB,
      `SELECT id, file_type, file_url, file_size, mime_type, caption,
              latitude, longitude, created_at
       FROM job_deliverables
       WHERE job_id = ?
       ORDER BY created_at ASC`,
      [jobId]
    );

    // Generate accessible URLs for each deliverable
    const enriched = deliverables.map((d: any) => ({
      ...d,
      url: d.file_url, // In production, generate presigned R2 URL here
    }));

    return json({
      job_id: jobId,
      job_status: job.status,
      required_deliverables: job.required_deliverables
        ? JSON.parse(job.required_deliverables)
        : null,
      deliverables: enriched,
      deliverable_count: deliverables.length,
    });
  } catch (err: any) {
    console.error('Get deliverables error:', err);
    return error(500, err.message || 'Failed to fetch deliverables');
  }
});

// ─── POST /agent/jobs/:id/approve ───────────────────────────────────────────
// Approve submitted work, release escrow payment to worker
agentRouter.post('/jobs/:id/approve', async (request: AgentRequest, env: Env) => {
  try {
    const { agent } = request;
    const jobId = request.params?.id;
    const body: any = await request.json().catch(() => ({}));

    const job = await queryOne(
      env.DB,
      'SELECT * FROM jobs WHERE id = ? AND agent_id = ? AND status = ?',
      [jobId, agent!.id, 'submitted']
    );

    if (!job) {
      return error(404, 'Job not found or not in submitted status');
    }

    // Release escrow via KlawKeeper
    if (job.escrow_hold_id) {
      try {
        await fetch(`${env.KEYKEEPER_API_URL}/v1/escrow/release`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': request.headers.get('Authorization')!,
          },
          body: JSON.stringify({ hold_id: job.escrow_hold_id }),
        });
      } catch (err: any) {
        console.error('Escrow release error:', err);
        // Continue — don't block completion on escrow comms failure
      }
    }

    // Mark job completed
    await execute(
      env.DB,
      `UPDATE jobs
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [jobId]
    );

    // Create payment transaction for worker
    const transactionId = generateId('txn');
    await execute(
      env.DB,
      `INSERT INTO transactions
       (id, user_id, type, amount, currency, job_id, status, description)
       VALUES (?, ?, 'job_payment', ?, ?, ?, 'completed', ?)`,
      [
        transactionId,
        job.worker_id,
        job.payment_amount,
        job.payment_currency,
        jobId,
        `Payment for job: ${job.title}`,
      ]
    );

    // Handle optional tip
    let tipAmount = 0;
    if (body.tip_amount && body.tip_amount > 0) {
      tipAmount = body.tip_amount;
      const tipTxnId = generateId('txn');
      await execute(
        env.DB,
        `INSERT INTO transactions
         (id, user_id, type, amount, currency, job_id, status, description)
         VALUES (?, ?, 'bonus', ?, ?, ?, 'completed', ?)`,
        [
          tipTxnId,
          job.worker_id,
          tipAmount,
          body.tip_currency || job.payment_currency,
          jobId,
          `Tip for job: ${job.title}`,
        ]
      );
    }

    const totalPaid = job.payment_amount + tipAmount;

    // Update worker stats
    await execute(
      env.DB,
      `UPDATE users
       SET jobs_completed = jobs_completed + 1,
           total_earned = total_earned + ?
       WHERE id = ?`,
      [totalPaid, job.worker_id]
    );

    // Update agent stats
    await execute(
      env.DB,
      `UPDATE agents
       SET jobs_completed = jobs_completed + 1,
           total_spent_sats = total_spent_sats + ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [totalPaid, agent!.id]
    );

    return json({
      message: 'Job approved, payment released',
      job_id: jobId,
      payment: {
        base_amount: job.payment_amount,
        tip_amount: tipAmount,
        total: totalPaid,
        currency: job.payment_currency,
      },
    });
  } catch (err: any) {
    console.error('Approve job error:', err);
    return error(500, err.message || 'Failed to approve job');
  }
});

// ─── POST /agent/jobs/:id/reject ────────────────────────────────────────────
// Reject submitted work with feedback
agentRouter.post('/jobs/:id/reject', async (request: AgentRequest, env: Env) => {
  try {
    const { agent } = request;
    const jobId = request.params?.id;
    const body: any = await request.json();

    if (!body.reason || typeof body.reason !== 'string') {
      return error(400, 'reason is required');
    }

    const job = await queryOne(
      env.DB,
      'SELECT * FROM jobs WHERE id = ? AND agent_id = ? AND status = ?',
      [jobId, agent!.id, 'submitted']
    );

    if (!job) {
      return error(404, 'Job not found or not in submitted status');
    }

    const keepAssigned = body.keep_assigned !== false; // default true

    if (keepAssigned) {
      // Send back to same worker
      await execute(
        env.DB,
        `UPDATE jobs
         SET status = 'in_progress',
             submitted_at = NULL,
             rejection_count = COALESCE(rejection_count, 0) + 1,
             last_rejection_reason = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [body.reason, jobId]
      );
    } else {
      // Release back to pool
      await execute(
        env.DB,
        `UPDATE jobs
         SET status = 'available',
             worker_id = NULL,
             assigned_at = NULL,
             started_at = NULL,
             submitted_at = NULL,
             rejection_count = COALESCE(rejection_count, 0) + 1,
             last_rejection_reason = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [body.reason, jobId]
      );

      // Clean up deliverables from R2 + DB
      const deliverables = await query(
        env.DB,
        'SELECT file_url FROM job_deliverables WHERE job_id = ?',
        [jobId]
      );
      for (const d of deliverables) {
        try { await env.PHOTOS.delete((d as any).file_url); } catch {}
      }
      await execute(
        env.DB,
        'DELETE FROM job_deliverables WHERE job_id = ?',
        [jobId]
      );
    }

    // Send rejection message to worker
    if (job.worker_id) {
      const msgId = generateId('msg');
      await execute(
        env.DB,
        `INSERT INTO messages
         (id, job_id, agent_id, worker_id, sender_type, message, message_type)
         VALUES (?, ?, ?, ?, 'agent', ?, 'system')`,
        [msgId, jobId, agent!.id, job.worker_id, `Job rejected: ${body.reason}`]
      );
    }

    return json({
      message: keepAssigned ? 'Job sent back for revision' : 'Job released back to pool',
      job_id: jobId,
      new_status: keepAssigned ? 'in_progress' : 'available',
    });
  } catch (err: any) {
    console.error('Reject job error:', err);
    return error(500, err.message || 'Failed to reject job');
  }
});

// ─── POST /agent/jobs/:id/cancel ────────────────────────────────────────────
// Cancel a job with refund
agentRouter.post('/jobs/:id/cancel', async (request: AgentRequest, env: Env) => {
  try {
    const { agent } = request;
    const jobId = request.params?.id;
    const body: any = await request.json().catch(() => ({}));

    const job = await queryOne(
      env.DB,
      'SELECT * FROM jobs WHERE id = ? AND agent_id = ?',
      [jobId, agent!.id]
    );

    if (!job) {
      return error(404, 'Job not found');
    }

    if (job.status === 'submitted') {
      return error(409, 'Cannot cancel a submitted job — approve or reject it first');
    }
    if (job.status === 'completed') {
      return error(409, 'Cannot cancel a completed job');
    }
    if (job.status === 'cancelled') {
      return error(409, 'Job is already cancelled');
    }

    // Determine refund amount based on status
    let refundPercent = 100;
    if (job.status === 'in_progress') {
      refundPercent = 50; // Worker gets 50% for time spent
    }

    // Release/void escrow
    if (job.escrow_hold_id) {
      try {
        await fetch(`${env.KEYKEEPER_API_URL}/v1/escrow/void`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': request.headers.get('Authorization')!,
          },
          body: JSON.stringify({
            hold_id: job.escrow_hold_id,
            refund_percent: refundPercent,
          }),
        });
      } catch (err: any) {
        console.error('Escrow void error:', err);
      }
    }

    // If worker was in progress, compensate them
    if (job.status === 'in_progress' && job.worker_id) {
      const compensation = job.payment_amount * 0.5;
      const txnId = generateId('txn');
      await execute(
        env.DB,
        `INSERT INTO transactions
         (id, user_id, type, amount, currency, job_id, status, description)
         VALUES (?, ?, 'job_payment', ?, ?, ?, 'completed', ?)`,
        [
          txnId,
          job.worker_id,
          compensation,
          job.payment_currency,
          jobId,
          `Cancellation compensation for job: ${job.title}`,
        ]
      );
      await execute(
        env.DB,
        'UPDATE users SET total_earned = total_earned + ? WHERE id = ?',
        [compensation, job.worker_id]
      );
    }

    // Cancel the job
    await execute(
      env.DB,
      `UPDATE jobs
       SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [jobId]
    );

    // Notify worker if assigned
    if (job.worker_id) {
      const msgId = generateId('msg');
      await execute(
        env.DB,
        `INSERT INTO messages
         (id, job_id, agent_id, worker_id, sender_type, message, message_type)
         VALUES (?, ?, ?, ?, 'agent', ?, 'system')`,
        [
          msgId, jobId, agent!.id, job.worker_id,
          `Job cancelled by agent${body.reason ? ': ' + body.reason : ''}`,
        ]
      );
    }

    return json({
      message: 'Job cancelled',
      job_id: jobId,
      refund: {
        percent: refundPercent,
        amount: job.payment_amount * (refundPercent / 100),
        status: 'refunded',
      },
    });
  } catch (err: any) {
    console.error('Cancel job error:', err);
    return error(500, err.message || 'Failed to cancel job');
  }
});

// ─── POST /agent/jobs/:id/message ───────────────────────────────────────────
// Send message to assigned worker
agentRouter.post('/jobs/:id/message', async (request: AgentRequest, env: Env) => {
  try {
    const { agent } = request;
    const jobId = request.params?.id;
    const body: any = await request.json();

    if (!body.message || !body.message.trim()) {
      return error(400, 'message is required');
    }

    const job = await queryOne(
      env.DB,
      'SELECT id, agent_id, worker_id FROM jobs WHERE id = ? AND agent_id = ?',
      [jobId, agent!.id]
    );

    if (!job) {
      return error(404, 'Job not found');
    }
    if (!job.worker_id) {
      return error(400, 'No worker assigned to this job yet');
    }

    const msgId = generateId('msg');
    await execute(
      env.DB,
      `INSERT INTO messages
       (id, job_id, agent_id, worker_id, sender_type, message, message_type)
       VALUES (?, ?, ?, ?, 'agent', ?, ?)`,
      [msgId, jobId, agent!.id, job.worker_id, body.message, body.message_type || 'text']
    );

    const newMessage = await queryOne(
      env.DB,
      'SELECT * FROM messages WHERE id = ?',
      [msgId]
    );

    return json({ message: 'Message sent', data: newMessage });
  } catch (err: any) {
    console.error('Agent send message error:', err);
    return error(500, err.message || 'Failed to send message');
  }
});

// ─── GET /agent/jobs/:id/messages ───────────────────────────────────────────
// Get message thread for a job
agentRouter.get('/jobs/:id/messages', async (request: AgentRequest, env: Env) => {
  try {
    const { agent } = request;
    const jobId = request.params?.id;
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const before = url.searchParams.get('before');

    const job = await queryOne(
      env.DB,
      `SELECT j.id, j.title, j.status, j.worker_id, u.name as worker_name
       FROM jobs j
       LEFT JOIN users u ON j.worker_id = u.id
       WHERE j.id = ? AND j.agent_id = ?`,
      [jobId, agent!.id]
    );

    if (!job) {
      return error(404, 'Job not found');
    }

    let sql = 'SELECT * FROM messages WHERE job_id = ? AND agent_id = ?';
    const params: any[] = [jobId, agent!.id];

    if (before) {
      sql += ' AND created_at < ?';
      params.push(before);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const messages = await query(env.DB, sql, params);

    // Mark worker messages as read
    await execute(
      env.DB,
      `UPDATE messages
       SET is_read = 1, read_at = CURRENT_TIMESTAMP
       WHERE job_id = ? AND agent_id = ? AND sender_type = 'worker' AND is_read = 0`,
      [jobId, agent!.id]
    );

    messages.reverse();

    return json({
      job: {
        id: job.id,
        title: job.title,
        status: job.status,
        worker_name: job.worker_name,
      },
      messages,
    });
  } catch (err: any) {
    console.error('Get agent messages error:', err);
    return error(500, err.message || 'Failed to fetch messages');
  }
});

// ─── POST /agent/jobs/:id/review ────────────────────────────────────────────
// Rate a worker after job completion
agentRouter.post('/jobs/:id/review', async (request: AgentRequest, env: Env) => {
  try {
    const { agent } = request;
    const jobId = request.params?.id;
    const body: any = await request.json();

    if (!body.rating || body.rating < 1 || body.rating > 5) {
      return error(400, 'rating is required (1-5)');
    }

    const job = await queryOne(
      env.DB,
      'SELECT * FROM jobs WHERE id = ? AND agent_id = ? AND status = ?',
      [jobId, agent!.id, 'completed']
    );

    if (!job) {
      return error(404, 'Job not found or not completed');
    }

    // Check for existing review
    const existing = await queryOne(
      env.DB,
      'SELECT id FROM reviews WHERE job_id = ?',
      [jobId]
    );

    if (existing) {
      return error(409, 'Review already submitted for this job');
    }

    const reviewId = generateId('rev');
    await execute(
      env.DB,
      `INSERT INTO reviews
       (id, job_id, reviewer_id, worker_id, rating,
        quality_rating, speed_rating, communication_rating, review_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reviewId,
        jobId,
        agent!.id,
        job.worker_id,
        body.rating,
        body.quality_rating || null,
        body.speed_rating || null,
        body.communication_rating || null,
        body.review_text || null,
      ]
    );

    // Update worker aggregate rating
    await execute(
      env.DB,
      `UPDATE users
       SET rating = (rating * rating_count + ?) / (rating_count + 1),
           rating_count = rating_count + 1
       WHERE id = ?`,
      [body.rating, job.worker_id]
    );

    return json({ message: 'Review submitted', review_id: reviewId });
  } catch (err: any) {
    console.error('Submit review error:', err);
    return error(500, err.message || 'Failed to submit review');
  }
});
