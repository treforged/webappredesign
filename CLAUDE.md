# CLAUDE.md

## SYSTEM EXECUTION OVERRIDE

Default to `/multi-plan` for any non-trivial task.

Use multi-agent execution only when:
- the task spans multiple files, systems, or concerns
- work can be parallelized safely
- specialist review is likely to improve outcome

For focused work, prefer:
- one plan
- one executing agent
- one reviewer if needed

Never jump straight to implementation on complex work.
If unsure, plan first.

This rule overrides all other heuristics.

You are ALWAYS running with the Everything Claude Code framework.

- Use structured thinking (audit → plan → implement → verify)
- Use multi-agent reasoning where applicable
- Default to production-grade decisions, not quick patches
- Always check for system-wide impact before making changes
- Never solve issues in isolation if they affect other systems

## Purpose

This is a real Git repository connected to GitHub. Treat it as a
production-adjacent project. Make changes carefully, preserve existing
working behavior unless explicitly asked to refactor, and prioritize
safety, clarity, reviewability, secure defaults, and reliable local
backups.

Do not make any changes until you have high confidence in the solution.

If confidence is below threshold:
- first run a focused audit to gather missing information
- ask follow-up questions only if the missing detail cannot be resolved from the codebase

---

## Orchestration layer

Use the following priority order for every task:

1. **ECC multi-agent** — for complex, multi-file, or multi-concern tasks,
   use ECC commands: `/multi-plan` → `/multi-execute`. Let Opus decompose
   the task into a dependency graph before any agent touches files.
2. **ECC single agent** — for focused tasks (one file, one concern),
   delegate to the appropriate ECC specialist agent (e.g. `code-reviewer`,
   `tdd-guide`, `architect`, `security-reviewer`).
3. **Simple edit** — only when the change is clearly a single, low-risk
   line or config tweak with no downstream effects.

Never skip straight to implementation on complex or multi-file tasks.
Always plan first.

---

## SYSTEM CONTEXT (ALWAYS CONSIDER)

This application depends on tightly coupled systems:

- Supabase (auth, RLS, database)
- Stripe (subscriptions, checkout, webhooks)
- Plaid (account connections, transaction syncing)
- Mobile app (Capacitor / native behavior)
- Web app (browser-based behavior)

When making changes:
- Always evaluate impact across ALL relevant systems
- Never assume a change is isolated to one layer
- Validate data flow end-to-end (client → API → DB → external service → back)

---

## ROOT-CAUSE ENFORCEMENT

Before implementing any fix:

1. Identify the symptom
2. Trace upstream and downstream dependencies
3. Identify the true root cause
4. Verify whether other systems share the same issue

Do NOT:
- Patch symptoms
- Add UI fixes for data problems
- Add client logic for server issues

Fix at the correct layer.

---

## PLATFORM SEPARATION RULE

Mobile and Web must be treated as separate environments.

- Do NOT mix mobile-only features into web flows
  (biometrics, native storage, device auth)

- Do NOT assume web behavior applies to mobile
  (routing, auth persistence, viewport)

- Always verify:
  - mobile-specific UX
  - web-specific UX
  - shared logic boundaries

---

## EXECUTION STYLE

- Prefer structured outputs over long explanations
- Use concise, actionable steps
- Minimize unnecessary verbosity
- Optimize for fast iteration cycles with user review

---

## Default workflow

For every request, follow this sequence unless explicitly told otherwise:

1. Identify task complexity — multi-agent or single agent (see above).
2. If multi-agent: run `/multi-plan` first, confirm the plan, then
   `/multi-execute`.
3. Make the requested changes. Keep the diff scoped to the request only.
4. **Before modifying any file**, save a timestamped backup of the
   original to `./backups/` (see Backup policy below).
5. Commit locally after all changes are complete.
6. Do not push to GitHub, open a PR, merge branches, or rewrite history
   unless explicitly asked.
7. After finishing, summarize only:
    - files changed
    - what changed and why
    - backup path
    - commit message
    - manual follow-up steps

---

## Backup policy

Backups exist so any file can be restored to a previous version at any
time. Follow these rules strictly:

- **Back up all files for multi-file or high-risk changes. For trivial edits, backup is optional.** Copy
  the current version to `./backups/`.
- **Folder structure:** `./backups/YYYY-MM-DD_HHMMSS/<original-path>/`
  Preserve the original relative path inside the timestamped folder so
  restoring is unambiguous.
- **Never overwrite a previous backup.** Each backup session gets its
  own timestamped folder.
- **Scope backups to the change.** Only back up files that will actually
  be modified in this session — not the whole repo.
- **Backups are committed** as part of the same local commit so the
  backup and the change are always in sync in history.
- `.gitignore` must NOT exclude `./backups/` — backups must be tracked.

### Restoring a file

To restore any file to a previous version:
```
cp ./backups/YYYY-MM-DD_HHMMSS/path/to/file ./path/to/file
```
Then commit the restore as a new commit. Never amend or rewrite history
to undo a change.

---

## Local commit policy

- Always commit locally after every session's changes.
- Use clear, descriptive commit messages:
  `[scope]: what changed and why`
  Example: `[auth]: fix token expiry check in middleware`
- Never push unless explicitly asked.
- Never force push, amend history, or rebase unless explicitly asked.

---

## Agent cost discipline (token efficiency)

- Use `/multi-plan` before spawning agents — decomposing upfront saves
  redundant agent calls downstream.
- Independent subtasks → parallel agents via `/multi-execute`.
- Sequential or same-file work → single agent or subagent, not a team.
- Avoid spawning agent teams for tasks that don't require inter-agent
  coordination — the overhead is not worth it.
- If context window is approaching 80%, stop, summarize state to a
  handoff note, and continue in a fresh session.

---

## Security rules

- Never expose API keys, tokens, passwords, or `.env` contents in any
  file, commit message, log, or summary.
- Always use placeholders: `YOUR_API_KEY_HERE`
- If a secret is accidentally staged, STOP — do not commit. Alert
  immediately.
- If a security issue is found during any task: STOP → delegate to
  `security-reviewer` agent → fix CRITICAL issues → rotate any exposed
  secrets → scan codebase for similar patterns.

---

## DATA INTEGRITY RULE

This is a financial application.

- Never assume data is up-to-date without verifying sync logic
- Always check:
  - last updated timestamps
  - sync triggers (cron, webhook, manual)
  - source of truth (Plaid vs database)

If data appears stale:
- investigate sync pipeline BEFORE touching UI

---

## Immutability rule

Prefer creating new objects/files when ambiguity exists. Use in-place edits when clearly safe and intended. Return new copies with changes applied.

---

## Final execution order

```
Plan (ECC /multi-plan if complex)
→ Backup originals to ./backups/YYYY-MM-DD_HHMMSS/
→ Make changes
→ Review diff (scope check)
→ Commit locally
→ Summarize
→ STOP (no push)
```
