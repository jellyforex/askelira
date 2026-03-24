'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import gsap from 'gsap';
import { useBuildingState } from '@/hooks/useBuilding';
import FloorCard from '@/components/FloorCard';
import AgentTicker from '@/components/AgentTicker';
import StevenStatus from '@/components/StevenStatus';
import BuildingLoadingSkeleton from '@/components/BuildingLoadingSkeleton';
import BuildingError from '@/components/BuildingError';

// Phase 3: Dynamic imports for terminal and file browser (no SSR)
const WorkspaceTerminal = dynamic(
  () => import('@/components/WorkspaceTerminal'),
  { ssr: false },
);
const WorkspaceFileBrowser = dynamic(
  () => import('@/components/WorkspaceFileBrowser'),
  { ssr: false },
);
const AnimatedBuilding3D = dynamic(
  () => import('@/components/AnimatedBuilding3D'),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Status badge colors
// ---------------------------------------------------------------------------

const GOAL_STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  planning: { bg: 'rgba(107, 114, 128, 0.2)', color: '#9ca3af', label: 'Planning' },
  building: { bg: 'rgba(45, 212, 191, 0.15)', color: '#2dd4bf', label: 'Building' },
  goal_met: { bg: 'rgba(250, 204, 21, 0.15)', color: '#facc15', label: 'Complete' },
  blocked: { bg: 'rgba(248, 113, 113, 0.2)', color: '#f87171', label: 'Blocked' },
};

