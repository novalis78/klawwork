/**
 * Agent authentication middleware
 * Validates KlawKeeper API keys (kk_...) against the KlawKeeper service
 */

import { error } from 'itty-router';
import { Env } from '../index';

export interface AgentRequest extends Request {
  agent?: {
    id: string;
    key_prefix: string;
    balance_sats: number;
  };
  params?: Record<string, string>;
  env?: Env;
}

export async function agentAuthMiddleware(request: AgentRequest): Promise<Response | void> {
  const env = (request as any).env as Env;

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer kk_')) {
    return error(401, 'Missing or invalid KlawKeeper API key');
  }

  const apiKey = authHeader.substring(7);

  try {
    // Validate key against KeyKeeper
    const kkResponse = await fetch(`${env.KEYKEEPER_API_URL}/v1/agent/balance`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!kkResponse.ok) {
      return error(401, 'Invalid or expired KlawKeeper API key');
    }

    const kkData: any = await kkResponse.json();

    request.agent = {
      id: kkData.user_id || kkData.email || apiKey.substring(3, 15),
      key_prefix: apiKey.substring(0, 11),
      balance_sats: kkData.credits || 0,
    };
  } catch (err: any) {
    console.error('Agent auth error:', err);
    return error(401, 'Failed to verify KlawKeeper API key');
  }
}
