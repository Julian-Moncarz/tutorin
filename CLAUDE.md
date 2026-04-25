# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tutorin is a test-prep learning system built on the "file over app" philosophy. Curriculum, progress, and context live as plain files in a user-owned study folder — never in an app database.

## Two-part architecture

1. **Intake prompt** (`intake_prompt.md`) — A prompt run as a Claude Code session in the user's study folder. It interviews them, reads their materials, then writes `curriculum.json`, `context.md`, and `progress.json` into that folder.
2. **Web UI** (`web/`) — A Next.js 14 app (app router) that reads those files, runs the skill-selection algorithm, and shells out to the `claude` CLI per chat session to stream tutoring + feedback responses.

A live example of a student's study folder lives at `test-study/` (curriculum + progress + logs + feedback drafts). This is real data, not a fixture — be careful editing it.

## Running the web app

```bash
cd web
STUDY_DIR="/absolute/path/to/study/folder" npm run dev   # Next dev server on :3000
npm run build
npm run start
```

`STUDY_DIR` is **required** — `web/src/lib/files.ts` throws without it. It points to the folder that contains `curriculum.json` / `progress.json` / `context.md` / `logs/` / `feedback/`. For local development, use `STUDY_DIR="/Users/julianmoncarz/tutorin/test-study"`.

The app also requires the `claude` CLI to be on PATH (every chat-style route spawns it as a subprocess).

There is no test suite, no linter configured, and no formatter script. Type-check via `npx tsc --noEmit` from `web/`. The app is **dev-only** (runs only under `next dev`) — there's no production deploy to optimize for, and React StrictMode double-invoke is permanent.

## Key modules

### Storage
- `web/src/lib/files.ts` — all filesystem reads/writes against `STUDY_DIR`. Writes are atomic (temp file + rename). Conversation logs go to `$STUDY_DIR/logs/<timestamp>_<skill>.json`; student-submitted photos to `$STUDY_DIR/logs/photos/`; motivation entries appended to `$STUDY_DIR/logs/motivation.json`.
- `web/src/lib/types.ts` — `Curriculum`, `Progress`, `Attempt`, `SkillStatus`, `NextSkillRecommendation`, `WeakSpot`, `ExamReadinessSummary`, etc. Single source of truth for the file shapes.

### Algorithm
- `web/src/lib/algorithm.ts` — skill selection + readiness. **Teach-till-✅ model:** a skill is either retired (≥1 correct attempt) or not. No status enum, no cooldown, no review mode. `getNextSkill` walks the curriculum in order and returns the first non-retired skill, or `null` when the student is done. `isRetired(skill)` is the load-bearing predicate everywhere else.

  `getExamReadiness` returns `{ estimatedScoreLow, estimatedScoreHigh, alreadyKnownPct, readiness, biggestGains }`. Score = `alreadyKnownPct + Σ(P(correct) × examWeight)` ± per-skill uncertainty (also weighted by `examWeight`). `P(correct)` is 0.85 if retired, 0.35 otherwise; uncertainty is 0.08 if retired, 0.25 otherwise. `biggestGains` is the 3 lowest-`P(correct)` skills.