function getGoalStatusStyle(status: string) {
  return GOAL_STATUS_STYLES[status] ?? GOAL_STATUS_STYLES.planning;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function BuildingPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const goalId = params.goalId as string;
  const { building, isLoading, error, refetch } = useBuildingState(goalId);
  const bannerRef = useRef<HTMLDivElement>(null);
  const floorContainerRef = useRef<HTMLDivElement>(null);
  const prevGoalMet = useRef(false);
  const [showCheckoutBanner, setShowCheckoutBanner] = useState(false);
  const [pendingExpansions, setPendingExpansions] = useState<
    Array<{ name: string; description: string; successCondition: string }>
  >(building?.pendingExpansions ?? []);
  const [expandingFloor, setExpandingFloor] = useState<string | null>(null);

  // Phase 3: Terminal / file browser state
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [terminalMode, setTerminalMode] = useState<'full' | 'readonly' | null>(null);
  const [show3DView, setShow3DView] = useState(false);

  // Phase 3: Check terminal availability
  useEffect(() => {
    fetch('/api/terminal/available')
      .then((res) => res.json())
      .then((data: { available: boolean; mode: string }) => {
        setTerminalMode(data.mode as 'full' | 'readonly');
      })
      .catch(() => {
        setTerminalMode('readonly');
      });
  }, []);

  // Phase 9: Detect ?checkout=success and show banner
  useEffect(() => {
    if (searchParams.get('checkout') === 'success') {
      setShowCheckoutBanner(true);
      // Auto-dismiss after 5 seconds
      const timer = setTimeout(() => setShowCheckoutBanner(false), 5000);
      // Clean URL without reload
      window.history.replaceState({}, '', `/buildings/${goalId}`);
      return () => clearTimeout(timer);
    }
  }, [searchParams, goalId]);

  // Phase 10: Sync pending expansions from hook data
  useEffect(() => {
    if (building?.pendingExpansions && building.pendingExpansions.length > 0) {
      setPendingExpansions(building.pendingExpansions);
    }
  }, [building?.pendingExpansions]);

  const handleApproveExpansion = useCallback(
    async (expansion: { name: string; description: string; successCondition: string }) => {
      setExpandingFloor(expansion.name);
      try {
        await fetch(`/api/goals/${goalId}/expand`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(expansion),
        });
        setPendingExpansions((prev) => prev.filter((e) => e.name !== expansion.name));
        refetch();
      } catch {
        // best-effort
      } finally {
        setExpandingFloor(null);
      }
    },
    [goalId, refetch],
  );

  // Step 8: Goal completion animation
  useEffect(() => {
    if (!building?.isGoalMet || prevGoalMet.current) return;
    prevGoalMet.current = true;

    // Animate floor cards bottom to top
    if (floorContainerRef.current) {
      const cards = floorContainerRef.current.querySelectorAll('.floor-card');
      const reversed = Array.from(cards).reverse();

      gsap.fromTo(
        reversed,
        { scale: 0.95, opacity: 0.5 },
        {
          scale: 1,
          opacity: 1,
          duration: 0.4,
          stagger: 0.12,
          ease: 'power2.out',
        },
      );
    }

    // Reveal completion banner
    if (bannerRef.current) {
      gsap.fromTo(
        bannerRef.current,
        { opacity: 0, y: 20, scale: 0.95 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.6,
          delay: 0.8,
          ease: 'power3.out',
        },
      );
    }
  }, [building?.isGoalMet]);

  // ---- Loading ----
  if (isLoading) {
    return <BuildingLoadingSkeleton />;
  }

  // ---- Error ----
  if (error || !building) {
    return (
      <BuildingError
        message={error ?? 'Building not found'}
        onRetry={refetch}
      />
    );
  }

  // ---- Derived data ----
  const sortedFloors = [...building.floors].sort((a, b) => a.floorNumber - b.floorNumber);
  const liveFloorCount = sortedFloors.filter((f) => f.status === 'live').length;
  const activeFloorId =
    sortedFloors.find(
      (f) =>
        f.status === 'researching' ||
        f.status === 'building' ||
        f.status === 'auditing',
    )?.id ?? null;

  const statusStyle = getGoalStatusStyle(building.status);

  return (
    <div
      style={{
        maxWidth: '48rem',
        margin: '0 auto',
        padding: '2rem 1rem 4rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      {/* Phase 9: Checkout success banner */}
      {showCheckoutBanner && (
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(22, 163, 74, 0.12)',
            border: '1px solid rgba(22, 163, 74, 0.3)',
            borderRadius: '0.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ color: '#4ade80', fontSize: '0.875rem', fontWeight: 500 }}>
            Payment confirmed -- your building is starting now.
          </span>
          <button
            onClick={() => setShowCheckoutBanner(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#4ade80',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 600,
              padding: '0 0.25rem',
            }}
          >
            &#10005;
          </button>
        </div>
      )}

      {/* Goal header */}
      <div style={{ marginBottom: '0.5rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            marginBottom: '0.5rem',
          }}
        >
          <h1
            style={{
              fontSize: '1.375rem',
              fontWeight: 700,
              color: '#fff',
              flex: 1,
              lineHeight: 1.3,
            }}
          >
            {building.goalText}
          </h1>
          <span
            style={{
              fontSize: '0.6875rem',
              fontWeight: 600,
              padding: '0.25rem 0.75rem',
              borderRadius: '999px',
              background: statusStyle.bg,
              color: statusStyle.color,
              textTransform: 'uppercase',
              letterSpacing: '0.025em',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {statusStyle.label}
          </span>
        </div>

        {building.buildingSummary && (
          <p
            style={{
              fontSize: '0.875rem',
              color: '#9ca3af',
              lineHeight: 1.6,
            }}
          >
            {building.buildingSummary}
          </p>
        )}

        {/* Floor progress bar */}
        <div
          style={{
            marginTop: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <div
            style={{
              flex: 1,
              height: 4,
              background: 'var(--border)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${sortedFloors.length > 0 ? (liveFloorCount / sortedFloors.length) * 100 : 0}%`,
                background: 'var(--accent)',
                borderRadius: 2,
                transition: 'width 0.5s ease',
              }}
            />
          </div>
          <span style={{ fontSize: '0.6875rem', color: '#6b7280', whiteSpace: 'nowrap' }}>
            {liveFloorCount}/{sortedFloors.length} floors
          </span>
        </div>
      </div>

      {/* Steven status */}
      <StevenStatus
        heartbeatActive={building.heartbeatActive}
        lastHeartbeatAt={building.lastHeartbeatAt}
        liveFloors={liveFloorCount}
        suggestions={building.stevenSuggestions}
      />

      {/* Phase 10: Expansion suggestions */}
      {pendingExpansions.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          {pendingExpansions.map((expansion) => (
            <div
              key={expansion.name}
              style={{
                padding: '0.75rem 1rem',
                background: 'rgba(168, 85, 247, 0.08)',
                border: '1px solid rgba(168, 85, 247, 0.25)',
                borderRadius: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
              }}
            >
              <div style={{ flex: 1 }}>
                <span
                  style={{
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    color: '#a855f7',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Expansion Suggested
                </span>
                <p
                  style={{
                    fontSize: '0.875rem',
                    color: '#d1d5db',
                    margin: '0.25rem 0 0',
                    lineHeight: 1.4,
                  }}
                >
                  <strong style={{ color: '#e5e7eb' }}>{expansion.name}</strong>
                  {' -- '}
                  {expansion.description}
                </p>
              </div>
              <button
                onClick={() => handleApproveExpansion(expansion)}
                disabled={expandingFloor === expansion.name}
                style={{
                  padding: '0.375rem 0.75rem',
                  background: 'rgba(168, 85, 247, 0.2)',
                  border: '1px solid rgba(168, 85, 247, 0.4)',
                  borderRadius: '0.375rem',
                  color: '#a855f7',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: expandingFloor === expansion.name ? 'default' : 'pointer',
                  opacity: expandingFloor === expansion.name ? 0.5 : 1,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {expandingFloor === expansion.name ? 'Expanding...' : 'Approve'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 3D Building View Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
        <button
          onClick={() => setShow3DView(!show3DView)}
          style={{
            padding: '0.625rem 1.25rem',
            background: show3DView ? 'rgba(45, 212, 191, 0.15)' : 'rgba(157, 114, 255, 0.1)',
            border: show3DView ? '1px solid rgba(45, 212, 191, 0.4)' : '1px solid rgba(157, 114, 255, 0.3)',
            borderRadius: '0.5rem',
            color: show3DView ? '#2dd4bf' : '#9D72FF',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'all 0.2s',
          }}
        >
          <span style={{ fontSize: '1.125rem' }}>{show3DView ? '📋' : '🏢'}</span>
          {show3DView ? 'Show List View' : 'Show 3D Building'}
        </button>
      </div>

      {/* 3D Building Visualization */}
      {show3DView && (
        <AnimatedBuilding3D
          floors={sortedFloors}
          activities={building.latestActivity}
          goalId={goalId}
        />
      )}

      {/* Floor cards */}
      <div
        ref={floorContainerRef}
        style={{
          display: show3DView ? 'none' : 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        {sortedFloors.map((floor) => (
          <FloorCard
            key={floor.id}
            floor={floor}
            isActive={floor.id === activeFloorId}
          />
        ))}
      </div>

      {/* Agent ticker */}
      <AgentTicker activities={building.latestActivity} maxVisible={8} />

      {/* Phase 3: Workspace terminal / file browser */}
      {terminalMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button
            onClick={() => {
              if (terminalMode === 'full') {
                setTerminalOpen(!terminalOpen);
                setFileBrowserOpen(false);
              } else {
                setFileBrowserOpen(!fileBrowserOpen);
                setTerminalOpen(false);
              }
            }}
            style={{
              padding: '0.5rem 0.75rem',
              background: 'rgba(157, 114, 255, 0.1)',
              border: '1px solid rgba(157, 114, 255, 0.3)',
              borderRadius: '0.375rem',
              color: '#9D72FF',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              alignSelf: 'flex-start',
              transition: 'background 0.15s',
            }}
          >
            <span style={{ fontFamily: 'monospace' }}>
              {terminalMode === 'full' ? '>' : '#'}
            </span>
            {terminalMode === 'full'
              ? terminalOpen
                ? 'Close Terminal'
                : 'Open Terminal'
              : fileBrowserOpen
                ? 'Close Files'
                : 'View Files'}
          </button>

          {terminalOpen && terminalMode === 'full' && (
            <WorkspaceTerminal
              customerId={building.goalId}
              goalId={goalId}
              onClose={() => setTerminalOpen(false)}
            />
          )}

          {fileBrowserOpen && (
            <WorkspaceFileBrowser
              customerId={building.goalId}
              onClose={() => setFileBrowserOpen(false)}
            />
          )}
        </div>
      )}

      {/* Completion banner (hidden until isGoalMet) */}
      <div
        ref={bannerRef}
        style={{
          opacity: building.isGoalMet ? 1 : 0,
          pointerEvents: building.isGoalMet ? 'auto' : 'none',
          background: 'rgba(250, 204, 21, 0.08)',
          border: '1px solid rgba(250, 204, 21, 0.3)',
          borderRadius: '0.75rem',
          padding: '1.5rem',
          textAlign: 'center',
        }}
      >
        <h2
          style={{
            fontSize: '1.25rem',
            fontWeight: 700,
            color: '#facc15',
            marginBottom: '0.5rem',
          }}
        >
          Goal Complete
        </h2>
        <p style={{ fontSize: '0.875rem', color: '#d1d5db' }}>
          All {sortedFloors.length} floors are live. Your building is ready.
        </p>
      </div>
    </div>
  );
}
