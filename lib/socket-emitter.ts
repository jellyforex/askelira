/**
 * Socket.io Event Emitter Utilities
 *
 * Helper functions to emit Socket.io events from API routes and server-side code.
 * Uses the global.io instance created by the custom server.
 */

import { BUILDING_EVENTS } from './events';
import type { Server as SocketIOServer } from 'socket.io';

// Extend global namespace for Socket.io instance
declare global {
  // eslint-disable-next-line no-var
  var io: SocketIOServer | undefined;
}

/**
 * Get the Socket.io server instance
 */
export function getIO(): SocketIOServer | null {
  if (typeof global !== 'undefined' && global.io) {
    return global.io;
  }
  return null;
}

/**
 * Emit an event to a specific building room
 */
export function emitToBuildingRoom(
  goalId: string,
  event: string,
  data: unknown
): void {
  const io = getIO();
  if (io) {
    const roomName = `building:${goalId}`;
    io.to(roomName).emit(event, data);
    console.log(`[Socket.io] Emitted ${event} to ${roomName}`, data);
  } else {
    console.warn('[Socket.io] IO instance not available, event not emitted:', event);
  }
}

// ---------------------------------------------------------------------------
// Building-specific event emitters
// ---------------------------------------------------------------------------

export interface FloorStatusPayload {
  floorId: string;
  status: 'pending' | 'researching' | 'building' | 'auditing' | 'live' | 'broken' | 'blocked';
}

export interface FloorLivePayload {
  floorId: string;
  handoffNotes?: string;
}

export interface AgentActionPayload {
  agent: string;
  action: string;
  floorId?: string;
  iteration?: number;
  reason?: string;
}

export interface HeartbeatPayload {
  active?: boolean;
  suggestion?: string;
}

/**
 * Emit floor status change event
 */
export function emitFloorStatus(goalId: string, payload: FloorStatusPayload): void {
  emitToBuildingRoom(goalId, BUILDING_EVENTS.FLOOR_STATUS, payload);
}

/**
 * Emit floor live event
 */
export function emitFloorLive(goalId: string, payload: FloorLivePayload): void {
  emitToBuildingRoom(goalId, BUILDING_EVENTS.FLOOR_LIVE, payload);
}

/**
 * Emit floor blocked event
 */
export function emitFloorBlocked(goalId: string, floorId: string): void {
  emitToBuildingRoom(goalId, BUILDING_EVENTS.FLOOR_BLOCKED, { floorId });
}

/**
 * Emit floor broken event
 */
export function emitFloorBroken(goalId: string, floorId: string): void {
  emitToBuildingRoom(goalId, BUILDING_EVENTS.FLOOR_BROKEN, { floorId });
}

/**
 * Emit floor healthy event
 */
export function emitFloorHealthy(goalId: string, floorId: string): void {
  emitToBuildingRoom(goalId, BUILDING_EVENTS.FLOOR_HEALTHY, { floorId });
}

/**
 * Emit agent action event
 */
export function emitAgentAction(goalId: string, payload: AgentActionPayload): void {
  emitToBuildingRoom(goalId, BUILDING_EVENTS.AGENT_ACTION, payload);
}

/**
 * Emit goal met event
 */
export function emitGoalMet(goalId: string): void {
  emitToBuildingRoom(goalId, BUILDING_EVENTS.GOAL_MET, {});
}

/**
 * Emit building approved event
 */
export function emitBuildingApproved(goalId: string): void {
  emitToBuildingRoom(goalId, BUILDING_EVENTS.APPROVED, {});
}

/**
 * Emit heartbeat event
 */
export function emitHeartbeat(goalId: string, payload: HeartbeatPayload): void {
  emitToBuildingRoom(goalId, BUILDING_EVENTS.HEARTBEAT, payload);
}

/**
 * Emit expansion suggested event
 */
export function emitExpansionSuggested(
  goalId: string,
  expansion: { name: string; description: string; successCondition: string }
): void {
  emitToBuildingRoom(goalId, BUILDING_EVENTS.EXPANSION_SUGGESTED, expansion);
}

// ---------------------------------------------------------------------------
// Agent movement tracking for 3D visualization
// ---------------------------------------------------------------------------

export interface AgentPositionPayload {
  agentId: string;
  agentName: string;
  currentFloor: number;
  targetFloor: number;
  action: string;
  color: string;
  timestamp: string;
}

/**
 * Emit agent position update for 3D visualization
 */
export function emitAgentPosition(goalId: string, payload: AgentPositionPayload): void {
  emitToBuildingRoom(goalId, 'agent:position', payload);
}

/**
 * Emit multiple agent positions at once
 */
export function emitAgentPositions(goalId: string, agents: AgentPositionPayload[]): void {
  emitToBuildingRoom(goalId, 'agents:positions', { agents, timestamp: new Date().toISOString() });
}
