// ============================================================
// AskElira CLI — gateway command
// ============================================================
// Check OpenClaw gateway connection status.

import chalk from 'chalk';
import WebSocket from 'ws';
import * as auth from '../lib/auth';

/**
 * Check gateway connection status.
 * Attempts a WebSocket connect to the configured gateway URL.
 */
export async function gatewayStatusCommand(): Promise<void> {
  const url = auth.getGatewayUrl();
  const token = auth.getGatewayToken();
  const mode = auth.getGatewayMode();

  console.log('');
  console.log(chalk.bold('  Gateway Status'));
  console.log('');
  console.log(`  ${chalk.gray('URL:')}      ${url || chalk.yellow('(not configured)')}`);
  console.log(`  ${chalk.gray('Token:')}    ${token ? chalk.green('set') : chalk.yellow('not set')}`);
  console.log(`  ${chalk.gray('Mode:')}     ${mode}`);
  console.log('');

  if (!url) {
    console.log(`  ${chalk.yellow('No gateway URL configured.')}`);
    console.log(chalk.gray('  Set with: askelira config gateway --url ws://127.0.0.1:18789'));
    console.log('');
    return;
  }

  console.log(`  ${chalk.gray('Connecting...')}`);

  try {
    const result = await testGatewayConnection(url, token);

    if (result.connected) {
      console.log(`  ${chalk.green('Status:')}    ${chalk.green('CONNECTED')}`);
      console.log(`  ${chalk.gray('Latency:')}   ${result.latencyMs}ms`);
      if (result.sessionId) {
        console.log(`  ${chalk.gray('Session:')}   ${result.sessionId}`);
      }
    } else {
      console.log(`  ${chalk.red('Status:')}    ${chalk.red('UNREACHABLE')}`);
      if (result.error) {
        console.log(`  ${chalk.gray('Error:')}     ${result.error}`);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${chalk.red('Status:')}    ${chalk.red('ERROR')}`);
    console.log(`  ${chalk.gray('Error:')}     ${msg}`);
  }

  console.log('');
}

export interface GatewayTestResult {
  connected: boolean;
  latencyMs: number;
  sessionId?: string;
  error?: string;
}

export async function testGatewayConnection(url: string, token: string): Promise<GatewayTestResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const connectId = `status_${Date.now().toString(36)}`;

    const timeout = setTimeout(() => {
      ws.close();
      resolve({
        connected: false,
        latencyMs: Date.now() - startTime,
        error: 'Connection timeout (5s)',
      });
    }, 5000);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      clearTimeout(timeout);
      resolve({
        connected: false,
        latencyMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());

        // Step 1: gateway sends connect.challenge — reply with connect req
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          ws.send(JSON.stringify({
            type: 'req',
            id: connectId,
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: { id: 'gateway-client', version: 'internal', platform: 'node', mode: 'backend' },
              role: 'operator',
              scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'],
              auth: { token },
            },
          }));
          return;
        }

        // Step 2: gateway responds with res — connection succeeded
        if (msg.type === 'res' && msg.id === connectId) {
          clearTimeout(timeout);
          const result = msg.result || {};
          const latencyMs = Date.now() - startTime;
          ws.close(1000);
          resolve({
            connected: true,
            latencyMs,
            sessionId: result.sessionId || result.id,
          });
          return;
        }

        // Error response
        if ((msg.type === 'err' || msg.type === 'error') && msg.id === connectId) {
          clearTimeout(timeout);
          ws.close();
          resolve({
            connected: false,
            latencyMs: Date.now() - startTime,
            error: msg.error || msg.message || 'Connect rejected',
          });
          return;
        }
      } catch {
        clearTimeout(timeout);
        ws.close();
        resolve({
          connected: false,
          latencyMs: Date.now() - startTime,
          error: 'Invalid response from gateway',
        });
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        connected: false,
        latencyMs: Date.now() - startTime,
        error: err.message,
      });
    });

    ws.on('close', () => {
      clearTimeout(timeout);
    });
  });
}
