# CLAUDE.md

## Purpose

This is a real Git repository connected to GitHub. Treat it as a
production-adjacent project. Make changes carefully, preserve existing
working behavior unless explicitly asked to refactor, and prioritize
safety, clarity, reviewability, secure defaults, and reliable local
backups.

Do not make any changes until you have 95% confidence in what you need to build. Ask me follow-up questions until you reach that confidence.

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
7. After finishing, always summarize:
   - Which files changed
   - What changed and why
   - Where the backup was saved
   - The commit message used
   - Any risks, follow-ups, or manual steps needed
   - The exact command to push if I choose to

---

## Backup policy

Backups exist so any file can be restored to a previous version at any
time. Follow these rules strictly:

- **Always back up before modifying.** Before touching any file, copy
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

## Immutability rule

Always create new objects/files rather than mutating existing ones in
place when there is ambiguity. Return new copies with changes applied.

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
