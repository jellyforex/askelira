/**
 * OpenClaw Gateway WebSocket Client
 *
 * Full WebSocket client for OpenClaw gateway communication.
 * Implements connect handshake, request/response correlation,
 * circuit breaker pattern, auto-reconnect, and heartbeat ping.
 */

import { EventEmitter } from 'events';
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import { createPrivateKey, createPublicKey, sign } from 'crypto';
import WebSocket from 'ws';
import { GATEWAY_EVENTS } from './events';
import { notify } from './notify';

const PKG_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

// ============================================================
// Device identity helpers (Ed25519 signing for scope binding)
// ============================================================

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function b64url(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function derivePublicKeyRaw(pem: string): Buffer {
  const spki = createPublicKey(pem).export({ type: 'spki', format: 'der' });
  if (spki.length === ED25519_SPKI_PREFIX.length + 32
    && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

function loadDeviceIdentity(): DeviceIdentity | null {
  try {
    const devicePath = join(homedir(), '.openclaw', 'identity', 'device.json');
    if (!existsSync(devicePath)) return null;
    const raw = JSON.parse(readFileSync(devicePath, 'utf-8'));
    if (raw.deviceId && raw.publicKeyPem && raw.privateKeyPem) return raw;
    return null;
  } catch {
    return null;
  }
}

function buildDeviceAuth(
  device: DeviceIdentity,
  token: string,
  nonce: string,
  scopes: string[],
): { id: string; publicKey: string; signature: string; signedAt: number; nonce: string } {
  const signedAtMs = Date.now();
  const payload = ['v3', device.deviceId, 'cli', 'cli', 'operator', scopes.join(','), String(signedAtMs), token, nonce, process.platform, ''].join('|');
  const sig = sign(null, Buffer.from(payload, 'utf8'), createPrivateKey(device.privateKeyPem));
  return {
    id: device.deviceId,
    publicKey: b64url(derivePublicKeyRaw(device.publicKeyPem)),
    signature: b64url(sig),
    signedAt: signedAtMs,
    nonce,
  };
}

// ============================================================
// Types
// ============================================================

interface GatewayMessage {
  type: string;
  id?: string;
  [key: string]: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  sentAt: number;
}

interface CircuitBreakerState {
  failures: number;
  lastFailureAt: number;
  openUntil: number; // timestamp when circuit should close again
}

export interface GatewayClientConfig {
  url: string;
  token: string;
  requestTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  maxReconnectDelayMs?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerWindowMs?: number;
  circuitBreakerCooldownMs?: number;
}

export interface InvokeAgentParams {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  maxTokens?: number;
  tools?: unknown[];
  agentName?: string;
  timeoutMs?: number;
}

// ============================================================
// GatewayClient class
// ============================================================

export class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private connected = false;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private circuitBreaker: CircuitBreakerState = {
    failures: 0,
    lastFailureAt: 0,
    openUntil: 0,
  };
  private requestCounter = 0;
  private connectRequestId: string | null = null;
  private shuttingDown = false;
  private shouldReconnect = true;
  private agentListeners = new Map<string, (msg: any) => void>();

  // Gateway hardening: pong timeout + session tracking
  private lastPongAt = 0;
  private pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private previousSessionId: string | null = null;
  private connectStartedAt = 0;
  private static readonly PONG_TIMEOUT_MS = 5000;

  private readonly config: Required<GatewayClientConfig>;

  // Metrics
  private metrics = {
    requestsViaGateway: 0,
    requestsViaDirectFallback: 0,
    gatewaySuccesses: 0,
    gatewayFailures: 0,
    totalLatencyMs: 0,
  };

  // Feature 21: Per-agent timeout config
  private static readonly AGENT_TIMEOUTS: Record<string, number> = {
    alba: 180000,
    david: 300000,
    vex1: 120000,
    vex2: 120000,
    elira: 180000,
    steven: 120000,
  };

  // Feature 22: Session reuse tracking
  private activeSessions = new Map<string, string>();

  // Feature 23: Request deduplication
  private recentRequestHashes = new Map<string, { response: string; timestamp: number }>();
  private static readonly DEDUP_WINDOW_MS = 5000;

  // Feature 24: Latency monitoring (rolling window of last 10)
  private latencyWindow: number[] = [];
  private static readonly LATENCY_WINDOW_SIZE = 10;
  private static readonly LATENCY_ALERT_THRESHOLD_MS = 10000;

  constructor(config: GatewayClientConfig) {
    super();
    this.config = {
      url: config.url,
      token: config.token,
      requestTimeoutMs: config.requestTimeoutMs ?? 300000,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 15000,
      maxReconnectDelayMs: config.maxReconnectDelayMs ?? 30000,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 3,
      circuitBreakerWindowMs: config.circuitBreakerWindowMs ?? 60000,
      circuitBreakerCooldownMs: config.circuitBreakerCooldownMs ?? 300000,
    };
  }

  // ============================================================
  // Connection lifecycle
  // ============================================================

  async connect(): Promise<void> {
    if (this.connected) return;
    // Reset shutdown/reconnect flags so a fresh connect() always works,
    // even after a prior disconnect() or 1008 protocol violation.
    this.shuttingDown = false;
    this.shouldReconnect = true;

    return new Promise<void>((resolve, reject) => {
      const wsUrl = this.config.url;
      this.connectStartedAt = Date.now();
      console.log(`[Gateway] Connecting to ${wsUrl}...`);

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        console.error('[Gateway] Failed to create WebSocket:', err);
        reject(err);
        return;
      }

      const connectTimeout = setTimeout(() => {
        if (!this.connected) {
          this.ws?.close();
          reject(new Error('Gateway connection timeout'));
        }
      }, 10000);

      this.ws.on('open', () => {
        console.log('[Gateway] WebSocket open, waiting for challenge...');
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString()) as GatewayMessage;

          // Handle connect.challenge: send the connect req frame
          if (msg.type === 'event' && (msg as any).event === 'connect.challenge') {
            const connectId = this.generateId();
            this.connectRequestId = connectId;
            const challengeNonce = (msg as any).payload?.nonce as string;
            const scopes = ['operator.admin'];

            const connectParams: Record<string, unknown> = {
              minProtocol: 3,
              maxProtocol: 3,
              client: { id: 'cli', version: PKG_VERSION, platform: process.platform, mode: 'cli' },
              caps: [],
              role: 'operator',
              scopes,
              auth: { token: this.config.token },
            };

            // Attach device identity so the server binds scopes
            const deviceId = loadDeviceIdentity();
            if (deviceId && challengeNonce) {
              connectParams.device = buildDeviceAuth(deviceId, this.config.token, challengeNonce, scopes);
              console.log('[Gateway] Challenge received, sending connect req with device identity...');
            } else {
              console.log('[Gateway] Challenge received, sending connect req (no device identity)...');
            }

            this.send({
              type: 'req',
              id: connectId,
              method: 'connect',
              params: connectParams,
            } as unknown as GatewayMessage);
            return;
          }

          this.handleMessage(msg, resolve, clearTimeout.bind(null, connectTimeout));
        } catch (err) {
          console.error('[Gateway] Failed to parse message:', err);
        }
      });

      this.ws.on('close', (code, reason) => {
        const wasConnected = this.connected;
        this.connected = false;
        this.previousSessionId = this.sessionId;
        this.sessionId = null;
        this.stopHeartbeat();
        clearTimeout(connectTimeout);

        console.log(`[Gateway] Disconnected (code=${code}, reason=${reason?.toString() || 'none'})`);
        this.emit(GATEWAY_EVENTS?.GATEWAY_DISCONNECTED ?? 'gateway:disconnected', { code, reason: reason?.toString() });

        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(`Gateway disconnected (code=${code})`));
          this.pendingRequests.delete(id);
        }
        this.agentListeners.clear();

        // Code 1008 = protocol violation — reconnecting will never succeed
        // until the code is fixed. Do not attempt reconnect.
        if (code === 1008) {
          this.shouldReconnect = false;
          console.warn(`[Gateway] Protocol violation (1008) — reconnect suppressed`);
          return;
        }

        if (wasConnected && !this.shuttingDown) {
          this.scheduleReconnect();
        } else if (!wasConnected) {
          reject(new Error(`Gateway connection closed (code=${code})`));
        }
      });

      this.ws.on('pong', () => {
        this.lastPongAt = Date.now();
        if (this.pongTimeoutTimer) {
          clearTimeout(this.pongTimeoutTimer);
          this.pongTimeoutTimer = null;
        }
      });

      this.ws.on('error', (err) => {
        console.error('[Gateway] WebSocket error:', err.message);
        this.emit(GATEWAY_EVENTS?.GATEWAY_ERROR ?? 'gateway:error', { error: err.message });
        this.recordFailure();
      });
    });
  }

  disconnect(): void {
    this.shuttingDown = true;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Gateway client shutting down'));
      this.pendingRequests.delete(id);
    }

    if (this.ws) {
      this.ws.close(1000, 'Client shutdown');
      this.ws = null;
    }

    this.connected = false;
    this.sessionId = null;
  }

  // ============================================================
  // Message handling
  // ============================================================

  private handleMessage(
    msg: GatewayMessage,
    onConnect?: (value: void) => void,
    clearConnectTimeout?: () => void,
  ): void {
    // Handle connect response (type: 'res' with our connect request id)
    if (msg.type === 'res' && msg.id === this.connectRequestId) {
      this.connectRequestId = null;

      // Check for connect rejection (ok: false)
      if ((msg as any).ok === false) {
        const errMsg = (msg as any).error?.message || (msg as any).error || 'Connect rejected';
        console.error(`[Gateway] Connect rejected: ${errMsg}`);
        this.recordFailure();
        return;
      }

      const result = (msg as any).payload || (msg as any).result || {};
      this.sessionId = result.connId || result.sessionId || result.id || msg.id;
      this.connected = true;
      this.reconnectAttempts = 0;
      this.reconnecting = false;

      const connectLatencyMs = Date.now() - this.connectStartedAt;
      console.log(`[Gateway] Connected (sessionId=${this.sessionId}, latency=${connectLatencyMs}ms)`);
      if (this.previousSessionId) {
        console.log(`[Gateway] Session transition: ${this.previousSessionId} -> ${this.sessionId}`);
      }
      this.emit(GATEWAY_EVENTS?.GATEWAY_CONNECTED ?? 'gateway:connected', { sessionId: this.sessionId });
      notify(`🔗 AskElira online — gateway latency: ${connectLatencyMs}ms, session: \`${this.sessionId}\``);

      this.startHeartbeat();
      clearConnectTimeout?.();
      onConnect?.();
      return;
    }

    // Handle connect error response
    if (msg.type === 'err' && msg.id === this.connectRequestId) {
      this.connectRequestId = null;
      const error = (msg as any).error || (msg as any).message || 'Connect rejected';
      console.error(`[Gateway] Connect rejected: ${error}`);
      this.recordFailure();
      return;
    }

    // Handle pong / heartbeat response
    if (msg.type === 'pong' || (msg.type === 'res' && (msg as any).method === 'ping')) {
      this.lastPongAt = Date.now();
      if (this.pongTimeoutTimer) {
        clearTimeout(this.pongTimeoutTimer);
        this.pongTimeoutTimer = null;
      }
      return;
    }

    // Handle errors
    if (msg.type === 'error' || msg.type === 'err') {
      const errorMsg = (msg as any).error || msg.message || 'Unknown error';
      console.error('[Gateway] Server error:', errorMsg);
      if (msg.id && this.pendingRequests.has(msg.id)) {
        const pending = this.pendingRequests.get(msg.id)!;
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Gateway error: ${errorMsg}`));
        this.pendingRequests.delete(msg.id);
        this.recordFailure();
      }
      return;
    }

    // Handle multi-response agent calls (two responses on same ID)
    if (msg.type === 'res' && msg.id && this.agentListeners.has(msg.id)) {
      this.agentListeners.get(msg.id)!(msg);
      return;
    }

    // Handle response to a pending request
    if (msg.type === 'res' && msg.id && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(msg.id);

      // Check for error responses disguised as res frames (ok: false)
      const result = (msg as any).result || msg;
      if (result.ok === false || (msg as any).ok === false) {
        const errMsg = result.error?.message || result.error || (msg as any).error?.message || 'Request failed';
        console.error(`[Gateway] Request ${msg.id} returned ok:false — ${errMsg}`);
        this.recordFailure();
        pending.reject(new Error(`Gateway error: ${errMsg}`));
        return;
      }

      const latency = Date.now() - pending.sentAt;
      this.metrics.totalLatencyMs += latency;
      this.metrics.gatewaySuccesses++;
      this.resetCircuitBreaker();

      pending.resolve(msg);
      return;
    }

    // Handle async events from gateway (ignore silently)
    if (msg.type === 'event') {
      return;
    }

    // Unrecognized message
    console.log(`[Gateway] Unhandled message type: ${msg.type}`);
  }

  // ============================================================
  // Request/Response correlation
  // ============================================================

  private generateId(): string {
    return `req_${Date.now().toString(36)}_${(++this.requestCounter).toString(36)}`;
  }

  private sendRequest(msg: GatewayMessage): Promise<GatewayMessage> {
    const id = this.generateId();
    msg.id = id;
    if (!msg.type) msg.type = 'req';

    return new Promise<GatewayMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          this.recordFailure();
          reject(new Error(`Gateway request timeout (${this.config.requestTimeoutMs}ms)`));
        }
      }, this.config.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
        sentAt: Date.now(),
      });

      this.send(msg);
    });
  }

  private send(msg: GatewayMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Gateway WebSocket not connected');
    }
    this.ws.send(JSON.stringify(msg));
  }

  // ============================================================
  // Public API methods
  // ============================================================

  /**
   * High-level: invoke an agent via the OpenClaw gateway protocol.
   *
   * The gateway sends two responses on the same request ID:
   *   1. {ok: true, payload: {status: 'accepted'}}
   *   2. {ok: true/false, payload: {status: 'ok'/'error', result: {payloads: [{text}]}}}
   *
   * We listen for both and resolve when the final (completed/error) response arrives.
   */
  async invokeAgent(params: InvokeAgentParams): Promise<string> {
    const startTime = Date.now();
    const label = params.agentName || 'Agent';

    if (!this.isSessionActive()) {
      throw new Error(`[Gateway] No active session for ${label}. Status: ${this.getStatus()}`);
    }

    const idempotencyKey = `${label}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Feature 21: Use per-agent timeout if available
    const agentKey = label.toLowerCase().replace(/[^a-z0-9]/g, '');
    const perAgentTimeout = GatewayClient.AGENT_TIMEOUTS[agentKey];
    if (perAgentTimeout && !params.timeoutMs) {
      params.timeoutMs = perAgentTimeout;
    }

    // Feature 23: Request deduplication
    const requestHash = `${label}:${params.userMessage.slice(0, 200)}`;
    const cachedDedup = this.recentRequestHashes.get(requestHash);
    if (cachedDedup && Date.now() - cachedDedup.timestamp < GatewayClient.DEDUP_WINDOW_MS) {
      console.log(`[Gateway] Dedup hit for ${label}, returning cached response`);
      return cachedDedup.response;
    }

    console.log(`[Gateway] Invoking ${label} via gateway (timeout: ${params.timeoutMs || this.config.requestTimeoutMs}ms)...`);
    this.metrics.requestsViaGateway++;

    try {
      const reqId = this.generateId();
      const effectiveTimeout = params.timeoutMs ?? this.config.requestTimeoutMs;
      const responseText = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.agentListeners.delete(reqId);
          this.recordFailure();
          reject(new Error(`Gateway agent timeout (${effectiveTimeout}ms)`));
        }, effectiveTimeout);

        this.agentListeners.set(reqId, (msg: any) => {
          const payload = msg.payload || {};

          // First response: accepted — just log, keep waiting
          if (payload.status === 'accepted') {
            console.log(`[Gateway] ${label} accepted (runId=${payload.runId})`);
            return; // keep listening
          }

          // Final response: completed or error
          clearTimeout(timeout);
          this.agentListeners.delete(reqId);

          if (msg.ok === false || payload.status === 'error') {
            const errMsg = payload.summary || payload.error || msg.error?.message || 'Agent call failed';
            this.recordFailure();
            reject(new Error(`Gateway agent error: ${errMsg}`));
            return;
          }

          // Extract text from result.payloads[0].text
          const result = payload.result || {};
          const payloads = result.payloads || [];
          const text = payloads.map((p: any) => p.text).filter(Boolean).join('\n');
          this.metrics.gatewaySuccesses++;
          this.resetCircuitBreaker();
          resolve(text || JSON.stringify(payload));
        });

        // Prepend systemPrompt to message so the gateway agent sees format constraints
        const fullMessage = params.systemPrompt
          ? `[SYSTEM INSTRUCTIONS — follow exactly]\n${params.systemPrompt}\n\n[USER REQUEST]\n${params.userMessage}`
          : params.userMessage;

        this.send({
          type: 'req',
          id: reqId,
          method: 'agent',
          params: {
            message: fullMessage,
            idempotencyKey,
            agentId: 'main',
            channel: 'webchat',
          },
        } as unknown as GatewayMessage);
      });

      const duration = Date.now() - startTime;
      console.log(`[Gateway] ${label} complete via gateway (${duration}ms)`);

      // Feature 23: Cache response for dedup
      this.recentRequestHashes.set(requestHash, { response: responseText, timestamp: Date.now() });
      // Cleanup old entries
      for (const [key, val] of this.recentRequestHashes) {
        if (Date.now() - val.timestamp > GatewayClient.DEDUP_WINDOW_MS) {
          this.recentRequestHashes.delete(key);
        }
      }

      // Feature 24: Record latency and check rolling average
      this.latencyWindow.push(duration);
      if (this.latencyWindow.length > GatewayClient.LATENCY_WINDOW_SIZE) {
        this.latencyWindow.shift();
      }
      const avgLatency = this.latencyWindow.reduce((a, b) => a + b, 0) / this.latencyWindow.length;
      if (avgLatency > GatewayClient.LATENCY_ALERT_THRESHOLD_MS && this.latencyWindow.length >= 5) {
        console.warn(`[Gateway] HIGH LATENCY: Rolling avg ${Math.round(avgLatency)}ms exceeds ${GatewayClient.LATENCY_ALERT_THRESHOLD_MS}ms`);
        notify(`[Gateway] High latency alert: rolling avg ${Math.round(avgLatency)}ms`);
      }

      // Feature 22: Track session reuse
      this.activeSessions.set(label, this.sessionId || '');

      return responseText;
    } catch (err) {
      const duration = Date.now() - startTime;
      console.error(`[Gateway] ${label} failed via gateway (${duration}ms):`, err instanceof Error ? err.message : String(err));
      // [AUTO-ADDED] BUG-1-01: Do NOT call recordFailure() here.
      // The inner promise (timeout handler or error listener) already called
      // recordFailure(). Calling it again double-counts failures, tripping the
      // circuit breaker at half the configured threshold.
      throw err;
    }
  }

  // ============================================================
  // Heartbeat
  // ============================================================

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
        try {
          // Use WebSocket native ping instead of protocol-level 'ping' method
          // (OpenClaw gateway does not support method: 'ping')
          this.ws.ping();

          // Set pong timeout — if no pong in 5s, force-close to trigger reconnect
          this.pongTimeoutTimer = setTimeout(() => {
            console.warn(`[Gateway] Pong not received within ${GatewayClient.PONG_TIMEOUT_MS}ms — force-closing`);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close(4000, 'Pong timeout');
            }
          }, GatewayClient.PONG_TIMEOUT_MS);
        } catch {
          // Heartbeat failure handled by error/close events
        }
      }
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  // ============================================================
  // Auto-reconnect with exponential backoff
  // ============================================================

  private scheduleReconnect(): void {
    if (this.reconnecting || this.shuttingDown || !this.shouldReconnect) return;
    this.reconnecting = true;

    const baseDelay = 1000;
    const delay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempts),
      this.config.maxReconnectDelayMs,
    );

    // Feature 26: Log reconnect attempt number and seconds until next attempt
    console.log(`[Gateway] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts + 1}, next try at ${new Date(Date.now() + delay).toISOString()})`);
    this.emit('reconnecting', { delay, attempt: this.reconnectAttempts + 1 });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      // [AUTO-ADDED] BUG-1-06: Reset reconnecting flag BEFORE calling connect()
      // so the close handler's scheduleReconnect() call is not blocked if connect()
      // throws synchronously or the close event fires before the catch block.
      this.reconnecting = false;
      try {
        await this.connect();
      } catch (err) {
        console.error('[Gateway] Reconnect failed:', err instanceof Error ? err.message : String(err));
        this.scheduleReconnect();
      }
    }, delay);
  }

  // ============================================================
  // Circuit breaker
  // ============================================================

  private recordFailure(): void {
    const now = Date.now();

    // Reset if outside the window
    if (now - this.circuitBreaker.lastFailureAt > this.config.circuitBreakerWindowMs) {
      this.circuitBreaker.failures = 0;
    }

    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureAt = now;

    if (this.circuitBreaker.failures >= this.config.circuitBreakerThreshold) {
      this.circuitBreaker.openUntil = now + this.config.circuitBreakerCooldownMs;
      console.warn(`[Gateway] Circuit breaker OPEN — gateway degraded for ${this.config.circuitBreakerCooldownMs / 1000}s`);
      this.emit(GATEWAY_EVENTS?.GATEWAY_CIRCUIT_OPEN ?? 'gateway:circuit_open', {
        failures: this.circuitBreaker.failures,
        cooldownMs: this.config.circuitBreakerCooldownMs,
      });
      // Feature 25: Include which agent triggered circuit breaker
      const lastAgent = Array.from(this.activeSessions.keys()).pop() || 'unknown';
      notify(`Gateway *circuit breaker OPEN* -- ${this.circuitBreaker.failures} failures (last agent: ${lastAgent}), degraded for ${this.config.circuitBreakerCooldownMs / 1000}s`);
    }
  }

  private resetCircuitBreaker(): void {
    if (this.circuitBreaker.failures > 0) {
      const wasOpen = this.circuitBreaker.openUntil > Date.now();
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.openUntil = 0;
      if (wasOpen) {
        console.log('[Gateway] Circuit breaker RESET');
        this.emit(GATEWAY_EVENTS?.GATEWAY_CIRCUIT_RESET ?? 'gateway:circuit_reset');
      }
    }
  }

  // ============================================================
  // Health check
  // ============================================================

  isHealthy(): boolean {
    if (!this.connected) return false;
    if (Date.now() < this.circuitBreaker.openUntil) return false;
    return true;
  }

  isConnected(): boolean {
    return this.connected;
  }

  isDegraded(): boolean {
    return Date.now() < this.circuitBreaker.openUntil;
  }

  getStatus(): 'connected' | 'disconnected' | 'degraded' {
    if (!this.connected) return 'disconnected';
    if (this.isDegraded()) return 'degraded';
    return 'connected';
  }

  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  isSessionActive(): boolean {
    return this.connected && this.sessionId !== null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  // Feature 28: Cleanup stale sessions after build completes
  cleanupStaleSessions(): void {
    this.activeSessions.clear();
    // Cleanup old dedup entries
    for (const [key, val] of this.recentRequestHashes) {
      if (Date.now() - val.timestamp > GatewayClient.DEDUP_WINDOW_MS * 2) {
        this.recentRequestHashes.delete(key);
      }
    }
    console.log('[Gateway] Stale sessions cleaned up');
  }

  // Feature 30: Health info for health endpoint
  getHealthInfo(): {
    status: string;
    circuitBreaker: string;
    recentLatencyMs: number;
    sessionId: string | null;
    activeSessions: number;
    lastPongAt: number;
    sessionActive: boolean;
  } {
    const avgLatency = this.latencyWindow.length > 0
      ? Math.round(this.latencyWindow.reduce((a, b) => a + b, 0) / this.latencyWindow.length)
      : 0;
    return {
      status: this.getStatus(),
      circuitBreaker: this.isDegraded() ? 'open' : 'closed',
      recentLatencyMs: avgLatency,
      sessionId: this.sessionId,
      activeSessions: this.activeSessions.size,
      lastPongAt: this.lastPongAt,
      sessionActive: this.isSessionActive(),
    };
  }
}

