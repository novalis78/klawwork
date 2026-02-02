/**
 * WebSocket Durable Object for real-time job and message updates
 * Handles WebSocket connections for workers to receive real-time notifications
 */

import { DurableObject } from 'cloudflare:workers';

interface WebSocketSession {
  webSocket: WebSocket;
  userId: string;
  lastPing: number;
}

export class JobsRoom extends DurableObject {
  private sessions: Map<string, WebSocketSession>;
  private pingInterval: number | null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sessions = new Map();
    this.pingInterval = null;
  }

  async fetch(request: Request): Promise<Response> {
    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 400 });
    }

    // Extract user ID from query params (sent after JWT validation)
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const token = url.searchParams.get('token');

    if (!userId || !token) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept WebSocket connection
    this.ctx.acceptWebSocket(server);

    // Store session
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      webSocket: server,
      userId,
      lastPing: Date.now(),
    });

    // Send welcome message
    server.send(
      JSON.stringify({
        type: 'connected',
        message: 'Connected to KeyWorker real-time updates',
        sessionId,
      })
    );

    // Start ping interval if not already running
    if (!this.pingInterval) {
      this.startPingInterval();
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      // Find session for this WebSocket
      let session: WebSocketSession | undefined;
      let sessionId: string | undefined;

      for (const [id, sess] of this.sessions.entries()) {
        if (sess.webSocket === ws) {
          session = sess;
          sessionId = id;
          break;
        }
      }

      if (!session || !sessionId) {
        ws.close(1011, 'Session not found');
        return;
      }

      // Parse message
      const data = typeof message === 'string' ? JSON.parse(message) : null;

      if (!data || !data.type) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        return;
      }

      // Handle different message types
      switch (data.type) {
        case 'ping':
          session.lastPing = Date.now();
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;

        case 'subscribe_job':
          // Subscribe to updates for a specific job
          await this.subscribeToJob(session, data.jobId);
          break;

        case 'unsubscribe_job':
          // Unsubscribe from job updates
          await this.unsubscribeFromJob(session, data.jobId);
          break;

        default:
          ws.send(
            JSON.stringify({
              type: 'error',
              message: `Unknown message type: ${data.type}`,
            })
          );
      }
    } catch (err: any) {
      console.error('WebSocket message error:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'Internal server error' }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    // Remove session when WebSocket closes
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.webSocket === ws) {
        this.sessions.delete(sessionId);
        console.log(`Session ${sessionId} closed: ${code} ${reason}`);
        break;
      }
    }

    // Stop ping interval if no more sessions
    if (this.sessions.size === 0 && this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  async webSocketError(ws: WebSocket, error: Error) {
    console.error('WebSocket error:', error);
    ws.close(1011, 'WebSocket error occurred');
  }

  // Broadcast a message to all connected users
  async broadcast(message: any, excludeUserId?: string) {
    const data = JSON.stringify(message);

    for (const session of this.sessions.values()) {
      if (excludeUserId && session.userId === excludeUserId) {
        continue;
      }

      try {
        session.webSocket.send(data);
      } catch (err) {
        console.error('Error broadcasting to session:', err);
      }
    }
  }

  // Send message to a specific user
  async sendToUser(userId: string, message: any) {
    const data = JSON.stringify(message);

    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        try {
          session.webSocket.send(data);
        } catch (err) {
          console.error('Error sending to user:', err);
        }
      }
    }
  }

  // Notify about new job posted
  async notifyNewJob(job: any) {
    await this.broadcast({
      type: 'new_job',
      data: job,
      timestamp: Date.now(),
    });
  }

  // Notify about job status change
  async notifyJobUpdate(jobId: string, status: string, workerId?: string) {
    const message = {
      type: 'job_update',
      data: {
        jobId,
        status,
      },
      timestamp: Date.now(),
    };

    if (workerId) {
      await this.sendToUser(workerId, message);
    } else {
      await this.broadcast(message);
    }
  }

  // Notify about new message
  async notifyNewMessage(message: any, recipientId: string) {
    await this.sendToUser(recipientId, {
      type: 'new_message',
      data: message,
      timestamp: Date.now(),
    });
  }

  // Subscribe to job updates
  private async subscribeToJob(session: WebSocketSession, jobId: string) {
    session.webSocket.send(
      JSON.stringify({
        type: 'subscribed',
        jobId,
        message: `Subscribed to updates for job ${jobId}`,
      })
    );
  }

  // Unsubscribe from job updates
  private async unsubscribeFromJob(session: WebSocketSession, jobId: string) {
    session.webSocket.send(
      JSON.stringify({
        type: 'unsubscribed',
        jobId,
        message: `Unsubscribed from updates for job ${jobId}`,
      })
    );
  }

  // Start interval to ping all connections
  private startPingInterval() {
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      const timeout = 60000; // 60 seconds

      for (const [sessionId, session] of this.sessions.entries()) {
        // Check if session is stale
        if (now - session.lastPing > timeout) {
          console.log(`Closing stale session ${sessionId}`);
          session.webSocket.close(1000, 'Session timeout');
          this.sessions.delete(sessionId);
        } else {
          // Send ping
          try {
            session.webSocket.send(
              JSON.stringify({ type: 'ping', timestamp: now })
            );
          } catch (err) {
            console.error('Error sending ping:', err);
            this.sessions.delete(sessionId);
          }
        }
      }
    }, 30000) as any; // Ping every 30 seconds
  }
}
