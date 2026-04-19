# TRE Forged LLC — Security & Compliance Policies
**Effective Date:** April 16, 2026  
**Last Reviewed:** April 16, 2026  
**Owner:** Tre Von Houten, Sole Member, TRE Forged LLC  
**Product:** Forged (app.treforged.com)

These policies satisfy Plaid's required security attestations (due 2026-10-13).

---

## Policy 1 — End-of-Life (EOL) Software Monitoring

**Scope:** All software, runtimes, and dependencies used in the Forged application.

**Policy:**  
TRE Forged LLC monitors the lifecycle status of all software components in use. The owner is responsible for tracking EOL dates and initiating upgrades before a component reaches end-of-life.

**Practices:**
- GitHub Dependabot is enabled on the `treforged/webappredesign` repository and automatically raises pull requests for dependency updates and security advisories.
- `npm audit` is run before each production deployment to identify known vulnerabilities.
- Major runtime EOL dates (Node.js LTS, Vite, React) are tracked and upgrades are planned at least 60 days before the EOL date.
- Managed cloud services (Supabase, Vercel, Stripe) are vendor-maintained; their EOL communications are monitored via vendor email and changelog subscriptions.
- Any EOL software identified is scheduled for remediation within 30 days of detection.

**Review Cadence:** Quarterly, or upon receipt of a vendor EOL notice.

---

## Policy 2 — Information Security Policy (ISP)

**Scope:** All systems, services, and data operated by TRE Forged LLC in support of the Forged application.

### 2.1 Purpose
This policy establishes the security principles and obligations of TRE Forged LLC to protect the confidentiality, integrity, and availability of consumer financial data processed through the Forged application and its integration with Plaid.

### 2.2 Organizational Context
TRE Forged LLC is a Florida single-member LLC. The sole member (Tre Von Houten) is responsible for all security decisions, system access, and policy enforcement. There are no employees; any future contractors are subject to this policy.

### 2.3 Data Classification
| Class | Description | Examples |
|-------|-------------|---------|
| Confidential | Consumer financial data, auth tokens | Plaid tokens, Supabase user rows |
| Internal | Operational config, non-PII logs | Vercel env vars, LaunchDarkly keys |
| Public | Marketing content, open-source code | Landing page, MIT-licensed modules |

### 2.4 Acceptable Use
- Production systems (Supabase, Vercel, Stripe, Plaid) are accessed only for business purposes.
- No consumer data is downloaded to local devices except as required for active debugging, and is deleted immediately after.
- No credentials or secrets are stored in source code, chat logs, or public repositories.

### 2.5 Access Control
- Access to all production systems requires individual accounts (no shared credentials).
- Multi-factor authentication (MFA) is required on all systems listed in Policy 4.
- Principle of least privilege is applied: each service account has only the permissions required for its function.

### 2.6 Data Protection
- All data in transit is encrypted via TLS 1.2+.
- Data at rest is encrypted by managed providers (Supabase/PostgreSQL AES-256, Vercel).
- Plaid access tokens are stored in Supabase (encrypted at rest) and never logged or exposed to the frontend.
- Stripe customer data is managed exclusively through Stripe's API; card numbers are never stored by TRE Forged LLC.

### 2.7 Incident Response
- Any suspected breach is investigated within 24 hours of detection.
- Affected users are notified within 72 hours if their data may have been compromised, consistent with applicable law.
- Plaid is notified per their incident reporting requirements if a breach involves Plaid-connected data.
- Post-incident review is completed within 7 days.

### 2.8 Vulnerability Management
- See Policy 5 (Vulnerability Scanning) and Policy 6 (Patching SLA).

### 2.9 Policy Review
This ISP is reviewed annually or following any material change to systems, personnel, or regulatory requirements.

---

## Policy 3 — Zero Trust Access Architecture

**Scope:** All access to systems storing or processing consumer data.

**Policy:**  
TRE Forged LLC implements a zero trust model — no system or user is inherently trusted based on network location alone. All access is authenticated and authorized per request.

**Implementation:**
- **Supabase Row-Level Security (RLS):** Every database query is scoped to the authenticated user via RLS policies. No query can access another user's data, even from within the application layer.
- **JWT-based auth:** All API calls from the frontend include a signed JWT (issued by Supabase Auth). The backend validates the token on every request.
- **Vercel edge isolation:** Each deployment runs in an isolated environment. Environment variables are encrypted and never exposed to the client bundle.
- **No VPN / IP allowlist assumed secure:** Production access (Supabase Studio, Vercel dashboard) requires MFA regardless of network.
- **Service-to-service auth:** Edge functions authenticate to external APIs (Stripe, Plaid) using scoped secret keys stored in Supabase Vault / Vercel encrypted env vars — never in code.
- **Principle of least privilege:** Supabase service role key is used only in edge functions that require admin access; all client-side queries use the anon key constrained by RLS.

