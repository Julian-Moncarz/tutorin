# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tutorin is a test-prep learning system built on the "file over app" philosophy. Curriculum, progress, and context live as plain files in a user-owned study folder — never in an app database. Read `spec.md` for the full system design before making non-trivial changes.

## Two-part architecture

1. **Intake skill** (`skill/SKILL.md`) — A Claude Code skill run by the user in their study folder. It interviews them, reads their materials, then writes `curriculum.json`, `context.md`, and `progress.json` into that folder.
2. **Web UI** (`web/`) — A Next.js 14 app (app router) that reads those files, runs the skill-selection algorithm, and shells out to the `claude` CLI (`claude -p --verbose --output-format stream-json`) per exercise to stream tutoring responses.

A live example of a student's study folder lives at `test-study/` (curriculum + progress + logs). This is real data, not a fixture — be careful editing it.

## Running the web app

```bash
cd web
STUDY_DIR="/absolute/path/to/study/folder" npm run dev   # starts Next dev server on :3000
npm run build
npm run start
```

`STUDY_DIR` is **required** — `web/src/lib/files.ts` throws without it. It points to the folder that contains `curriculum.json` / `progress.json` / `context.md` / `logs/`. For local development, use `STUDY_DIR="/Users/julianmoncarz/tutorin/test-study"`.

The app also requires the `claude` CLI to be on PATH (the chat route spawns it as a subprocess).

There is no test suite, no linter configured, and no formatter script. Type-check via `npx tsc --noEmit` from `web/`.

## Key modules

- `web/src/lib/files.ts` — all filesystem reads/writes against `STUDY_DIR`. Writes are atomic (temp file + rename). Logs go to `$STUDY_DIR/logs/`.
- `web/src/lib/algorithm.ts` — skill selection. Status machine: `not_started → practicing → mastered` (3 correct retrievals = mastered). Selection order: first unattempted → fewest-correct unmastered → oldest mastered for review. `shouldBeTemptation` fires at exactly 2 correct retrievals.
- `web/src/lib/claudeSessions.ts` — long-lived `claude -p --input-format stream-json --output-format stream-json` subprocesses, one per chat session, kept in a module-level `Map<sessionId, ClaudeSession>`. Each turn writes `{"type":"user","message":{"role":"user","content":"..."}}` NDJSON to stdin and reads `type:"assistant"` / `type:"result"` events from stdout. No idle sweeper — sessions live until the client explicitly DELETEs them (via `/api/chat/session`), the server process exits, or a subprocess crashes. Turn timeout 120s. Concurrent `send()` on a busy session yields a `busy` event; caller-abort does NOT kill the session (the turn runs to completion to keep `busy` correct).
- `web/src/app/api/chat/route.ts` — thin wrapper over `claudeSessions`. Body: `{skill, sessionId, message: string | null, image?}`. `message === null` + `isNew` → render `tutor-turn1-template.md` and send as turn 1. `message !== null` + `!isNew` → forward as the student's reply. `message !== null` + `isNew` → 409 `session_expired` (server swept or never had this id). Emits `type:"assistant"` text blocks as SSE `data:` frames; `busy` surfaces as `data: {"error":"session busy"}`.
- `web/src/app/api/chat/session/route.ts` — `DELETE /api/chat/session?id=X` tears down a session. Also accepts `POST` so the browser can use `navigator.sendBeacon` in `pagehide` handlers (sendBeacon is POST-only).
- `web/src/app/api/chat/tutor-system-prompt.md` — stable tutor persona, feedback rules, pacing, self-contained-ask rule, paper/photo workflow, AND the full `context.md` (substituted via `{{context}}` placeholder) AND the "generate ONE problem on session start" task spec. Read, `{{context}}` replaced with `getContext()` at session creation, passed once via `--system-prompt` (string flag) to the subprocess. Same prompt is cached across every session in the same study folder.
- `web/src/app/api/chat/tutor-turn1-template.md` — dynamic-only first-user-message with `{{skill}}`, `{{attemptHistory}}`, `{{status}}`, `{{temptationBlock}}`, `{{adaptiveBlock}}` placeholders. Sent as the first user turn of a session to trigger the task from the system prompt.
- `web/src/lib/chatStream.ts` — client-side SSE consumer. `streamChat(skill, message: string | null, sessionId, ...)`. Also exposes `endSession` (explicit DELETE), `endSessionOnUnload` (sendBeacon fallback for tab close), and `abandonFirstQuestionPrefetch`. Prefetches the first question for the next skill so the exercise view feels instant; on tab close a `pagehide` listener tears down any unconsumed prefetch.

## File contract (do not break)

The file shapes are the public API of this system. Changing them breaks the intake skill, the web app, and any existing user folders simultaneously.

- `curriculum.json`: `{ test, topics: [{ topic, skills: string[] }] }` — skill strings are natural language; verb ("Compute", "Explain", "Prove") signals problem type. Array order is dependency order.
- `progress.json`: `{ [skillName]: { attempts: [{ timestamp, correct }] } }` — keyed by exact skill string. Algorithm derives everything else.
- `context.md`: free-form markdown injected into every tutor prompt.
- `logs/`: per-session conversation JSON + `motivation.json`.

If you modify any of these, update `spec.md`, `skill/SKILL.md`, and `web/src/lib/types.ts` together.

## Design principles to respect

The system encodes specific learning-science choices (see `learning-interventions-memo.md` and the table in `spec.md`): step-level + high-information feedback, retrieval-first, productive failure on cold attempts, interleaving, no Socratic hinting, no punitive gamification (no streaks/lives/hearts), zero user decisions (algorithm picks next skill). Don't add features that undermine these — e.g., don't add hint buttons, don't add skill pickers on the dashboard, don't turn feedback into leading questions.
