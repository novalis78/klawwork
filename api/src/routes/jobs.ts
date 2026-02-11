/**
 * Jobs routes
 * GET /jobs, POST /jobs/:id/accept, POST /jobs/:id/complete, etc.
 */

import { Router, error, json } from 'itty-router';
import { Env } from '../index';
import { AuthenticatedRequest } from '../middleware/auth';
import { query, queryOne, execute } from '../utils/db';
import { generateId, calculateDistance } from '../utils/auth';

export const jobsRouter = Router({ base: '/jobs' });

// Get available jobs (with location filtering)
jobsRouter.get('/', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;
    const url = new URL(request.url);

    // Get query parameters
    const latitude = parseFloat(url.searchParams.get('latitude') || '0');
    const longitude = parseFloat(url.searchParams.get('longitude') || '0');
    const radius = parseFloat(url.searchParams.get('radius') || '10000'); // Default 10km
    const category = url.searchParams.get('category');

    let sql = `
      SELECT
        j.*,
        (6371000 * acos(
          cos(radians(?)) * cos(radians(j.latitude)) *
          cos(radians(j.longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(j.latitude))
        )) as distance
      FROM jobs j
      WHERE j.status = 'available'
        AND j.expires_at > datetime('now')
    `;

    const params: any[] = [latitude, longitude, latitude];

    // Filter by category
    if (category) {
      sql += ' AND j.category = ?';
      params.push(category);
    }

    // Filter by trust level (user must meet minimum requirement)
    sql += `
      AND (
        (j.required_trust_level = 'basic') OR
        (j.required_trust_level = 'verified' AND ? IN ('verified', 'kyc_gold')) OR
        (j.required_trust_level = 'kyc_gold' AND ? = 'kyc_gold')
      )
    `;
    params.push(user!.trust_level, user!.trust_level);

    sql += ' HAVING distance < ? ORDER BY distance ASC LIMIT 50';
    params.push(radius);

    const jobs = await query(env.DB, sql, params);

    return json({ jobs });
  } catch (err: any) {
    console.error('Get jobs error:', err);
    return error(500, err.message || 'Failed to fetch jobs');
  }
});

// Get job details
jobsRouter.get('/:id', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;
    const jobId = request.params?.id;

    const job = await queryOne(
      env.DB,
      `SELECT j.*, u.name as worker_name, u.rating as worker_rating
       FROM jobs j
       LEFT JOIN users u ON j.worker_id = u.id
       WHERE j.id = ?`,
      [jobId]
    );

    if (!job) {
      return error(404, 'Job not found');
    }

    // Get deliverables if job is assigned to user
    if (job.worker_id === user!.id) {
      const deliverables = await query(
        env.DB,
        'SELECT * FROM job_deliverables WHERE job_id = ?',
        [jobId]
      );
      (job as any).deliverables = deliverables;
    }

    return json({ job });
  } catch (err: any) {
    console.error('Get job error:', err);
    return error(500, err.message || 'Failed to fetch job');
  }
});

// Accept a job
jobsRouter.post('/:id/accept', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;
    const jobId = request.params?.id;

    // Check if job exists and is available
    const job = await queryOne(
      env.DB,
      'SELECT * FROM jobs WHERE id = ? AND status = ?',
      [jobId, 'available']
    );

    if (!job) {
      return error(404, 'Job not found or no longer available');
    }

    // Check trust level requirement
    const trustLevels = ['basic', 'verified', 'kyc_gold'];
    const userLevel = trustLevels.indexOf(user!.trust_level);
    const requiredLevel = trustLevels.indexOf(job.required_trust_level);

    if (userLevel < requiredLevel) {
      return error(403, 'Insufficient trust level for this job');
    }

    // Accept job
    await execute(
      env.DB,
      `UPDATE jobs
       SET status = 'assigned', worker_id = ?, assigned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [user!.id, jobId]
    );

    return json({
      message: 'Job accepted successfully',
      job: { ...job, status: 'assigned', worker_id: user!.id }
    });
  } catch (err: any) {
    console.error('Accept job error:', err);
    return error(500, err.message || 'Failed to accept job');
  }
});

// Start job
jobsRouter.post('/:id/start', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;
    const jobId = request.params?.id;

    // Check if job is assigned to user
    const job = await queryOne(
      env.DB,
      'SELECT * FROM jobs WHERE id = ? AND worker_id = ? AND status = ?',
      [jobId, user!.id, 'assigned']
    );

    if (!job) {
      return error(404, 'Job not found or not assigned to you');
    }

    // Start job
    await execute(
      env.DB,
      `UPDATE jobs
       SET status = 'in_progress', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [jobId]
    );

    return json({ message: 'Job started successfully' });
  } catch (err: any) {
    console.error('Start job error:', err);
    return error(500, err.message || 'Failed to start job');
  }
});

