'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { BUILDING_EVENTS } from '@/lib/events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FloorState {
  id: string;
  floorNumber: number;
  name: string;
  description: string;
  successCondition: string;
  status:
    | 'pending'
    | 'researching'
    | 'building'
    | 'auditing'
    | 'live'
    | 'broken'
    | 'blocked';
  handoffNotes?: string;
  iterationCount: number;
}

export interface AgentActivity {
  agent: string;
  action: string;
  floorId?: string;
  iteration?: number;
  reason?: string;
  timestamp: Date;
}

export interface PendingExpansion {
  name: string;
  description: string;
  successCondition: string;
}

export interface BuildingState {
  goalId: string;
  goalText: string;
  buildingSummary: string;
  status: string;
  floors: FloorState[];
  latestActivity: AgentActivity[];
  isGoalMet: boolean;
  stevenSuggestions: string[];
  heartbeatActive: boolean;
  lastHeartbeatAt: Date | null;
  pendingExpansions: PendingExpansion[];
}

// ---------------------------------------------------------------------------
// Parse API response into BuildingState
// ---------------------------------------------------------------------------

interface ApiGoal {
  id: string;
  goalText: string;
  buildingSummary: string | null;
  status: string;
  [key: string]: unknown;
}

interface ApiFloor {
  id: string;
  floorNumber: number;
  name: string;
  description: string | null;
  successCondition: string;
  status: FloorState['status'];
  handoffNotes: string | null;
  iterationCount: number;
  [key: string]: unknown;
}

interface ApiLog {
  agentName: string;
  action: string;
  floorId?: string;
  iteration?: number;
  outputSummary?: string;
  timestamp: string;
  [key: string]: unknown;
}

interface ApiResponse {
  goal: ApiGoal;
  floors: ApiFloor[];
  recentLogs: ApiLog[];
  stevenSuggestions: string[];
  pendingExpansions?: PendingExpansion[];
}

function parseApiResponse(data: ApiResponse): BuildingState {
  return {
    goalId: data.goal.id,
    goalText: data.goal.goalText,
    buildingSummary: data.goal.buildingSummary ?? '',
    status: data.goal.status,
    floors: data.floors.map((f) => ({
      id: f.id,
      floorNumber: f.floorNumber,
      name: f.name,
      description: f.description ?? '',
      successCondition: f.successCondition,
      status: f.status,
      handoffNotes: f.handoffNotes ?? undefined,
      iterationCount: f.iterationCount,
    })),
    latestActivity: data.recentLogs.map((l) => ({
      agent: l.agentName,
      action: l.action,
      floorId: l.floorId,
      iteration: l.iteration,
      reason: l.outputSummary,
      timestamp: new Date(l.timestamp),
    })),
    isGoalMet: data.goal.status === 'goal_met',
    stevenSuggestions: data.stevenSuggestions ?? [],
    heartbeatActive: false, // updated via heartbeat fetch + socket
    lastHeartbeatAt: null,
    pendingExpansions: data.pendingExpansions ?? [],
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBuildingState(goalId: string) {
  const [building, setBuilding] = useState<BuildingState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Fetch building data from API
  const fetchBuilding = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch(`/api/goals/${goalId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data: ApiResponse = await res.json();
      setBuilding(parseApiResponse(data));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load building';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [goalId]);

  // Initial fetch
  useEffect(() => {
    fetchBuilding();
  }, [fetchBuilding]);

  // Fetch heartbeat status (separate endpoint, not included in goals API)
  useEffect(() => {
    if (!goalId) return;
    fetch(`/api/heartbeat/${goalId}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data?.status) return;
        setBuilding((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            heartbeatActive: data.status.active ?? false,
            lastHeartbeatAt: data.status.lastCheckedAt ? new Date(data.status.lastCheckedAt) : null,
          };
        });
      })
      .catch(() => { /* best-effort */ });
  }, [goalId]);

  // Socket.io real-time updates
  useEffect(() => {
    if (!goalId) return;

    const socket = io({
      path: '/api/socketio',
      query: { goalId },
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    socketRef.current = socket;

    // Floor status changed
    socket.on(BUILDING_EVENTS.FLOOR_STATUS, (payload: { floorId: string; status: FloorState['status'] }) => {
      setBuilding((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          floors: prev.floors.map((f) =>
            f.id === payload.floorId ? { ...f, status: payload.status } : f,
          ),
        };
      });
    });

    // Floor went live
    socket.on(BUILDING_EVENTS.FLOOR_LIVE, (payload: { floorId: string; handoffNotes?: string }) => {
      setBuilding((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          floors: prev.floors.map((f) =>
            f.id === payload.floorId
              ? { ...f, status: 'live' as const, handoffNotes: payload.handoffNotes }
              : f,
          ),
        };
      });
    });

    // Floor blocked
    socket.on(BUILDING_EVENTS.FLOOR_BLOCKED, (payload: { floorId: string }) => {
      setBuilding((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          floors: prev.floors.map((f) =>
            f.id === payload.floorId ? { ...f, status: 'blocked' as const } : f,
          ),
        };
      });
    });

    // Floor broken
    socket.on(BUILDING_EVENTS.FLOOR_BROKEN, (payload: { floorId: string }) => {
      setBuilding((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          floors: prev.floors.map((f) =>
            f.id === payload.floorId ? { ...f, status: 'broken' as const } : f,
          ),
        };
      });
    });

    // Floor healthy (from heartbeat)
    socket.on(BUILDING_EVENTS.FLOOR_HEALTHY, (payload: { floorId: string }) => {
      setBuilding((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          floors: prev.floors.map((f) =>
            f.id === payload.floorId ? { ...f, status: 'live' as const } : f,
          ),
        };
      });
    });

    // Agent action
    socket.on(
      BUILDING_EVENTS.AGENT_ACTION,
      (payload: { agent: string; action: string; floorId?: string; iteration?: number; reason?: string }) => {
        setBuilding((prev) => {
          if (!prev) return prev;
          const activity: AgentActivity = {
            agent: payload.agent,
            action: payload.action,
            floorId: payload.floorId,
            iteration: payload.iteration,
            reason: payload.reason,
            timestamp: new Date(),
          };
          return {
            ...prev,
            latestActivity: [activity, ...prev.latestActivity].slice(0, 50),
          };
        });
      },
    );

    // Goal met
    socket.on(BUILDING_EVENTS.GOAL_MET, () => {
      setBuilding((prev) => {
        if (!prev) return prev;
        return { ...prev, isGoalMet: true, status: 'goal_met' };
      });
    });

    // Building approved
    socket.on(BUILDING_EVENTS.APPROVED, () => {
      setBuilding((prev) => {
        if (!prev) return prev;
        return { ...prev, status: 'building' };
      });
    });

    // Heartbeat
    socket.on(
      BUILDING_EVENTS.HEARTBEAT,
      (payload: { active?: boolean; suggestion?: string }) => {
        setBuilding((prev) => {
          if (!prev) return prev;
          const suggestions = payload.suggestion
            ? [...prev.stevenSuggestions, payload.suggestion]
            : prev.stevenSuggestions;
          return {
            ...prev,
            heartbeatActive: payload.active ?? prev.heartbeatActive,
            lastHeartbeatAt: new Date(),
            stevenSuggestions: suggestions,
          };
        });
      },
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [goalId]);

  return { building, isLoading, error, refetch: fetchBuilding };
}
