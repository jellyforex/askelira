'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

// ============================================================
// Types
// ============================================================

interface UserSettings {
  displayName: string;
  timezone: string;
  notifyBuilds: boolean;
  notifyErrors: boolean;
  notifyWeeklyDigest: boolean;
}

// ============================================================
// Constants
// ============================================================

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

const SIDEBAR_SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'api-key', label: 'API Key' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'connected', label: 'Connected Accounts' },
  { id: 'billing', label: 'Billing' },
];

// ============================================================
// Component
// ============================================================

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const [settings, setSettings] = useState<UserSettings>({
    displayName: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    notifyBuilds: true,
    notifyErrors: true,
    notifyWeeklyDigest: false,
  });
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [activeSection, setActiveSection] = useState('profile');
  const [isMobile, setIsMobile] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // Detect mobile viewport
  useEffect(() => {
    function checkMobile() {
      setIsMobile(window.innerWidth < 768);
    }
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Set display name from session
  useEffect(() => {
    if (session?.user?.name) {
      setSettings((prev) => ({ ...prev, displayName: session.user!.name || '' }));
    }
  }, [session]);

  // Load saved settings
  useEffect(() => {
    if (!session?.user?.email) return;
    fetch('/api/user/update')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.settings) {
          setSettings((prev) => ({ ...prev, ...data.settings }));
        }
      })
      .catch(() => {});
  }, [session]);

  // Intersection observer for active sidebar section
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: '-20% 0px -60% 0px' },
    );

    for (const id of SIDEBAR_SECTIONS.map((s) => s.id)) {
      const el = sectionRefs.current[id];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [status]);

  // Save handler
  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/user/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Save failed' }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSaveMessage({ type: 'success', text: 'Settings saved' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setSaveMessage({ type: 'error', text: msg });
    } finally {
      setSaving(false);
    }
  }

  // Copy API key
  function copyApiKey() {
    const key = session?.user?.email || '';
    navigator.clipboard.writeText(key).then(() => {
      setApiKeyCopied(true);
      setTimeout(() => setApiKeyCopied(false), 2000);
    });
  }

  // Mask email as API key display
  function maskedKey(email: string): string {
    if (!email) return '****';
    const [local, domain] = email.split('@');
    if (!domain) return '****';
    return local.slice(0, 2) + '****@' + domain;
  }

  // Scroll to section
  function scrollToSection(id: string) {
    const el = sectionRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ----------------------------------------------------------------
  // Loading / Unauthenticated
  // ----------------------------------------------------------------

  if (status === 'loading') {
    return (
      <div style={{ maxWidth: '64rem', margin: '0 auto', padding: '3rem 1rem', textAlign: 'center' }}>
        <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Loading settings...</p>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div style={{ maxWidth: '64rem', margin: '0 auto', padding: '3rem 1rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#fff', marginBottom: '0.5rem' }}>
          Settings
        </h1>
        <p style={{ color: '#9ca3af', fontSize: '0.9375rem' }}>
          Sign in to access your settings.
        </p>
      </div>
    );
  }

  const { name, email, image } = session.user;

  // ----------------------------------------------------------------
  // Shared styles
  // ----------------------------------------------------------------

  const cardStyle: React.CSSProperties = {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: '0.75rem',
    padding: '1.5rem',
    marginBottom: '1.5rem',
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: '1.125rem',
    fontWeight: 700,
    color: '#fff',
    marginBottom: '1.25rem',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '0.8125rem',
    color: '#9ca3af',
    marginBottom: '0.375rem',
    display: 'block',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.625rem 0.875rem',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '0.5rem',
    color: '#e5e7eb',
    fontSize: '0.875rem',
    outline: 'none',
    transition: 'border-color 0.15s ease',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: 'pointer',
    appearance: 'none' as const,
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239ca3af' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E\")",
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 0.75rem center',
    paddingRight: '2rem',
  };

  const btnPrimary: React.CSSProperties = {
    padding: '0.625rem 1.5rem',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: '0.5rem',
    fontSize: '0.8125rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
  };

  const btnOutline: React.CSSProperties = {
    padding: '0.5rem 1.25rem',
    background: 'transparent',
    color: '#e5e7eb',
    border: '1px solid var(--border)',
    borderRadius: '0.5rem',
    fontSize: '0.8125rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'border-color 0.15s ease, background 0.15s ease',
  };

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------

  return (
    <div
      style={{
        maxWidth: '64rem',
        margin: '0 auto',
        padding: isMobile ? '1.5rem 1rem 4rem' : '2rem 1.5rem 4rem',
        display: 'flex',
        gap: '2rem',
        flexDirection: isMobile ? 'column' : 'row',
      }}
    >
      {/* ======================== SIDEBAR ======================== */}
      <nav
        style={{
          width: isMobile ? '100%' : '200px',
          flexShrink: 0,
          position: isMobile ? 'relative' : 'sticky',
          top: isMobile ? 'auto' : '5rem',
          alignSelf: 'flex-start',
        }}
      >
        <h1
          style={{
            fontSize: '1.375rem',
            fontWeight: 700,
            color: '#fff',
            marginBottom: '1.25rem',
          }}
        >
          Settings
        </h1>

        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'row' : 'column',
            gap: isMobile ? '0.25rem' : '0.125rem',
            overflowX: isMobile ? 'auto' : 'visible',
            paddingBottom: isMobile ? '0.5rem' : 0,
          }}
        >
          {SIDEBAR_SECTIONS.map((section) => {
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                style={{
                  background: isActive ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  border: 'none',
                  borderLeft: isMobile ? 'none' : `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                  borderBottom: isMobile ? `2px solid ${isActive ? 'var(--accent)' : 'transparent'}` : 'none',
                  padding: isMobile ? '0.5rem 0.75rem' : '0.5rem 0.75rem',
                  color: isActive ? '#fff' : '#9ca3af',
                  fontSize: '0.8125rem',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderRadius: isMobile ? '0.375rem 0.375rem 0 0' : '0 0.375rem 0.375rem 0',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ======================== MAIN CONTENT ======================== */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Save feedback */}
        {saveMessage && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.625rem 1rem',
              background:
                saveMessage.type === 'success'
                  ? 'rgba(74, 222, 128, 0.1)'
                  : 'rgba(248, 113, 113, 0.1)',
              border: `1px solid ${
                saveMessage.type === 'success'
                  ? 'rgba(74, 222, 128, 0.3)'
                  : 'rgba(248, 113, 113, 0.3)'
              }`,
              borderRadius: '0.5rem',
            }}
          >
            <span
              style={{
                color: saveMessage.type === 'success' ? 'var(--green)' : 'var(--red)',
                fontSize: '0.8125rem',
              }}
            >
              {saveMessage.text}
            </span>
          </div>
        )}

        {/* ==================== PROFILE ==================== */}
        <section
          id="profile"
          ref={(el) => { sectionRefs.current['profile'] = el; }}
          style={cardStyle}
        >
          <h2 style={sectionTitleStyle}>Profile</h2>

          {/* Avatar + name row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
            {image ? (
              <img
                src={image}
                alt={name || 'User'}
                width={56}
                height={56}
                style={{ borderRadius: '50%', border: '2px solid var(--border)' }}
              />
            ) : (
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  border: '2px solid var(--border)',
                }}
              >
                {(name || email || '?')[0].toUpperCase()}
              </div>
            )}
            <div>
              <p style={{ fontSize: '1rem', fontWeight: 600, color: '#fff' }}>{name || 'User'}</p>
              <p style={{ fontSize: '0.8125rem', color: '#6b7280' }}>{email}</p>
            </div>
          </div>

          {/* Display name */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Display Name</label>
            <input
              type="text"
              value={settings.displayName}
              onChange={(e) => setSettings({ ...settings, displayName: e.target.value })}
              placeholder="Your display name"
              style={inputStyle}
            />
          </div>

          {/* Email (read-only) */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email || ''}
              readOnly
              style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }}
            />
            <p style={{ fontSize: '0.6875rem', color: '#6b7280', marginTop: '0.25rem' }}>
              Managed by Google. Cannot be changed here.
            </p>
          </div>

          {/* Timezone */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Timezone</label>
            <select
              value={settings.timezone}
              onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
              style={selectStyle}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* ==================== API KEY ==================== */}
        <section
          id="api-key"
          ref={(el) => { sectionRefs.current['api-key'] = el; }}
          style={cardStyle}
        >
          <h2 style={sectionTitleStyle}>API Key</h2>
          <p style={{ fontSize: '0.8125rem', color: '#9ca3af', marginBottom: '1rem' }}>
            Use this key to authenticate CLI requests. Keep it private.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                flex: 1,
                padding: '0.625rem 0.875rem',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '0.5rem',
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                color: '#e5e7eb',
                letterSpacing: '0.025em',
              }}
            >
              {apiKeyVisible ? (email || '') : maskedKey(email || '')}
            </div>
            <button
              onClick={() => setApiKeyVisible(!apiKeyVisible)}
              style={{
                ...btnOutline,
                minWidth: '4rem',
                textAlign: 'center',
              }}
            >
              {apiKeyVisible ? 'Hide' : 'Show'}
            </button>
            <button
              onClick={copyApiKey}
              style={{
                ...btnOutline,
                minWidth: '5rem',
                textAlign: 'center',
                background: apiKeyCopied ? 'rgba(74, 222, 128, 0.1)' : 'transparent',
                borderColor: apiKeyCopied ? 'rgba(74, 222, 128, 0.3)' : 'var(--border)',
                color: apiKeyCopied ? 'var(--green)' : '#e5e7eb',
              }}
            >
              {apiKeyCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </section>

        {/* ==================== NOTIFICATIONS ==================== */}
        <section
          id="notifications"
          ref={(el) => { sectionRefs.current['notifications'] = el; }}
          style={cardStyle}
        >
          <h2 style={sectionTitleStyle}>Notifications</h2>
          <p style={{ fontSize: '0.8125rem', color: '#9ca3af', marginBottom: '1rem' }}>
            Choose which email notifications you receive.
          </p>

          {[
            { key: 'notifyBuilds' as const, label: 'Build completions', desc: 'Get notified when a building finishes construction' },
            { key: 'notifyErrors' as const, label: 'Error alerts', desc: 'Get notified when a floor encounters an error' },
            { key: 'notifyWeeklyDigest' as const, label: 'Weekly digest', desc: 'Summary of your buildings activity each week' },
          ].map((item) => (
            <div
              key={item.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.75rem 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div>
                <p style={{ fontSize: '0.875rem', fontWeight: 500, color: '#e5e7eb' }}>{item.label}</p>
                <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.125rem' }}>
                  {item.desc}
                </p>
              </div>

              {/* Toggle switch */}
              <button
                onClick={() => setSettings({ ...settings, [item.key]: !settings[item.key] })}
                style={{
                  width: '44px',
                  height: '24px',
                  borderRadius: '12px',
                  border: 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  background: settings[item.key] ? 'var(--accent)' : 'var(--border)',
                  transition: 'background 0.2s ease',
                  flexShrink: 0,
                  marginLeft: '1rem',
                }}
              >
                <div
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: '#fff',
                    position: 'absolute',
                    top: '3px',
                    left: settings[item.key] ? '23px' : '3px',
                    transition: 'left 0.2s ease',
                  }}
                />
              </button>
            </div>
          ))}
        </section>

        {/* ==================== CONNECTED ACCOUNTS ==================== */}
        <section
          id="connected"
          ref={(el) => { sectionRefs.current['connected'] = el; }}
          style={cardStyle}
        >
          <h2 style={sectionTitleStyle}>Connected Accounts</h2>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {/* Google icon */}
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '0.5rem',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                }}
              >
                G
              </div>
              <div>
                <p style={{ fontSize: '0.875rem', fontWeight: 500, color: '#e5e7eb' }}>Google</p>
                <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                  {session ? (
                    <>
                      Connected as <span style={{ color: 'var(--green)' }}>{email}</span>
                    </>
                  ) : (
                    'Not connected'
                  )}
                </p>
              </div>
            </div>

            {session ? (
              <span
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  padding: '0.25rem 0.625rem',
                  borderRadius: '999px',
                  background: 'rgba(74, 222, 128, 0.1)',
                  color: 'var(--green)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.025em',
                }}
              >
                Connected
              </span>
            ) : (
              <button style={btnOutline}>Connect</button>
            )}
          </div>
        </section>

        {/* ==================== BILLING ==================== */}
        <section
          id="billing"
          ref={(el) => { sectionRefs.current['billing'] = el; }}
          style={cardStyle}
        >
          <h2 style={sectionTitleStyle}>Billing & Plan</h2>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1rem',
              background: 'var(--surface)',
              borderRadius: '0.5rem',
              border: '1px solid var(--border)',
              marginBottom: '1rem',
            }}
          >
            <div>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>
                Current Plan
              </p>
              <p style={{ fontSize: '1.125rem', fontWeight: 700, color: '#fff' }}>
                Free
              </p>
              <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
                4 debates / month
              </p>
            </div>

            <Link
              href="/billing"
              style={{
                ...btnPrimary,
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Upgrade to Pro
            </Link>
          </div>

          <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>
            Pro plan includes 20 debates/month and $0.80 per additional debate.{' '}
            <Link href="/billing" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              View billing details
            </Link>
          </p>
        </section>

        {/* ==================== SAVE BUTTON ==================== */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              ...btnPrimary,
              opacity: saving ? 0.5 : 1,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