// ============================================================
// Singleton access
// ============================================================

let gatewayClientInstance: GatewayClient | null = null;
let gatewayInitPromise: Promise<GatewayClient | null> | null = null;

/**
 * Get the singleton gateway client.
 * Lazy-initializes on first call. Returns null if OPENCLAW_GATEWAY_URL is not configured.
 */
export function getGatewayClient(): GatewayClient | null {
  const url = process.env.OPENCLAW_GATEWAY_URL;
  if (!url) return null;

  if (!gatewayClientInstance) {
    gatewayClientInstance = new GatewayClient({
      url,
      token: process.env.OPENCLAW_GATEWAY_TOKEN || '',
    });
  }

  return gatewayClientInstance;
}

/**
 * Connect the gateway client (if configured).
 * Safe to call multiple times — connects only once.
 */
export async function connectGateway(): Promise<GatewayClient | null> {
  const client = getGatewayClient();
  if (!client) return null;

  if (client.isConnected()) return client;

  if (!gatewayInitPromise) {
    gatewayInitPromise = client.connect()
      .then(() => client)
      .catch((err) => {
        console.error('[Gateway] Initial connection failed:', err instanceof Error ? err.message : String(err));
        gatewayInitPromise = null;
        return null;
      });
  }

  return gatewayInitPromise;
}

// ============================================================
// Graceful shutdown
// ============================================================

function gracefulShutdown(): void {
  if (gatewayClientInstance) {
    console.log('[Gateway] Graceful shutdown...');
    gatewayClientInstance.disconnect();
    gatewayClientInstance = null;
    gatewayInitPromise = null;
  }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
