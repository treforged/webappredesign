import { useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ChevronDown, ChevronUp, Shield } from 'lucide-react';
import { COOKIE_CATEGORIES, CookieConsentState } from '@/lib/cookie-consent';
import { useCookieConsent } from '@/hooks/useCookieConsent';

// ---------------------------------------------------------------------------
// Preferences modal
// ---------------------------------------------------------------------------
interface PreferencesModalProps {
  initialAnalytics: boolean;
  initialMarketing: boolean;
  onSave: (prefs: Pick<CookieConsentState, 'analytics' | 'marketing'>) => void;
  onClose: () => void;
}

function PreferencesModal({
  initialAnalytics,
  initialMarketing,
  onSave,
  onClose,
}: PreferencesModalProps) {
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const [marketing, setMarketing] = useState(initialMarketing);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-prefs-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="relative w-full max-w-md bg-card border border-border shadow-xl flex flex-col max-h-[85vh]"
        style={{ borderRadius: 'var(--radius)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-primary" />
            <h2 id="cookie-prefs-title" className="font-display font-semibold text-sm">
              Cookie Preferences
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Choose which cookies you allow. Essential cookies are always active. Your
            preferences are saved in your browser and apply to this device only.{' '}
            <Link to="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
          </p>

          {COOKIE_CATEGORIES.map((cat) => {
            const isOpen = expanded === cat.id;
            const value =
              cat.id === 'essential'
                ? true
                : cat.id === 'analytics'
                ? analytics
                : marketing;

            const toggle =
              cat.id === 'essential'
                ? undefined
                : cat.id === 'analytics'
                ? () => setAnalytics((v) => !v)
                : () => setMarketing((v) => !v);

            return (
              <div
                key={cat.id}
                className="border border-border"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className="flex items-center justify-between px-4 py-3 gap-3">
                  {/* Expand toggle */}
                  <button
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    onClick={() => setExpanded(isOpen ? null : cat.id)}
                    aria-expanded={isOpen}
                    aria-controls={`cookie-cat-${cat.id}`}
                  >
                    <span className="text-xs font-medium">{cat.label}</span>
                    {isOpen ? (
                      <ChevronUp size={12} className="shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
                    )}
                  </button>

                  {/* Toggle switch */}
                  <button
                    role="switch"
                    aria-checked={value}
                    aria-label={`${cat.label} cookies ${cat.required ? '(required)' : value ? 'enabled' : 'disabled'}`}
                    disabled={cat.required}
                    onClick={toggle}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      cat.required ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                    } ${value ? 'bg-primary' : 'bg-muted'}`}
                    style={{ borderRadius: '9999px' }}
                  >
                    <span
                      className={`block h-3.5 w-3.5 bg-white shadow-sm transition-transform ${
                        value ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                      style={{ borderRadius: '9999px' }}
                    />
                  </button>
                </div>

                {isOpen && (
                  <div
                    id={`cookie-cat-${cat.id}`}
                    className="px-4 pb-3 space-y-2 border-t border-border/60"
                  >
                    <p className="text-xs text-muted-foreground leading-relaxed pt-2">
                      {cat.description}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70">
                      <span className="font-medium text-muted-foreground">Examples: </span>
                      {cat.examples.join(', ')}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ analytics, marketing })}
            className="text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-1.5 transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Save preferences
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main banner
// ---------------------------------------------------------------------------
export default function CookieBanner() {
  const { status, consent, acceptAll, rejectNonEssential, saveCustom } =
    useCookieConsent();
  const [showPrefs, setShowPrefs] = useState(false);

  // Don't render once the user has decided
  if (status === 'decided' && !showPrefs) return null;
  if (status === 'decided') {
    // If preferences modal opened from outside banner (e.g. Settings), still show it
    return showPrefs ? (
      <PreferencesModal
        initialAnalytics={consent?.analytics ?? false}
        initialMarketing={consent?.marketing ?? false}
        onSave={(prefs) => {
          saveCustom(prefs);
          setShowPrefs(false);
        }}
        onClose={() => setShowPrefs(false)}
      />
    ) : null;
  }

  return (
    <>
      {/* Banner */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card shadow-xl"
        role="region"
        aria-label="Cookie consent"
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Text */}
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-xs font-semibold text-foreground">
              We use cookies
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Essential cookies are always active. We also use analytics cookies to
              improve Budget OS. You can choose which non-essential cookies to allow.{' '}
              <Link to="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              onClick={() => setShowPrefs(true)}
              className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border transition-colors btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Manage preferences
            </button>
            <button
              onClick={rejectNonEssential}
              className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border transition-colors btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Reject non-essential
            </button>
            <button
              onClick={acceptAll}
              className="text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-1.5 transition-colors btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Accept all
            </button>
          </div>
        </div>
      </div>

      {/* Preferences modal (opened from banner) */}
      {showPrefs && (
        <PreferencesModal
          initialAnalytics={false}
          initialMarketing={false}
          onSave={(prefs) => {
            saveCustom(prefs);
            setShowPrefs(false);
          }}
          onClose={() => setShowPrefs(false)}
        />
      )}
    </>
  );
}