### Tutor chat (per-exercise Claude session)
- `web/src/lib/claudeSessions.ts` — long-lived `claude -p --input-format stream-json --output-format stream-json --verbose --effort medium --system-prompt <…> --dangerously-skip-permissions` subprocesses, one per `sessionId`, kept in a `globalThis`-pinned `Map` (so Next dev module re-eval doesn't orphan them). Each turn writes one NDJSON `{"type":"user","message":{"role":"user","content":"..."}}` line to stdin and reads `assistant` / `user`(tool_result) / `result` events from stdout, emitting normalized `text` / `tool` / `tool_done` / `done` / `busy` / `error` events to the caller. **No idle sweeper** — sessions live until explicit `deleteSession`, server exit, or subprocess crash. Default turn timeout 120s (overridable). Concurrent `send()` returns `busy` immediately; **caller-abort does NOT kill the session** — the turn runs to completion so `busy` clears naturally.
- `web/src/app/api/chat/route.ts` — wrapper over `claudeSessions`. Body: `{skill, sessionId, message: string | null, image?}`. `message === null` + `isNew` → send a minimal first user message (just the skill name + "Begin.") as turn 1; the system prompt does all the heavy lifting. `message !== null` + `!isNew` → forward as student reply (with optional photo line; photos saved via `saveStudentPhoto` and referenced by absolute path so the tutor reads them via the `Read` tool). `message !== null` + `isNew` → 409 `session_expired` (server doesn't have this id; client must restart). Emits `text` blocks as SSE `data:` frames; `busy` surfaces as `{"error":"session busy"}`. **Single source of truth for tutor behavior:** the system prompt is read from repo-root `tutor_prompt.md`. The first-turn template is intentionally a one-liner inlined in `route.ts` so future edits to the system prompt don't get fought by overlapping instructions.
- `web/src/app/api/chat/session/route.ts` — `DELETE /api/chat/session?id=X` tears down a session. Also accepts `POST` so the browser can use `navigator.sendBeacon` in `pagehide` handlers (sendBeacon is POST-only).
- `tutor_prompt.md` (repo root) — stable tutor persona, feedback rules, pacing, self-contained-ask rule, paper/photo workflow, plus the full `context.md` (substituted via `{{context}}`). The task spec is "run a study session until the student can do this skill unaided, then emit ✅"; ✅ is the session-end signal. The tutor decides when to emit it. Read once at module load, `{{context}}` replaced at session creation, passed via `--system-prompt`.
- `web/src/lib/chatStream.ts` — client-side SSE consumer. `streamChat(skill, message, sessionId, onText, signal?, image?)`. Also exposes `endSession` (explicit DELETE), `endSessionOnUnload` (sendBeacon fallback for tab close), `startFirstQuestionPrefetch` / `takeFirstQuestionPrefetch` / `abandonFirstQuestionPrefetch` (prefetches the opener for the next skill so exercise view feels instant; `pagehide` listener tears down any unconsumed prefetch).

### Feedback agent (Pimberton)
- `web/src/app/api/feedback/chat/route.ts` — same `claudeSessions` infra but with a 10-minute turn timeout (Pimberton may run `npm ci`, install playwright, spin up a prototype). System prompt comes from repo-root `feedback_agent_prompt.md` with `{{repo}}` / `{{repoRoot}}` / `{{sessionDir}}` substituted. Per-session sandbox lives at `$STUDY_DIR/feedback/drafts/<sessionId>/`. `DELETE` cleans up the session AND any prototype sandbox under `/Users/julianmoncarz/tutorin-wt/` (kills `next dev` on the recorded port via `pkill`, then `rm -rf`s the sandbox path — guarded by a hardcoded prefix check).
- `web/src/app/api/feedback/draft/route.ts` — reads draft markdown files Pimberton wrote into the session sandbox, parses simple YAML frontmatter (`title`, `state`).
- `web/src/app/api/feedback/submit-comment/route.ts` and `submit-issue/route.ts` — push the finished draft to GitHub (`Julian-Moncarz/tutorin`).
- `web/src/lib/feedbackStream.ts` — client-side consumer. Splits text events into separate paragraphs (Pimberton's text and tool calls are interleaved; each text event is treated as its own thought).

### Smaller API routes
- `web/src/app/api/curriculum/route.ts`, `progress/route.ts`, `readiness/route.ts`, `next-skill/route.ts`, `skill/route.ts`, `motivation/route.ts` — thin GETs/POSTs over `files.ts` + `algorithm.ts`.

### Pages & components
- `web/src/app/page.tsx` — dashboard (readiness card, next-skill).
- `web/src/app/exercise/page.tsx` — chat exercise view.
- `web/src/components/` — `FeedbackButton`, `MotivationPopup`, `PeelReveal`, `WebcamCapture`.
- `web/src/lib/audio.ts` — Web Audio synthesis for celebrations. The retire fanfare (`playSkillRetired`) and peel-swipe SFX (`playPeel`) are intentionally **over-the-top**: dramatic multi-layered audio, not subtle.

## File contract (do not break)

The file shapes are the public API of this system. Changing them breaks the intake skill, the web app, and any existing user folders simultaneously.

- `curriculum.json`: `{ test, topics: [{ topic, skills: [{ name, examWeight }] }], alreadyKnown?: [{ name, examWeight }] }` — skill `name` is natural language; verb ("Compute", "Explain", "Prove") signals problem type. `examWeight` is the % of exam marks from that skill; weights across `topics` + `alreadyKnown` sum to ~100. `alreadyKnown` holds diagnostic-excluded skills that never get served — they only contribute to the `alreadyKnownPct` baseline on the readiness card. Array order is dependency order.
- `progress.json`: `{ [skillName]: { attempts: [{ timestamp, correct }] } }` — keyed by exact skill string. Algorithm derives everything else.
- `context.md`: free-form markdown injected into the tutor system prompt.
- `logs/`: per-session conversation JSON, `motivation.json`, `photos/`.
- `feedback/drafts/<sessionId>/`: Pimberton's working directory per feedback session.

If you modify any of these, update `intake_prompt.md` and `web/src/lib/types.ts` together.

## Design principles to respect

The system encodes specific learning-science choices (see `learning-interventions-memo.md`): step-level + high-information feedback, retrieval-first within a session (the tutor builds toward an unaided class-representative problem), no Socratic hinting, no punitive gamification (no streaks/lives/hearts), zero user decisions (algorithm picks next skill). The cold-shot productive-failure rule was removed — every encounter is a teach-till-✅ session, since the explicit user feedback was that cold problems on never-seen skills produced friction (a canned "teach me" prompt every time) without learning gains. Don't add features that undermine the remaining principles — e.g., don't add hint buttons, don't add skill pickers on the dashboard, don't turn feedback into leading questions.
