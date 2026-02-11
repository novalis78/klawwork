/**
 * Webhook dispatch utility
 * Fires events to agent callback URLs when job status changes
 */

import { Env } from '../index';
import { queryOne } from './db';

export type WebhookEvent =
  | 'job.created'
  | 'job.accepted'
  | 'job.started'
  | 'job.submitted'
  | 'job.completed'
  | 'job.rejected'
  | 'job.cancelled'
  | 'job.message'
  | 'deliverable.uploaded';

interface WebhookPayload {
  event: WebhookEvent;
  job_id: string;
  agent_id: string;
  timestamp: string;
  data: Record<string, any>;
}

/**
 * Fire a webhook to the agent's callback_url if configured.
 * Non-blocking — failures are logged but don't affect the caller.
 */
export async function fireWebhook(
  env: Env,
  agentId: string,
  event: WebhookEvent,
  jobId: string,
  data: Record<string, any> = {}
): Promise<void> {
  try {
    // Look up agent's callback URL
    const agent = await queryOne(
      env.DB,
      'SELECT callback_url FROM agents WHERE id = ?',
      [agentId]
    );

    if (!agent || !agent.callback_url) {
      return; // No callback configured — skip silently
    }

    const payload: WebhookPayload = {
      event,
      job_id: jobId,
      agent_id: agentId,
      timestamp: new Date().toISOString(),
      data,
    };

    const body = JSON.stringify(payload);

    // Generate HMAC signature for verification
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(agentId), // Use agent_id as HMAC key (agents know their own ID)
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const sigHex = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Fire and forget
    await fetch(agent.callback_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KeyWork-Event': event,
        'X-KeyWork-Signature': `sha256=${sigHex}`,
        'X-KeyWork-Job-Id': jobId,
      },
      body,
    });
  } catch (err: any) {
    // Never throw — webhooks are best-effort
    console.error(`Webhook failed [${event}] for agent ${agentId}:`, err.message);
  }
}
