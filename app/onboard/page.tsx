'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import gsap from 'gsap';
import dynamic from 'next/dynamic';
import StepIndicator from '@/components/StepIndicator';

// ---------------------------------------------------------------------------
// Dynamic import of Three.js building (SSR-safe)
// ---------------------------------------------------------------------------

const BlueprintBuilding = dynamic(
  () => import('@/components/BlueprintBuilding'),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: '280px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(ellipse at center, #0f1729 0%, #0A0E27 100%)',
          borderRadius: '0.75rem',
          border: '1px solid rgba(99, 102, 241, 0.15)',
        }}
      >
        <span
          style={{
            color: '#6b7280',
            fontSize: '0.875rem',
            fontFamily: 'monospace',
          }}
        >
          Loading 3D...
        </span>
      </div>
    ),
  },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CustomerContext {
  industry: string;
  existingTools: string[];
  deliveryMethod: string;
  frequency: string;
  email: string;
  changes?: string;
}

interface FloorPlanFloor {
  id: string;
  floorNumber: number;
  name: string;
  description: string;
  successCondition: string;
}

interface FloorPlanResult {
  goalId: string;
  buildingSummary: string;
  floorCount: number;
  totalEstimatedHours: number;
  floors: FloorPlanFloor[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXAMPLE_GOALS = [
  'Scrape competitor pricing daily and alert me on Slack when prices drop more than 10%',
  'Generate a weekly SEO audit report for my top 20 pages and email it every Monday',
  'Monitor my Google Reviews, auto-respond to positive ones, and escalate negatives to my team',
];

const INDUSTRIES = [
  'E-commerce / Retail',
  'SaaS / Technology',
  'Real Estate',
  'Healthcare',
  'Finance / Insurance',
  'Marketing / Agency',
  'Legal',
  'Other',
];

const TOOL_OPTIONS = [
  'Google Sheets',
  'Slack',
  'Zapier',
  'HubSpot',
  'Salesforce',
  'Notion',
  'Airtable',
  'Email',
  'Discord',
  'Custom API',
];

const DELIVERY_METHODS = [
  'Email report',
  'Slack channel',
  'Dashboard / Web UI',
  'API endpoint',
  'Google Sheets',
  'Webhook',
];

const FREQUENCY_OPTIONS = [
  'Real-time',
  'Every hour',
  'Daily',
  'Weekly',
  'Monthly',
  'On-demand only',
];

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.75rem 1rem',
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: '0.5rem',
  color: '#fff',
  fontSize: '0.9375rem',
  fontFamily: 'inherit',
  outline: 'none',
  transition: 'border-color 0.15s ease',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  color: '#9ca3af',
  marginBottom: '0.5rem',
  fontWeight: 500,
};

const buttonPrimary: React.CSSProperties = {
  padding: '0.75rem 2rem',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: '0.5rem',
  fontSize: '0.9375rem',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'opacity 0.15s ease',
};

const buttonSecondary: React.CSSProperties = {
  padding: '0.75rem 1.5rem',
  background: 'transparent',
  color: '#9ca3af',
  border: '1px solid var(--border)',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'border-color 0.15s ease',
};

// ---------------------------------------------------------------------------
// Main onboard wizard
// ---------------------------------------------------------------------------

export default function OnboardPage() {
  const router = useRouter();

  // -- Wizard state --
  const [currentStep, setCurrentStep] = useState(1);
  const [goalId, setGoalId] = useState('');
  const [goalText, setGoalText] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('goal') || '';
    }
    return '';
  });
  const [email, setEmail] = useState('');
  const [customerContext, setCustomerContext] = useState<CustomerContext>({
    industry: '',
    existingTools: [],
    deliveryMethod: '',
    frequency: '',
    email: '',
  });
  const [floorPlan, setFloorPlan] = useState<FloorPlanResult | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [changeRequest, setChangeRequest] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -- Refs for GSAP transitions --
  const stepContentRef = useRef<HTMLDivElement>(null);

  // -- Step transition animation --
  const animateStepTransition = useCallback(
    (direction: 'forward' | 'back', onMid: () => void) => {
      if (!stepContentRef.current) {
        onMid();
        return;
      }
      const el = stepContentRef.current;
      const exitY = direction === 'forward' ? -12 : 12;
      const enterY = direction === 'forward' ? 12 : -12;

      gsap.to(el, {
        opacity: 0,
        y: exitY,
        duration: 0.2,
        ease: 'power2.in',
        onComplete: () => {
          onMid();
          gsap.fromTo(
            el,
            { opacity: 0, y: enterY },
            { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' },
          );
        },
      });
    },
    [],
  );

  // -- Floor reveal animation (staggered) --
  useEffect(() => {
    if (!floorPlan || revealedCount >= floorPlan.floorCount) return;
    const timer = setTimeout(() => {
      setRevealedCount((c) => c + 1);
    }, 600);
    return () => clearTimeout(timer);
  }, [floorPlan, revealedCount]);

  // =========================================================================
  // STEP 1: Goal Input -- handlers
  // =========================================================================

  async function handleGoalSubmit() {
    if (goalText.trim().length < 20) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/goals/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goalText: goalText.trim(),
          customerId: email || 'onboard-guest',
          customerContext: { email },
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setGoalId(data.goalId);
      animateStepTransition('forward', () => setCurrentStep(2));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create goal';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  // =========================================================================
  // STEP 2: Business Context -- handlers
  // =========================================================================

  function handleContextContinue() {
    const ctx: CustomerContext = {
      ...customerContext,
      email,
    };
    setCustomerContext(ctx);
    animateStepTransition('forward', () => {
      setCurrentStep(3);
      // Trigger plan generation
      generatePlan(ctx);
    });
  }

  async function generatePlan(ctx?: CustomerContext) {
    setIsLoading(true);
    setError(null);
    setFloorPlan(null);
    setRevealedCount(0);

    try {
      const res = await fetch(`/api/goals/${goalId}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerContext: ctx || customerContext }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        let errorMsg = body.error || `HTTP ${res.status}`;

        // Add helpful context for common errors
        if (res.status === 401) {
          errorMsg = 'Please sign in to continue building your automation.';
        } else if (res.status === 429) {
          errorMsg = 'Too many requests. Please wait a moment and try again.';
        } else if (res.status === 500 || res.status === 502 || res.status === 503) {
          errorMsg = `${errorMsg}. Our AI is working hard — please try again in a few moments.`;
        }

        throw new Error(errorMsg);
      }

      const data = await res.json();

      // Normalize the API response to FloorPlanResult
      const plan: FloorPlanResult = {
        goalId: data.goalId,
        buildingSummary: data.buildingSummary || '',
        floorCount: data.floorCount || data.floors?.length || 0,
        totalEstimatedHours: data.totalEstimatedHours || 0,
        floors: (data.floors || []).map(
          (
            f: {
              id?: string;
              number?: number;
              floorNumber?: number;
              name: string;
              description: string;
              successCondition: string;
            },
            i: number,
          ) => ({
            id: f.id || `floor-${i + 1}`,
            floorNumber: f.number ?? f.floorNumber ?? i + 1,
            name: f.name,
            description: f.description,
            successCondition: f.successCondition,
          }),
        ),
      };

      setFloorPlan(plan);
    } catch (err: unknown) {
      let msg = 'Failed to generate plan';

      if (err instanceof Error) {
        msg = err.message;

        // Add user-friendly context for network errors
        if (err.name === 'TypeError' && err.message.includes('fetch')) {
          msg = 'Network error. Please check your connection and try again.';
        } else if (err.message.includes('timeout')) {
          msg = 'The request took too long. Please try again.';
        } else if (err.message.includes('abort')) {
          msg = 'Request was cancelled. Please try again.';
        }
      }

      console.error('[Onboard] generatePlan error:', err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  // =========================================================================
  // STEP 3: Blueprint -- handlers
  // =========================================================================

  async function handleRedesign() {
    const ctx: CustomerContext = {
      ...customerContext,
      changes: changeRequest || undefined,
    };
    setCustomerContext(ctx);
    setChangeRequest('');
    await generatePlan(ctx);
  }

  async function handleApprove() {
    setIsLoading(true);
    setError(null);

    try {
      // Check if Stripe billing is configured (STRIPE_PUBLISHABLE_KEY exposed to client)
      const billingEnabled = !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

      if (billingEnabled) {
        // Route through Stripe checkout
        const checkoutRes = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goalId }),
        });

        if (!checkoutRes.ok) {
          const body = await checkoutRes
            .json()
            .catch(() => ({ error: 'Request failed' }));
          throw new Error(body.error || `HTTP ${checkoutRes.status}`);
        }

        const checkoutData = await checkoutRes.json();

        if (checkoutData.devMode) {
          // Dev mode — mock checkout returned, fall through to direct approve
        } else if (checkoutData.checkoutUrl) {
          // Redirect to Stripe hosted checkout page
          window.location.href = checkoutData.checkoutUrl;
          return; // Don't set isLoading false — page is navigating away
        }
      }

      // Dev mode fallback: direct approve (no billing)
      const res = await fetch(`/api/goals/${goalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      animateStepTransition('forward', () => setCurrentStep(4));

      // After 2s redirect to building dashboard
      setTimeout(() => {
        router.push(`/buildings/${goalId}`);
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to approve plan';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  // =========================================================================
  // Toggle tool chip
  // =========================================================================

  function toggleTool(tool: string) {
    setCustomerContext((prev) => ({
      ...prev,
      existingTools: prev.existingTools.includes(tool)
        ? prev.existingTools.filter((t) => t !== tool)
        : [...prev.existingTools, tool],
    }));
  }

  // =========================================================================
  // Render steps
  // =========================================================================

  function renderStep1() {
    return (
      <div>
        <h2
          style={{
            fontSize: 'clamp(1.5rem, 4vw, 2rem)',
            fontWeight: 700,
            color: '#fff',
            lineHeight: 1.2,
            marginBottom: '0.5rem',
            textAlign: 'center',
          }}
        >
          What do you want to automate?
        </h2>
        <p
          style={{
            fontSize: '0.9375rem',
            color: '#9ca3af',
            marginBottom: '1.5rem',
            textAlign: 'center',
          }}
        >
          Describe the workflow you want built. Be specific.
        </p>

        {/* Textarea */}
        <textarea
          value={goalText}
          onChange={(e) => setGoalText(e.target.value)}
          placeholder="e.g. Scrape competitor prices daily, compare to mine, and alert me on Slack if anyone drops below my price..."
          rows={4}
          style={{
            ...inputStyle,
            resize: 'vertical',
            minHeight: '100px',
          }}
        />

        {/* Example chips */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            marginTop: '1rem',
          }}
        >
          {EXAMPLE_GOALS.map((example) => (
            <button
              key={example}
              onClick={() => setGoalText(example)}
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: '999px',
                padding: '0.375rem 0.75rem',
                fontSize: '0.6875rem',
                color: '#9ca3af',
                cursor: 'pointer',
                transition: 'border-color 0.15s ease',
                textAlign: 'left',
              }}
            >
              {example.length > 60 ? example.slice(0, 60) + '...' : example}
            </button>
          ))}
        </div>

        {/* Email */}
        <div style={{ marginTop: '1.25rem' }}>
          <label style={labelStyle}>Email (for notifications)</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            style={inputStyle}
          />
        </div>

        {/* Continue */}
        <div style={{ marginTop: '1.5rem', textAlign: 'right' }}>
          <button
            onClick={handleGoalSubmit}
            disabled={goalText.trim().length < 20 || isLoading}
            style={{
              ...buttonPrimary,
              opacity:
                goalText.trim().length < 20 || isLoading ? 0.5 : 1,
              cursor:
                goalText.trim().length < 20 || isLoading
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            {isLoading ? 'Creating...' : 'Continue'}
          </button>
        </div>
      </div>
    );
  }

  function renderStep2() {
    return (
      <div>
        <h2
          style={{
            fontSize: 'clamp(1.25rem, 3.5vw, 1.75rem)',
            fontWeight: 700,
            color: '#fff',
            lineHeight: 1.2,
            marginBottom: '0.5rem',
            textAlign: 'center',
          }}
        >
          Tell us about your business
        </h2>
        <p
          style={{
            fontSize: '0.875rem',
            color: '#9ca3af',
            marginBottom: '1.5rem',
            textAlign: 'center',
          }}
        >
          This helps Elira design a better building.
        </p>

        {/* Industry */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={labelStyle}>Industry</label>
          <select
            value={customerContext.industry}
            onChange={(e) =>
              setCustomerContext((prev) => ({
                ...prev,
                industry: e.target.value,
              }))
            }
            style={{
              ...inputStyle,
              appearance: 'none',
              backgroundImage:
                'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%236b7280\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.75rem center',
              paddingRight: '2.5rem',
            }}
          >
            <option value="">Select industry...</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>
                {ind}
              </option>
            ))}
          </select>
        </div>

        {/* Existing tools */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={labelStyle}>
            Tools you already use (select all that apply)
          </label>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            {TOOL_OPTIONS.map((tool) => {
              const selected = customerContext.existingTools.includes(tool);
              return (
                <button
                  key={tool}
                  onClick={() => toggleTool(tool)}
                  style={{
                    background: selected
                      ? 'rgba(99, 102, 241, 0.15)'
                      : 'var(--panel)',
                    border: selected
                      ? '1px solid var(--accent)'
                      : '1px solid var(--border)',
                    borderRadius: '999px',
                    padding: '0.375rem 0.75rem',
                    fontSize: '0.75rem',
                    color: selected ? '#a5b4fc' : '#9ca3af',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {tool}
                </button>
              );
            })}
          </div>
        </div>

        {/* Delivery method */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={labelStyle}>How should results be delivered?</label>
          <select
            value={customerContext.deliveryMethod}
            onChange={(e) =>
              setCustomerContext((prev) => ({
                ...prev,
                deliveryMethod: e.target.value,
              }))
            }
            style={{
              ...inputStyle,
              appearance: 'none',
              backgroundImage:
                'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%236b7280\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.75rem center',
              paddingRight: '2.5rem',
            }}
          >
            <option value="">Select delivery method...</option>
            {DELIVERY_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Frequency */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={labelStyle}>How often should it run?</label>
          <select
            value={customerContext.frequency}
            onChange={(e) =>
              setCustomerContext((prev) => ({
                ...prev,
                frequency: e.target.value,
              }))
            }
            style={{
              ...inputStyle,
              appearance: 'none',
              backgroundImage:
                'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%236b7280\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.75rem center',
              paddingRight: '2.5rem',
            }}
          >
            <option value="">Select frequency...</option>
            {FREQUENCY_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        {/* Nav buttons */}
        <div
          style={{
            marginTop: '1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <button
            onClick={() =>
              animateStepTransition('back', () => setCurrentStep(1))
            }
            style={buttonSecondary}
          >
            Back
          </button>
          <button onClick={handleContextContinue} style={buttonPrimary}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  function renderStep3() {
    const allRevealed = floorPlan
      ? revealedCount >= floorPlan.floorCount
      : false;

    return (
      <div>
        <h2
          style={{
            fontSize: 'clamp(1.25rem, 3.5vw, 1.75rem)',
            fontWeight: 700,
            color: '#fff',
            lineHeight: 1.2,
            marginBottom: '0.5rem',
            textAlign: 'center',
          }}
        >
          Your Blueprint
        </h2>

        {/* Loading state */}
        {isLoading && !floorPlan && (
          <div
            style={{
              textAlign: 'center',
              padding: '3rem 0',
            }}
          >
            <p
              style={{
                color: 'var(--accent)',
                fontSize: '1rem',
                fontWeight: 500,
                animation: 'pulse-border 2s ease-in-out infinite',
              }}
            >
              Elira is designing your building...
            </p>
            <p
              style={{
                color: '#6b7280',
                fontSize: '0.8125rem',
                marginTop: '0.5rem',
              }}
            >
              This usually takes 15-30 seconds
            </p>
          </div>
        )}

        {/* Blueprint content */}
        {floorPlan && (
          <>
            {/* 3D Building */}
            <div style={{ marginBottom: '1.25rem' }}>
              <BlueprintBuilding
                floorCount={floorPlan.floorCount}
                revealedCount={revealedCount}
              />
            </div>

            {/* Building summary */}
            {floorPlan.buildingSummary && (
              <p
                style={{
                  fontSize: '0.875rem',
                  color: '#9ca3af',
                  lineHeight: 1.6,
                  marginBottom: '1.25rem',
                  padding: '0.75rem 1rem',
                  background: 'var(--panel)',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--border)',
                }}
              >
                {floorPlan.buildingSummary}
              </p>
            )}

            {/* Floor cards */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                marginBottom: '1.25rem',
              }}
            >
              {floorPlan.floors.map((floor, i) => (
                <div
                  key={floor.id}
                  style={{
                    opacity: i < revealedCount ? 1 : 0,
                    transform:
                      i < revealedCount
                        ? 'translateY(0)'
                        : 'translateY(8px)',
                    transition:
                      'opacity 0.4s ease, transform 0.4s ease',
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.75rem',
                    padding: '1rem 1.25rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      marginBottom: '0.375rem',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 26,
                        height: 26,
                        borderRadius: '0.375rem',
                        background: 'rgba(255, 255, 255, 0.06)',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: '#9ca3af',
                        flexShrink: 0,
                      }}
                    >
                      {floor.floorNumber}
                    </span>
                    <span
                      style={{
                        fontWeight: 600,
                        color: '#fff',
                        fontSize: '0.9375rem',
                      }}
                    >
                      {floor.name}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: '0.8125rem',
                      color: '#9ca3af',
                      lineHeight: 1.5,
                      marginBottom: '0.375rem',
                    }}
                  >
                    {floor.description}
                  </p>
                  <p
                    style={{
                      fontSize: '0.75rem',
                      color: '#6b7280',
                      borderLeft: '2px solid var(--border)',
                      paddingLeft: '0.75rem',
                      lineHeight: 1.5,
                    }}
                  >
                    {floor.successCondition}
                  </p>
                </div>
              ))}
            </div>

            {/* Estimated hours */}
            {floorPlan.totalEstimatedHours > 0 && (
              <p
                style={{
                  fontSize: '0.75rem',
                  color: '#6b7280',
                  textAlign: 'center',
                  marginBottom: '1rem',
                }}
              >
                Estimated build time: {floorPlan.totalEstimatedHours}h across{' '}
                {floorPlan.floorCount} floors
              </p>
            )}

            {/* Redesign section */}
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                marginBottom: '1rem',
              }}
            >
              <input
                type="text"
                value={changeRequest}
                onChange={(e) => setChangeRequest(e.target.value)}
                placeholder="Request changes..."
                style={{
                  ...inputStyle,
                  flex: 1,
                  fontSize: '0.8125rem',
                }}
              />
              <button
                onClick={handleRedesign}
                disabled={isLoading || !changeRequest.trim()}
                style={{
                  ...buttonSecondary,
                  fontSize: '0.8125rem',
                  padding: '0.5rem 1rem',
                  whiteSpace: 'nowrap',
                  opacity: isLoading || !changeRequest.trim() ? 0.5 : 1,
                  cursor: isLoading || !changeRequest.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {isLoading ? 'Redesigning...' : 'Redesign'}
              </button>
            </div>

            {/* Approve button (only when all revealed) */}
            {allRevealed && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '0.5rem',
                }}
              >
                <button
                  onClick={() =>
                    animateStepTransition('back', () => setCurrentStep(2))
                  }
                  style={buttonSecondary}
                >
                  Back
                </button>
                <button
                  onClick={handleApprove}
                  disabled={isLoading}
                  style={{
                    ...buttonPrimary,
                    opacity: isLoading ? 0.5 : 1,
                    background: '#16a34a',
                  }}
                >
                  {isLoading ? 'Approving...' : 'Approve & Build'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  function renderStep4() {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 0' }}>
        {/* Checkmark animation */}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'rgba(22, 163, 74, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.5rem',
            border: '2px solid #16a34a',
            animation: 'pulse-border 2s ease-in-out infinite',
          }}
        >
          <span style={{ fontSize: '1.75rem', color: '#16a34a' }}>
            &#10003;
          </span>
        </div>

        <h2
          style={{
            fontSize: '1.5rem',
            fontWeight: 700,
            color: '#fff',
            marginBottom: '0.5rem',
          }}
        >
          Approved!
        </h2>
        <p
          style={{
            fontSize: '1rem',
            color: 'var(--accent)',
            fontWeight: 500,
            marginBottom: '0.5rem',
            animation: 'pulse-border 1.5s ease-in-out infinite',
          }}
        >
          Starting your agents...
        </p>
        <p
          style={{
            fontSize: '0.8125rem',
            color: '#6b7280',
          }}
        >
          Redirecting to your building dashboard
        </p>
      </div>
    );
  }

  // =========================================================================
  // Main render
  // =========================================================================

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '42rem',
          padding: '0 1rem 3rem',
          flex: 1,
        }}
      >
        {/* Step indicator */}
        <StepIndicator currentStep={currentStep} />

        {/* Error display */}
        {error && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.625rem 1rem',
              background: 'rgba(248, 113, 113, 0.1)',
              border: '1px solid rgba(248, 113, 113, 0.3)',
              borderRadius: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{
                color: 'var(--red)',
                fontSize: '0.8125rem',
              }}
            >
              {error}
            </span>
            <button
              onClick={() => setError(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--red)',
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

        {/* Step content */}
        <div ref={stepContentRef} className="step-content">
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
          {currentStep === 4 && renderStep4()}
        </div>
      </div>
    </div>
  );
}
