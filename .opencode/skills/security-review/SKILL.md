---
name: security-review
description: Offline-first security checklist for this repo. Use when handling user input, file content, persistence, exports, or dependencies. No auth/server stack assumed.
---

# Security Review (DEE adaptation)

Source: https://github.com/YoelCieno/settings-opencode (`skills/security-review/SKILL.md`).
That upstream file assumes Next.js + Supabase + Solana + Vercel; none of that
applies here. This is a slim conversion keeping only what this offline-first
simulation repo needs. Full OWASP reference: https://owasp.org/www-project-top-ten/

## When to Activate

- Handling user input, file uploads, or imported world/checkpoint files.
- Touching persistence, exports, or checkpoint round-trips.
- Adding dependencies or changing build/packaging (Capacitor/Android).
- Storing or logging anything sensitive.

## Checklist

### 1. Secrets

- No hardcoded keys, tokens, or passwords in source or history.
- Secrets only via environment; `.env*` (except `.env.example`-style templates)
  stay gitignored. Never log secrets.

### 2. Offline-first / No Exfiltration

- No network calls, analytics, or external services without explicit Owner
  approval (repo prohibition). Verify new code paths make no fetch/XHR.
- Export/checkpoint files must not embed secrets or absolute local paths.

### 3. Input Validation

- Validate untrusted input at the boundary (world configs, imported files,
  pasted JSON). Prefer schema validation where the codebase already uses it;
  never trust shape by assertion alone.
- File imports: enforce size, type, and extension limits; reject on mismatch.
- Never interpolate untrusted input into shell, SQL, or dynamic code.

### 4. Safe Errors and Logs

- User-facing errors stay generic; details go to local logs only.
- No passwords, tokens, PII, or full file contents in logs.
- No stack traces exposed in UI surfaces.

### 5. Dependencies

- `pnpm audit` (or the repo's pinned audit path) clean for touched packages.
- Lockfile (`pnpm-lock.yaml`) stays consistent; no unpinned new fetches.
- Do not weaken CI security controls to pass.

### 6. UI / Export Surfaces

- Sanitize rendered user-provided content; use framework-safe rendering, never
  raw HTML injection for untrusted strings.
- Exported artifacts must round-trip without executing embedded content.

## Report Shape

For each finding: severity, `file:line`, what is exposed, minimal fix, and how
verified (command + result). "No findings" must still name the checks run.