---

## Policy 4 — Access Control Policy

**Scope:** All systems that store, process, or transmit consumer data.

**Policy:**  
Access to production systems is granted based on business need, protected by MFA, and reviewed quarterly.

**Systems and Access:**

| System | Owner Access | MFA Required | Purpose |
|--------|-------------|--------------|---------|
| GitHub (treforged org) | Sole member | ✓ (enabled) | Source code, CI/CD |
| Supabase (mdtosrbfkextcaezuclh) | Sole member | ✓ (enabled) | Database, auth, edge functions |
| Vercel | Sole member | ✓ (enabled) | Deployment, environment secrets |
| Stripe | Sole member | ✓ (enabled) | Billing, subscription management |
| LaunchDarkly | Sole member | ✓ (enabled) | Observability, session replay |
| Plaid | Sole member | ✓ (enabled) | Bank data aggregation |
| Cloudflare | Sole member | ✓ (enabled) | DNS management |

**Contractor Access:**
- Contractors are granted access only to systems required for their specific engagement.
- Access is scoped to the minimum necessary permissions.
- Access is revoked within 24 hours of engagement termination (see Policy 7).

**Shared Credentials:**
- No shared credentials are permitted. Each user has an individual account.
- API keys and secrets are stored in Vercel encrypted environment variables or Supabase Vault, not shared via chat or email.

---

## Policy 5 — Vulnerability Scanning

**Scope:** Application dependencies, infrastructure configurations, and code.

**Policy:**  
TRE Forged LLC performs continuous and periodic vulnerability scanning across application layers.

**Scanning Practices:**

| Layer | Tool | Frequency |
|-------|------|-----------|
| npm dependencies | Dependabot (GitHub) | Continuous (automated PRs) |
| npm dependencies | `npm audit` | Before every production deployment |
| Source code secrets | GitHub secret scanning | Continuous |
| Infrastructure (Supabase) | Supabase Security Advisors | Monthly review |
| OWASP Top 10 | Manual code review | Quarterly or on major releases |

**Process:**
1. Dependabot raises a PR when a vulnerability is detected in a dependency.
2. The PR is reviewed and merged (or a workaround applied) per the SLA in Policy 6.
3. `npm audit` results are reviewed before each deployment; deployments are blocked if critical vulnerabilities are present.
4. GitHub secret scanning alerts are treated as critical and remediated immediately.

---

## Policy 6 — Vulnerability Patching SLA

**Scope:** All identified vulnerabilities in application dependencies, infrastructure, or code.

**Policy:**  
TRE Forged LLC patches identified vulnerabilities according to the following SLA based on severity:

| Severity | Definition | Remediation SLA |
|----------|-----------|-----------------|
| Critical | CVSS 9.0–10.0; exploitable, affects consumer data | 7 days |
| High | CVSS 7.0–8.9; significant risk | 30 days |
| Medium | CVSS 4.0–6.9; moderate risk | 60 days |
| Low | CVSS 0.1–3.9; minimal risk | 90 days |

**Process:**
- Severity is determined by the CVE CVSS score as reported by Dependabot or `npm audit`.
- If a patch is not yet available, a compensating control (e.g., firewall rule, feature disable) is implemented within the SLA and documented.
- All remediation actions are tracked in GitHub issues or Dependabot PR history.
- If SLA cannot be met, the risk is documented and escalated (as a sole member, this means a written note in the security log).

---

## Policy 7 — De-provisioning / Access Revocation for Terminated or Transferred Personnel

**Scope:** Any contractor, collaborator, or third party with access to TRE Forged LLC systems.

**Note:** TRE Forged LLC has no employees. This policy governs contractors and collaborators.

**Policy:**  
Access to all systems is revoked within 24 hours of contractor termination or scope change.

**De-provisioning Checklist (executed by sole member upon termination):**

- [ ] Revoke GitHub repository access (remove from org or repo collaborators)
- [ ] Revoke Supabase dashboard access (remove from project members)
- [ ] Revoke Vercel team access (remove from project)
- [ ] Rotate any API keys or secrets the contractor had access to
- [ ] Revoke Stripe restricted key if issued
- [ ] Confirm no personal accounts were used for shared access
- [ ] Document completion date in the access log

