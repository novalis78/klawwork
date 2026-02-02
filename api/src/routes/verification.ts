/**
 * Verification routes
 * GET /verification/status, POST /verification/submit
 */

import { Router, error, json } from 'itty-router';
import { Env } from '../index';
import { AuthenticatedRequest } from '../middleware/auth';
import { query, queryOne, execute } from '../utils/db';
import { generateId } from '../utils/auth';

export const verificationRouter = Router({ base: '/verification' });

// Get verification status
verificationRouter.get('/status', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;

    // Get user's current trust level
    const userProfile = await queryOne(
      env.DB,
      'SELECT trust_level FROM users WHERE id = ?',
      [user!.id]
    );

    // Get all verification documents
    const documents = await query(
      env.DB,
      `SELECT id, document_type, status, rejection_reason, submitted_at, reviewed_at
       FROM verification_documents
       WHERE user_id = ?
       ORDER BY submitted_at DESC`,
      [user!.id]
    );

    // Get pending verification if any
    const pendingVerification = await queryOne(
      env.DB,
      `SELECT * FROM verification_documents
       WHERE user_id = ? AND status = 'pending'
       ORDER BY submitted_at DESC
       LIMIT 1`,
      [user!.id]
    );

    return json({
      trust_level: userProfile?.trust_level || 'basic',
      status: pendingVerification ? 'pending' : 'none',
      documents,
      next_level: getNextTrustLevel(userProfile?.trust_level || 'basic'),
      requirements: getVerificationRequirements(userProfile?.trust_level || 'basic'),
    });
  } catch (err: any) {
    console.error('Get verification status error:', err);
    return error(500, err.message || 'Failed to fetch verification status');
  }
});

// Submit verification documents
verificationRouter.post('/submit', async (request: AuthenticatedRequest, env: Env) => {
  try {
    const { user } = request;

    // Parse multipart form data
    const formData = await request.formData();
    const documentType = formData.get('document_type') as string;
    const file = formData.get('file') as File;

    if (!documentType) {
      return error(400, 'Document type is required');
    }

    if (!file) {
      return error(400, 'Document file is required');
    }

    // Validate document type
    const validTypes = ['government_id', 'selfie', 'proof_of_address', 'kyc_gold'];
    if (!validTypes.includes(documentType)) {
      return error(400, 'Invalid document type');
    }

    // Check if user already has pending verification for this type
    const existingDoc = await queryOne(
      env.DB,
      `SELECT * FROM verification_documents
       WHERE user_id = ? AND document_type = ? AND status = 'pending'`,
      [user!.id, documentType]
    );

    if (existingDoc) {
      return error(400, 'You already have a pending verification for this document type');
    }

    // Upload file to R2
    const fileId = generateId('doc');
    const fileKey = `verification/${user!.id}/${fileId}-${file.name}`;

    await env.DOCUMENTS.put(fileKey, file.stream(), {
      httpMetadata: {
        contentType: file.type,
      },
      customMetadata: {
        userId: user!.id,
        documentType,
      },
    });

    // Create verification document record
    const docId = generateId('vrf');
    await execute(
      env.DB,
      `INSERT INTO verification_documents
       (id, user_id, document_type, file_url, file_size, mime_type, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [docId, user!.id, documentType, fileKey, file.size, file.type]
    );

    // Get the created document
    const document = await queryOne(
      env.DB,
      'SELECT * FROM verification_documents WHERE id = ?',
      [docId]
    );

    return json({
      message: 'Verification document submitted successfully',
      document,
      estimated_review_time: '1-3 business days',
    });
  } catch (err: any) {
    console.error('Submit verification error:', err);
    return error(500, err.message || 'Failed to submit verification');
  }
});

// Helper function to get next trust level
function getNextTrustLevel(currentLevel: string): string | null {
  const levels = {
    basic: 'verified',
    verified: 'kyc_gold',
    kyc_gold: null,
  };
  return levels[currentLevel] || null;
}

// Helper function to get verification requirements
function getVerificationRequirements(currentLevel: string): any {
  const requirements = {
    basic: {
      next_level: 'verified',
      required_documents: ['government_id', 'selfie'],
      description: 'Upload a government-issued ID and a selfie to get verified',
      benefits: [
        'Access to higher-paying jobs',
        'Ability to withdraw earnings',
        'Increased trust score',
      ],
    },
    verified: {
      next_level: 'kyc_gold',
      required_documents: ['proof_of_address', 'kyc_gold'],
      description: 'Complete KYC Gold verification for access to premium jobs',
      benefits: [
        'Access to premium jobs with highest pay',
        'Priority job matching',
        'Higher withdrawal limits',
        'Exclusive job categories',
      ],
    },
    kyc_gold: {
      next_level: null,
      required_documents: [],
      description: 'You have the highest trust level',
      benefits: ['All platform features unlocked'],
    },
  };

  return requirements[currentLevel] || requirements.basic;
}
