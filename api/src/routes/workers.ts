/**
 * Worker search routes (agent-facing)
 * GET /workers/search — find workers by skills, location, trust level, rating
 */

import { Router, error, json } from 'itty-router';
import { Env } from '../index';
import { AgentRequest } from '../middleware/agentAuth';
import { query } from '../utils/db';

export const workersRouter = Router({ base: '/workers' });

const VALID_SKILLS = [
  'local-verify', 'photography', 'data-entry', 'research',
  'translation', 'writing', 'design', 'transcription',
  'customer-support', 'manual-testing', 'mystery-shopping',
  'delivery', 'inspection', 'data-collection',
];

// GET /workers/search
workersRouter.get('/search', async (request: AgentRequest, env: Env) => {
  try {
    const url = new URL(request.url);

    const skills = url.searchParams.get('skills'); // comma-separated
    const latitude = parseFloat(url.searchParams.get('latitude') || '0');
    const longitude = parseFloat(url.searchParams.get('longitude') || '0');
    const radiusKm = parseFloat(url.searchParams.get('radius_km') || '50');
    const minTrust = url.searchParams.get('min_trust') || 'basic';
    const minRating = parseFloat(url.searchParams.get('min_rating') || '0');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const radiusMeters = radiusKm * 1000;

    let sql = `
      SELECT
        u.id, u.name, u.bio, u.location, u.trust_level,
        u.rating, u.rating_count, u.jobs_completed, u.skills,
        u.available, u.last_active,
        (6371000 * acos(
          cos(radians(?)) * cos(radians(u.latitude)) *
          cos(radians(u.longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(u.latitude))
        )) as distance_m
      FROM users u
      WHERE u.available = 1
        AND u.latitude IS NOT NULL
        AND u.longitude IS NOT NULL
    `;

    const params: any[] = [latitude, longitude, latitude];

    // Trust level filter
    const trustLevels = ['basic', 'verified', 'kyc_gold'];
    const minTrustIdx = trustLevels.indexOf(minTrust);
    if (minTrustIdx > 0) {
      const allowed = trustLevels.slice(minTrustIdx).map(t => `'${t}'`).join(',');
      sql += ` AND u.trust_level IN (${allowed})`;
    }

    // Rating filter
    if (minRating > 0) {
      sql += ' AND u.rating >= ?';
      params.push(minRating);
    }

    // Skills filter (match any of the requested skills)
    if (skills) {
      const skillList = skills.split(',').map(s => s.trim().toLowerCase());
      const skillClauses = skillList.map(() => "u.skills LIKE ?");
      sql += ` AND (${skillClauses.join(' OR ')})`;
      skillList.forEach(s => params.push(`%${s}%`));
    }

    // Distance filter + sort
    if (latitude !== 0 || longitude !== 0) {
      sql += ' HAVING distance_m < ?';
      params.push(radiusMeters);
      sql += ' ORDER BY distance_m ASC';
    } else {
      sql += ' ORDER BY u.rating DESC, u.jobs_completed DESC';
    }

    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const workers = await query(env.DB, sql, params);

    // Shape response — don't expose internal fields
    const results = workers.map((w: any) => ({
      id: w.id,
      name: w.name,
      bio: w.bio,
      location: w.location,
      trust_level: w.trust_level,
      rating: w.rating,
      rating_count: w.rating_count,
      jobs_completed: w.jobs_completed,
      skills: w.skills ? w.skills.split(',').map((s: string) => s.trim()) : [],
      distance_km: w.distance_m ? Math.round(w.distance_m / 100) / 10 : null,
      last_active: w.last_active,
    }));

    return json({
      workers: results,
      count: results.length,
      filters: {
        skills: skills ? skills.split(',') : null,
        radius_km: radiusKm,
        min_trust: minTrust,
        min_rating: minRating,
      },
    });
  } catch (err: any) {
    console.error('Worker search error:', err);
    return error(500, err.message || 'Failed to search workers');
  }
});

// GET /workers/skills — list all valid skill tags
workersRouter.get('/skills', async (_request: AgentRequest, _env: Env) => {
  return json({ skills: VALID_SKILLS });
});