**Rotation of Secrets:**  
If a contractor had access to any secret key (Stripe, Plaid, Supabase service role), that key is rotated immediately upon termination regardless of trust level.

**Sole Member Continuity:**  
In the event the sole member is incapacitated, a designated emergency contact holds a sealed document with recovery instructions to disable access to all systems.

---

## Policy 8 — Centralized Identity and Access Management (IAM)

**Scope:** All human and service account identities accessing TRE Forged LLC systems.

**Policy:**  
TRE Forged LLC uses centralized, individual-account-based identity management. No shared accounts or credentials are permitted.

**Human Identity:**
- All production system access uses individual accounts tied to `tre@treforged.com`.
- GitHub serves as the primary identity anchor; GitHub SSO or OAuth is used where available.
- MFA is enabled on all accounts (see Policy 4).
- Passwords are managed in a dedicated password manager (1Password or Bitwarden) — never reused or stored in plaintext.

**Service Identity (Machine Accounts):**
- Service-to-service authentication uses scoped API keys stored in Vercel encrypted environment variables or Supabase Vault.
- Each integration has its own key (Stripe webhook secret, Plaid client secret, etc.) — keys are not shared across services.
- API keys are rotated annually or immediately upon suspected compromise.

**Consumer Identity:**
- Consumer authentication is managed by Supabase Auth (email/password + TOTP MFA).
- Passwords are hashed by Supabase (bcrypt); TRE Forged LLC never has access to plaintext passwords.
- OAuth (Google, Apple) is handled via Supabase Auth providers — no OAuth tokens are stored by application code.

---

## Policy 9 — Periodic Access Reviews and Audits

**Scope:** All human and service account access to production systems.

**Policy:**  
TRE Forged LLC conducts quarterly access reviews to verify that all active access is necessary and appropriately scoped.

**Quarterly Review Checklist:**

**Human Access:**
- [ ] Verify the sole member is the only human with dashboard access to: GitHub, Supabase, Vercel, Stripe, LaunchDarkly, Plaid, Cloudflare
- [ ] Confirm no former contractors retain access
- [ ] Review GitHub repository collaborators and org members
- [ ] Confirm MFA is active on all accounts

**Service / API Keys:**
- [ ] Audit active Stripe API keys — revoke any unused restricted keys
- [ ] Audit Supabase service role usage — confirm it is only used in edge functions
- [ ] Review Plaid access tokens in database — confirm only active users have tokens
- [ ] Verify Vercel environment variables are current and no stale keys exist

**Application Access:**
- [ ] Review Supabase Auth user list for any suspicious accounts
- [ ] Review LaunchDarkly session data for anomalous access patterns

**Documentation:**  
Each quarterly review is documented with a date stamp and any actions taken. This can be a simple entry in a shared Google Doc or Notion page titled "Access Review Log."

**Schedule:**
| Review | Target Date |
|--------|------------|
| Q2 2026 | June 30, 2026 |
| Q3 2026 | September 30, 2026 |
| Q4 2026 | December 31, 2026 |
| Q1 2027 | March 31, 2027 |

---

## Attestation Tracker

| # | Plaid Requirement | Policy | Status | Due |
|---|------------------|--------|--------|-----|
| 10.1 | EOL software monitoring | Policy 1 | ☐ Attest | 2026-10-13 |
| 10.2 | Information Security Policy | Policy 2 | ☐ Attest | 2026-10-13 |
| 10.3 | Zero trust access architecture | Policy 3 | ☐ Attest | 2026-10-13 |
| 10.4 | Access control policy | Policy 4 | ☐ Attest | 2026-10-13 |
| 10.5 | Vulnerability scanning | Policy 5 | ☐ Attest | 2026-10-13 |
| 10.6 | Vulnerability patching SLA | Policy 6 | ☐ Attest | 2026-10-13 |
| 10.7 | De-provisioning / access revocation | Policy 7 | ☐ Attest | 2026-10-13 |
| 10.8 | Centralized IAM | Policy 8 | ☐ Attest | 2026-10-13 |
| 10.9 | MFA on consumer-facing app | (TOTP live in Settings) | ✓ Done | 2026-10-13 |
| 10.10 | MFA on internal systems | (MFA enabled on all dashboards) | ✓ Done | 2026-10-13 |
| 10.11 | Periodic access reviews | Policy 9 | ☐ Attest | 2026-10-13 |