// Upload deliverable photo
jobsRouter.post('/:id/upload', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;
    const jobId = request.params?.id;

    // Check if job is assigned to user
    const job = await queryOne(
      env.DB,
      'SELECT * FROM jobs WHERE id = ? AND worker_id = ?',
      [jobId, user!.id]
    );

    if (!job) {
      return error(404, 'Job not found or not assigned to you');
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const caption = formData.get('caption') as string;

    if (!file) {
      return error(400, 'No file provided');
    }

    // Upload to R2
    const fileId = generateId('file');
    const fileKey = `jobs/${jobId}/${fileId}-${file.name}`;

    await env.PHOTOS.put(fileKey, file.stream(), {
      httpMetadata: {
        contentType: file.type,
      },
    });

    // Save deliverable record
    const deliverableId = generateId('del');
    await execute(
      env.DB,
      `INSERT INTO job_deliverables
       (id, job_id, worker_id, file_type, file_url, file_size, mime_type, caption)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        deliverableId,
        jobId,
        user!.id,
        'photo',
        fileKey,
        file.size,
        file.type,
        caption || null,
      ]
    );

    return json({
      message: 'File uploaded successfully',
      deliverable: {
        id: deliverableId,
        file_url: fileKey,
        caption,
      },
    });
  } catch (err: any) {
    console.error('Upload error:', err);
    return error(500, err.message || 'Failed to upload file');
  }
});

// Complete job
jobsRouter.post('/:id/complete', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;
    const jobId = request.params?.id;

    // Check if job is in progress by user
    const job = await queryOne(
      env.DB,
      'SELECT * FROM jobs WHERE id = ? AND worker_id = ? AND status = ?',
      [jobId, user!.id, 'in_progress']
    );

    if (!job) {
      return error(404, 'Job not found or not in progress');
    }

    // Check if required deliverables are uploaded
    const deliverables = await query(
      env.DB,
      'SELECT COUNT(*) as count FROM job_deliverables WHERE job_id = ?',
      [jobId]
    );

    if (!deliverables[0] || deliverables[0].count === 0) {
      return error(400, 'Please upload required deliverables first');
    }

    // Submit job for review
    await execute(
      env.DB,
      `UPDATE jobs
       SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [jobId]
    );

    // Job is now submitted for agent review
    // Payment is released when agent calls POST /agent/jobs/:id/approve

    return json({
      message: 'Job submitted for review',
      job_id: jobId,
      status: 'submitted',
    });
  } catch (err: any) {
    console.error('Complete job error:', err);
    return error(500, err.message || 'Failed to complete job');
  }
});

// Get user's active jobs
jobsRouter.get('/my/active', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;

    const jobs = await query(
      env.DB,
      `SELECT * FROM jobs
       WHERE worker_id = ? AND status IN ('assigned', 'in_progress', 'submitted')
       ORDER BY assigned_at DESC`,
      [user!.id]
    );

    return json({ jobs });
  } catch (err: any) {
    console.error('Get active jobs error:', err);
    return error(500, err.message || 'Failed to fetch active jobs');
  }
});

// Get user's completed jobs
jobsRouter.get('/my/completed', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;

    const jobs = await query(
      env.DB,
      `SELECT j.*, r.rating, r.review_text
       FROM jobs j
       LEFT JOIN reviews r ON j.id = r.job_id
       WHERE j.worker_id = ? AND j.status = 'completed'
       ORDER BY j.completed_at DESC
       LIMIT 50`,
      [user!.id]
    );

    return json({ jobs });
  } catch (err: any) {
    console.error('Get completed jobs error:', err);
    return error(500, err.message || 'Failed to fetch completed jobs');
  }
});
