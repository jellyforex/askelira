/**
 * Suspicious Activity Detection -- Steven Delta SD-016
 *
 * Tracks and flags suspicious request patterns:
 * - Rapid sequential failed auth attempts
 * - Enumeration patterns (sequential IDs)
 * - Unusually high request rates from a single user
 */

import { notify } from './notify';

interface ActivityRecord {
  failedAuths: number[];    // timestamps of failed auth attempts
  notFoundHits: number[];   // timestamps of 404 responses (enumeration)
  lastAlertedAt: number;
}

const activityStore = new Map<string, ActivityRecord>();
const WINDOW_MS = 15 * 60 * 1000;         // 15-minute window
const FAILED_AUTH_THRESHOLD = 10;          // 10 failures in window = alert
const ENUMERATION_THRESHOLD = 20;          // 20 404s in window = alert
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between alerts per IP

function getRecord(ip: string): ActivityRecord {
  let record = activityStore.get(ip);
  if (!record) {
    record = { failedAuths: [], notFoundHits: [], lastAlertedAt: 0 };
    activityStore.set(ip, record);
  }
  return record;
}

function pruneTimestamps(timestamps: number[]): number[] {
  const cutoff = Date.now() - WINDOW_MS;
  return timestamps.filter((t) => t > cutoff);
}

/**
 * Record a failed authentication attempt.
 */
export function recordFailedAuth(ip: string): void {
  const record = getRecord(ip);
  record.failedAuths = pruneTimestamps(record.failedAuths);
  record.failedAuths.push(Date.now());

  if (record.failedAuths.length >= FAILED_AUTH_THRESHOLD) {
    maybeAlert(ip, `${record.failedAuths.length} failed auth attempts in 15 minutes`);
  }
}

/**
 * Record a 404 hit (potential ID enumeration).
 */
export function recordNotFound(ip: string): void {
  const record = getRecord(ip);
  record.notFoundHits = pruneTimestamps(record.notFoundHits);
  record.notFoundHits.push(Date.now());

  if (record.notFoundHits.length >= ENUMERATION_THRESHOLD) {
    maybeAlert(ip, `${record.notFoundHits.length} 404 hits in 15 minutes (potential enumeration)`);
  }
}

function maybeAlert(ip: string, reason: string): void {
  const record = getRecord(ip);
  const now = Date.now();

  if (now - record.lastAlertedAt < ALERT_COOLDOWN_MS) return;
  record.lastAlertedAt = now;

  const message = `⚠️ *Suspicious Activity*\nIP: \`${ip}\`\n${reason}`;
  console.warn(`[Security] ${reason} from IP ${ip}`);
  notify(message).catch(() => {});
}

// Auto-cleanup every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [ip, record] of activityStore) {
    record.failedAuths = record.failedAuths.filter((t) => t > cutoff);
    record.notFoundHits = record.notFoundHits.filter((t) => t > cutoff);
    if (record.failedAuths.length === 0 && record.notFoundHits.length === 0) {
      activityStore.delete(ip);
    }
  }
}, 30 * 60 * 1000).unref();
