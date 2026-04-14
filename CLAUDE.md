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
- `web/src/lib/algorithm.ts` — skill selection. Status machine: `not_started → needs_examples → practicing → mastered` (3 correct retrievals = mastered). Selection order: first unattempted → fewest-correct unmastered → oldest mastered for review. `shouldBeTemptation` fires at exactly 2 correct retrievals.
- `web/src/app/api/chat/route.ts` — spawns `claude -p` per message, parses `stream-json` output (`type: "assistant"` blocks become SSE `data:` lines), 90s timeout. Prompt is assembled from `tutor-prompt.md` plus context/skill/history/status/temptation/adaptive blocks.
- `web/src/app/api/chat/tutor-prompt.md` — the tutoring system prompt with `{{context}}`, `{{skill}}`, `{{attemptHistory}}`, `{{status}}`, `{{temptationBlock}}`, `{{adaptiveBlock}}`, `{{taskBlock}}` placeholders.
- `web/src/lib/chatStream.ts` — client-side SSE consumer. Also prefetches the first question for the next skill so the exercise view feels instant.

## File contract (do not break)

The file shapes are the public API of this system. Changing them breaks the intake skill, the web app, and any existing user folders simultaneously.

- `curriculum.json`: `{ test, topics: [{ topic, skills: string[] }] }` — skill strings are natural language; verb ("Compute", "Explain", "Prove") signals problem type. Array order is dependency order.
- `progress.json`: `{ [skillName]: { attempts: [{ timestamp, correct }] } }` — keyed by exact skill string. Algorithm derives everything else.
- `context.md`: free-form markdown injected into every tutor prompt.
- `logs/`: per-session conversation JSON + `motivation.json`.

If you modify any of these, update `spec.md`, `skill/SKILL.md`, and `web/src/lib/types.ts` together.

## Design principles to respect

The system encodes specific learning-science choices (see `learning-interventions-memo.md` and the table in `spec.md`): step-level + high-information feedback, retrieval-first, productive failure on cold attempts, interleaving, no Socratic hinting, no punitive gamification (no streaks/lives/hearts), zero user decisions (algorithm picks next skill). Don't add features that undermine these — e.g., don't add hint buttons, don't add skill pickers on the dashboard, don't turn feedback into leading questions.
