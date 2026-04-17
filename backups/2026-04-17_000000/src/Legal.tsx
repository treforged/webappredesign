import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { COOKIE_CATEGORIES, CookieConsentState } from '@/lib/cookie-consent';
import { useCookieConsent } from '@/hooks/useCookieConsent';
import { Shield, ChevronDown, ChevronUp, X } from 'lucide-react';

function CookiePreferencesInline() {
  const { consent, acceptAll, rejectNonEssential, saveCustom } = useCookieConsent();
  const [open, setOpen] = useState(false);
  const [analytics, setAnalytics] = useState(consent?.analytics ?? false);
  const [marketing, setMarketing] = useState(consent?.marketing ?? false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    saveCustom({ analytics, marketing });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section className="space-y-3">
      <h2 className="font-display font-semibold text-base">12. Cookie Preferences</h2>
      <p className="text-muted-foreground leading-relaxed">
        You can review and change your cookie consent at any time below.
      </p>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs font-medium text-primary hover:underline"
      >
        <Shield size={12} />
        {open ? 'Hide preferences' : 'Manage cookie preferences'}
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div className="border border-border p-4 space-y-3" style={{ borderRadius: 'var(--radius)' }}>
          {COOKIE_CATEGORIES.map((cat) => {
            const isExpanded = expanded === cat.id;
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
              <div key={cat.id} className="border border-border/60" style={{ borderRadius: 'var(--radius)' }}>
                <div className="flex items-center justify-between px-3 py-2.5 gap-3">
                  <button
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                    onClick={() => setExpanded(isExpanded ? null : cat.id)}
                  >
                    <span className="text-xs font-medium">{cat.label}</span>
                    {isExpanded ? <ChevronUp size={11} className="text-muted-foreground shrink-0" /> : <ChevronDown size={11} className="text-muted-foreground shrink-0" />}
                  </button>
                  <button
                    role="switch"
                    aria-checked={value}
                    disabled={cat.required}
                    onClick={toggle}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center transition-colors ${cat.required ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${value ? 'bg-primary' : 'bg-muted'}`}
                    style={{ borderRadius: '9999px' }}
                  >
                    <span className={`block h-3.5 w-3.5 bg-white shadow-sm transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} style={{ borderRadius: '9999px' }} />
                  </button>
                </div>
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-border/40 pt-2 space-y-1">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{cat.description}</p>
                    <p className="text-[10px] text-muted-foreground/70"><span className="font-medium text-muted-foreground">Examples: </span>{cat.examples.join(', ')}</p>
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex items-center gap-2 pt-1">
            <button onClick={rejectNonEssential} className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border transition-colors" style={{ borderRadius: 'var(--radius)' }}>Reject non-essential</button>
            <button onClick={acceptAll} className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border transition-colors" style={{ borderRadius: 'var(--radius)' }}>Accept all</button>
            <button onClick={handleSave} className="text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-1.5 transition-colors" style={{ borderRadius: 'var(--radius)' }}>
              {saved ? 'Saved ✓' : 'Save preferences'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function PrivacyContent() {
  return (
    <div className="space-y-8 text-sm">
      <p className="text-xs text-muted-foreground">Effective date: January 1, 2025 · Last updated: March 2026</p>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">1. Introduction</h2>
        <p className="text-muted-foreground leading-relaxed">
          TRE Forged LLC ("we", "us", "our") operates Forged, a personal finance management
          application accessible at app.treforged.com. This Privacy Policy explains how we collect, use, store,
          and protect your information when you use our service. By using Forged you agree to the practices
          described in this policy.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">2. Information We Collect</h2>
        <div className="space-y-2 text-muted-foreground leading-relaxed">
          <p><span className="text-foreground font-medium">Account data:</span> Your email address and a securely
          hashed password. We never store your password in plaintext.</p>
          <p><span className="text-foreground font-medium">Financial data:</span> Budget rules, transactions,
          account balances, savings goals, debt entries, and net worth entries you enter into the app. This data
          is stored solely in your account and is not shared with any third party.</p>
          <p><span className="text-foreground font-medium">Usage data:</span> Basic interaction logs (page
          navigation, feature usage) used to improve the service. We do not use third-party analytics trackers.</p>
          <p><span className="text-foreground font-medium">Payment data:</span> Billing is processed entirely by
          Stripe. We store only your Stripe customer ID and subscription status — no card numbers, CVVs, or bank
          account details are ever stored by TRE Forged LLC.</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">3. How We Use Your Information</h2>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground leading-relaxed">
          <li>To provide, operate, and maintain the Forged service</li>
          <li>To authenticate your identity and protect your account</li>
          <li>To process payments and manage your subscription status</li>
          <li>To send transactional emails (account confirmation, billing receipts)</li>
          <li>To respond to support requests</li>
          <li>To detect and prevent fraud or abuse</li>
          <li>To improve and develop new features</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          We do not sell, rent, or trade your personal information to third parties. We do not use your financial
          data to serve advertisements.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">4. Data Storage — Supabase</h2>
        <p className="text-muted-foreground leading-relaxed">
          All user data is stored in a PostgreSQL database managed by Supabase, Inc., hosted on Amazon Web
          Services (AWS) infrastructure. Supabase enforces Row-Level Security (RLS) policies that ensure each
          user can only read and write their own data — no other user or unauthenticated party can access your
          records. Data is encrypted at rest using AES-256 and encrypted in transit using TLS 1.2+.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          Authentication is handled via Supabase Auth, which issues short-lived JSON Web Tokens (JWTs). Tokens
          are stored in your browser's local storage and are never sent to any server other than Supabase and
          our own edge functions. For Supabase's own data practices, see{' '}
          <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer"
            className="text-primary hover:underline">supabase.com/privacy</a>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">5. Payment Processing — Stripe</h2>
        <p className="text-muted-foreground leading-relaxed">
          Premium subscription payments are processed by Stripe, Inc. When you subscribe, you are redirected to
          a Stripe-hosted checkout page. TRE Forged LLC never receives, transmits, or stores your payment card
          details. Stripe is PCI-DSS Level 1 certified. We store only your Stripe customer ID and subscription
          status (active, trialing, past_due, canceled) for the purpose of determining which features you have
          access to.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          For Stripe's data practices, see{' '}
          <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer"
            className="text-primary hover:underline">stripe.com/privacy</a>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">6. Data Retention</h2>
        <p className="text-muted-foreground leading-relaxed">
          Your account data is retained for as long as your account is active. If you delete your account, we
          will purge your personal data and financial records within 30 days. Anonymized or aggregated data that
          cannot be linked to you may be retained for service improvement purposes.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">7. Your Rights</h2>
        <div className="space-y-2 text-muted-foreground leading-relaxed">
          <p><span className="text-foreground font-medium">Access:</span> You can view all data you have entered
          in the app at any time.</p>
          <p><span className="text-foreground font-medium">Correction:</span> You can update your account
          information and financial data directly within the app via Settings.</p>
          <p><span className="text-foreground font-medium">Deletion:</span> You can delete your account at any
          time from the Settings page. This permanently removes all your data.</p>
          <p><span className="text-foreground font-medium">Portability:</span> Premium subscribers can export
          their financial data to CSV. Contact support to request a full data export in JSON format.</p>
          <p><span className="text-foreground font-medium">Objection:</span> You may contact us to object to
          specific processing of your data. We will respond within 30 days.</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">8. Security</h2>
        <p className="text-muted-foreground leading-relaxed">
          All connections to Forged are encrypted via HTTPS. Authentication uses industry-standard JWT tokens
          with expiration. We apply Row-Level Security at the database layer so each user's data is isolated.
          Sensitive operations (payments, subscription management) are handled by edge functions that validate
          authentication before processing any request. We do not log sensitive financial data or authentication
          tokens.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">9. Children's Privacy</h2>
        <p className="text-muted-foreground leading-relaxed">
          Forged is not intended for users under the age of 13. We do not knowingly collect
          personal information from children. If we become aware that a child under 13 has provided personal
          data, we will delete it promptly.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">10. Changes to This Policy</h2>
        <p className="text-muted-foreground leading-relaxed">
          We may update this Privacy Policy from time to time. When we make material changes, we will notify
          you by email or by a notice within the app. Continued use of the service after changes take effect
          constitutes acceptance of the updated policy.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">11. Contact Us</h2>
        <p className="text-muted-foreground leading-relaxed">
          For privacy-related questions, data requests, or to exercise your rights, contact TRE Forged LLC at:
          <br />
          <a href="mailto:support@treforged.com" className="text-primary hover:underline">support@treforged.com</a>
        </p>
      </section>

      <CookiePreferencesInline />
    </div>
  );
}

function TermsContent() {
  return (
    <div className="space-y-8 text-sm">
      <p className="text-xs text-muted-foreground">Effective date: January 1, 2025 · Last updated: March 2026</p>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">1. Acceptance of Terms</h2>
        <p className="text-muted-foreground leading-relaxed">
          By accessing or using Forged ("the Service"), provided by TRE Forged LLC
          ("Company", "we", "us"), you agree to be bound by these Terms of Service. If you do not agree to
          these terms, do not use the Service. We reserve the right to update these terms at any time with
          reasonable notice.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">2. Description of Service</h2>
        <p className="text-muted-foreground leading-relaxed">
          Forged is a personal finance management Software-as-a-Service (SaaS) application. It
          provides tools for budget planning, transaction tracking, debt payoff planning, savings goal tracking,
          net worth monitoring, and cash flow forecasting. The Service is intended for personal, non-commercial
          use.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">3. Account Registration</h2>
        <p className="text-muted-foreground leading-relaxed">
          To use Forged you must register with a valid email address and a password of at least 6 characters.
          You are responsible for maintaining the confidentiality of your account credentials and for all
          activity that occurs under your account. You must provide accurate and complete information and keep
          your account information up to date. One account per person; creating multiple accounts to circumvent
          free-tier limits is prohibited.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">4. Free and Premium Tiers</h2>
        <div className="space-y-2 text-muted-foreground leading-relaxed">
          <p><span className="text-foreground font-medium">Free tier</span> includes: 1 budget, basic
          dashboard, transaction tracking, up to 3 savings goals, and 1 debt tracker. The free tier is provided
          at no charge and may be modified at our discretion.</p>
          <p><span className="text-foreground font-medium">Premium tier</span> ($9/month) includes: unlimited
          budgets, advanced dashboard, CSV/PDF export, unlimited savings goals and debt trackers, car fund
          tracker pro, custom categories, and priority support.</p>
          <p>Premium subscriptions are billed monthly in advance and auto-renew until cancelled.</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">5. Payment and Billing</h2>
        <p className="text-muted-foreground leading-relaxed">
          All payments are processed securely by Stripe, Inc. By subscribing to Premium, you authorize
          TRE Forged LLC to charge your payment method on a recurring monthly basis. Subscriptions renew
          automatically on the same date each month.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          You may cancel your subscription at any time via the billing portal accessible from the Premium page
          or Settings. Cancellation takes effect at the end of the current billing period — you retain Premium
          access until that date. We do not provide prorated refunds for partial months.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          TRE Forged LLC reserves the right to change pricing with at least 30 days' notice. Continued use
          after a price change constitutes acceptance of the new price.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">6. User Data and Privacy</h2>
        <p className="text-muted-foreground leading-relaxed">
          You retain full ownership of all financial data you enter into Forged. TRE Forged LLC does not
          sell, rent, or share your personal or financial data with third parties for marketing purposes. Our
          data practices are described in full in our{' '}
          <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">7. Acceptable Use</h2>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground leading-relaxed">
          <li>Use the Service only for personal, non-commercial financial management</li>
          <li>Do not resell, sublicense, or redistribute access to the Service</li>
          <li>Do not attempt to reverse engineer, decompile, or exploit the Service</li>
          <li>Do not scrape, crawl, or programmatically extract data from the Service</li>
          <li>Do not use the Service in any way that violates applicable laws or regulations</li>
          <li>Do not share your account credentials with others</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          Violation of acceptable use terms may result in immediate account termination without refund.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">8. Disclaimer of Warranties</h2>
        <p className="text-muted-foreground leading-relaxed">
          Forged is a planning and tracking tool — it is <strong>not financial advice</strong>.
          TRE Forged LLC is not a licensed financial advisor, broker, or investment manager. The projections,
          recommendations, and calculations provided are for informational purposes only. You are solely
          responsible for any financial decisions you make using the Service.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          The Service is provided "as is" and "as available" without warranties of any kind, express or
          implied, including merchantability, fitness for a particular purpose, or non-infringement. We do not
          guarantee uninterrupted, error-free, or secure access to the Service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">9. Limitation of Liability</h2>
        <p className="text-muted-foreground leading-relaxed">
          To the maximum extent permitted by law, TRE Forged LLC and its officers, employees, and affiliates
          shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising
          from your use of the Service. Our total liability to you for any claims arising from use of the
          Service shall not exceed the total fees you paid to TRE Forged LLC in the three months preceding the
          claim.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">10. Termination</h2>
        <p className="text-muted-foreground leading-relaxed">
          You may terminate your account at any time via the Settings page. TRE Forged LLC may suspend or
          terminate your account for violation of these Terms, non-payment, or for any reason with reasonable
          notice. Upon termination, your data will be retained for 30 days during which you may request an
          export, then permanently deleted.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">11. Governing Law</h2>
        <p className="text-muted-foreground leading-relaxed">
          These Terms are governed by the laws of the United States. Any disputes arising from these Terms or
          your use of the Service shall be resolved in the jurisdiction of TRE Forged LLC's principal place of
          business. If any provision of these Terms is found unenforceable, the remaining provisions remain in
          full effect.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-semibold text-base">12. Contact Us</h2>
        <p className="text-muted-foreground leading-relaxed">
          For questions about these Terms, contact TRE Forged LLC at:
          <br />
          <a href="mailto:support@treforged.com" className="text-primary hover:underline">support@treforged.com</a>
        </p>
      </section>
    </div>
  );
}

export default function Legal() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isPrivacy = pathname === '/privacy';

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b border-border px-6 py-4 flex items-center">
        <button
          onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={12} /> Back
        </button>
        <span className="font-display font-bold text-xs text-gold ml-auto tracking-tight">FORGED</span>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row gap-8">
        {/* Sidebar — desktop */}
        <aside className="hidden sm:block w-44 shrink-0">
          <nav className="sticky top-8 space-y-1">
            <Link
              to="/privacy"
              className={`block px-3 py-2 text-xs font-medium transition-colors ${
                isPrivacy
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              Privacy Policy
            </Link>
            <Link
              to="/terms"
              className={`block px-3 py-2 text-xs font-medium transition-colors ${
                !isPrivacy
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              Terms of Service
            </Link>
          </nav>
        </aside>

        {/* Tab switcher — mobile */}
        <div className="sm:hidden w-full mb-2">
          <div className="flex gap-2">
            <Link
              to="/privacy"
              className={`flex-1 text-center px-3 py-2 text-xs font-medium border transition-colors ${
                isPrivacy
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              Privacy Policy
            </Link>
            <Link
              to="/terms"
              className={`flex-1 text-center px-3 py-2 text-xs font-medium border transition-colors ${
                !isPrivacy
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              Terms of Service
            </Link>
          </div>
        </div>

        {/* Content */}
        <main className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-2xl tracking-tight mb-8">
            {isPrivacy ? 'Privacy Policy' : 'Terms of Service'}
          </h1>
          {isPrivacy ? <PrivacyContent /> : <TermsContent />}
        </main>
      </div>
    </div>
  );
}
