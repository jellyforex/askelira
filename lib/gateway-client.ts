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

  private readonly config: Required<GatewayClientConfig>;

  // Metrics
  private metrics = {
    requestsViaGateway: 0,
    requestsViaDirectFallback: 0,
    gatewaySuccesses: 0,
    gatewayFailures: 0,
    totalLatencyMs: 0,
  };

  constructor(config: GatewayClientConfig) {
    super();
    this.config = {
      url: config.url,
      token: config.token,
      requestTimeoutMs: config.requestTimeoutMs ?? 300000,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 30000,
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
    if (this.connected || this.shuttingDown) return;

    return new Promise<void>((resolve, reject) => {
      const wsUrl = this.config.url;
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

      console.log(`[Gateway] Connected (sessionId=${this.sessionId})`);
      this.emit(GATEWAY_EVENTS?.GATEWAY_CONNECTED ?? 'gateway:connected', { sessionId: this.sessionId });
      notify(`🔗 Gateway *connected* (session: \`${this.sessionId}\`)`);

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
    const idempotencyKey = `${label}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    console.log(`[Gateway] Invoking ${label} via gateway...`);
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
      return responseText;
    } catch (err) {
      const duration = Date.now() - startTime;
      console.error(`[Gateway] ${label} failed via gateway (${duration}ms):`, err instanceof Error ? err.message : String(err));
      this.recordFailure();
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
          this.send({ type: 'req', id: this.generateId(), method: 'ping' } as unknown as GatewayMessage);
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

    console.log(`[Gateway] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})...`);
    this.emit('reconnecting', { delay, attempt: this.reconnectAttempts + 1 });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.connect();
      } catch (err) {
        console.error('[Gateway] Reconnect failed:', err instanceof Error ? err.message : String(err));
        this.reconnecting = false;
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
      notify(`🔴 Gateway *circuit breaker OPEN* — ${this.circuitBreaker.failures} failures, degraded for ${this.config.circuitBreakerCooldownMs / 1000}s`);
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

  getSessionId(): string | null {
    return this.sessionId;
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
