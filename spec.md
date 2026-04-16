cccc# Tutorin — System Specification

## What it is
A test-prep learning system that takes "I have this test" + files in a folder, interviews the user, generates a structured curriculum, then guides them through an optimized sequence of exercises via a web UI. Goal: ace any STEM/math/CS university exam in minimum time.

Built on the [file over app](https://stephango.com/file-over-app) philosophy: curriculum, progress, and context live as plain files in the user's folder, not locked inside an app database.

## Architecture

```
User runs Claude Code skill in a folder
  → Intake interview + reads files
  → Outputs: curriculum.json, context.md, progress.json
  → User opens web UI (Next.js app)
  → Web UI reads files, runs algorithm, spawns claude sessions for each problem
  → User learns, progress saved to files
```

### Components

1. **Intake skill** — Claude Code skill. Interviews user ("what's the test?", "what materials do you have?", "where are you right now?"). Reads all files in the folder. Outputs curriculum calibrated to the gap between user's current level and test requirements. Can recommend external resources.

2. **Web UI** — Next.js app. Two screens: dashboard (topic map + progress) and exercise view (problem + chat + feedback). Gorgeous, smooth, fun to use. Zero decisions for the user — algorithm decides everything, user just does what's shown and clicks "next."

3. **Session AI** — `claude -p` (or equivalent) spawned per problem. Full chat session — user and AI go back and forth about a problem as long as needed. Gets context.md + current skill + attempt history in its prompt. Runs with full permissions (no permission prompts).

4. **Algorithm** — Decides what skill to work on next. Lives in the web UI backend. Reads curriculum.json and progress.json.

## File Format

### curriculum.json
```json
{
  "test": "MATH 223 Midterm - Linear Algebra",
  "topics": [
    {
      "topic": "Determinants",
      "skills": [
        {
          "name": "Compute the determinant of a 2x2 matrix",
          "examWeight": 8,
          "timeCost": 0.8
        },
        {
          "name": "Compute the determinant of a 3x3 matrix using cofactor expansion",
          "examWeight": 12,
          "timeCost": 1.1
        },
        {
          "name": "Explain how row operations affect the determinant and why",
          "examWeight": 10,
          "timeCost": 0.9
        }
      ]
    },
    {
      "topic": "Eigenvalues & Eigenvectors",
      "skills": [
        {
          "name": "Explain geometrically what eigenvalues and eigenvectors represent",
          "examWeight": 8,
          "timeCost": 0.8
        },
        {
          "name": "Compute eigenvalues of a 2x2 or 3x3 matrix",
          "examWeight": 15,
          "timeCost": 1.1
        },
        {
          "name": "Find eigenvectors given eigenvalues",
          "examWeight": 12,
          "timeCost": 1
        },
        {
          "name": "Explain why a matrix with repeated eigenvalues may not be diagonalizable",
          "examWeight": 10,
          "timeCost": 0.9
        },
        {
          "name": "Diagonalize a matrix or explain why it cannot be diagonalized",
          "examWeight": 25,
          "timeCost": 1.2
        }
      ]
    }
  ]
}
```

Each skill is an object. `name` is the human-readable skill, `examWeight` is the expected percentage of total exam marks attributable to that skill, and `timeCost` estimates relative minutes-to-meaningful-gain. Across the whole curriculum, `examWeight` should sum to about `100`. Order in the array is dependency order. The verb in the description ("compute", "explain", "find") tells the AI what kind of problem to generate. Both procedural AND conceptual/explanatory skills are included — elaborative interrogation ("explain why X works") is just another skill.

The curriculum is a living document — the session AI can add prerequisite skills when it discovers gaps.

### progress.json
```json
{
  "Compute the determinant of a 2x2 matrix": {
    "attempts": [
      {"timestamp": "2026-04-10T14:30:00", "correct": false},
      {"timestamp": "2026-04-10T14:35:00", "correct": true},
      {"timestamp": "2026-04-10T14:52:00", "correct": true}
    ]
  }
}
```

Keyed by skill name. Each attempt is a timestamp + correct boolean. The algorithm derives everything else from this data (retrieval count, mastery status, trajectory).

### context.md
Free-form markdown written by the intake agent. Contains:
- Course-specific details (question formats, notation conventions, professor emphasis areas)
- Past exam problems extracted from provided materials
- Level of rigor expected
- Any domain-specific problem-solving approaches
- User's current level and known gaps

This file is included in every session AI prompt to ground it in the specific course.

### logs/
Directory containing full conversation logs for every problem session. Each session saved as a timestamped JSON file with the skill name, full message history, and outcome.

## Algorithm

### Skill selection
1. First unattempted skill in topic order (following dependency order)
2. Skills with < 3 correct retrievals (need more practice)
3. Interleaved review of mastered skills (when 2+ skills in practicing/mastered state)

### Progression per skill
```
Cold attempt (first encounter)
  → Correct: count 1, continue practicing
  → Wrong: next encounter leads with worked example + step-level feedback,
    then faded attempt

Practicing (1+ correct retrievals)
  → Generate problems, full chat for feedback
  → Difficulty increases with consecutive correct answers
  → At 2 correct retrievals: throw a temptation problem
    (looks like this skill but requires a different approach)
  → 3 correct retrievals: mastered → review pool

Review pool
  → Interleave with other skills during practice
  → If accuracy drops: re-enter practicing

Mock exam mode (when most skills mastered)
  → Timed, no feedback, mixed problems across all skills
  → Full detailed review at the end
```

### Adaptive behavior
- If user bombs cold attempt: next encounter is worked example, not another attempt
- If user is acing everything: problems get harder, feedback gets briefer
- If user is struggling: problems get easier (faded), feedback includes full worked solutions
- Session AI can add prerequisite skills to curriculum.json when it discovers gaps
- User can request to deep dive into a topic, and the AI adds skills accordingly

## Core Loop (per problem)

1. Algorithm picks a skill from curriculum.json
2. Web UI spawns a claude session with: context.md + skill name + attempt history
3. AI generates a problem appropriate for the skill and the user's level
4. User and AI have a full chat conversation:
   - User attempts the problem
   - AI gives step-level, high-information feedback (task + process + self-regulation)
   - User can ask questions, explain their understanding, go back and forth
   - AI can give worked examples, faded problems, or harder variants within the conversation
   - This is a full unrestricted conversation — not a rigid script
5. When user clicks "next": the session AI outputs a final assessment (correct/incorrect), which is saved to progress.json
6. Algorithm picks the next skill

## Learning Principles Implemented

From the learning interventions memo:

| Principle | How it's implemented |
|-----------|---------------------|
| Step-level feedback (d=0.76) | Session AI gives step-by-step feedback on every attempt |
| High-information feedback (d=0.99) | Prompt enforces task + process + self-regulation feedback |
| 60-80% retrieval practice (g=0.50) | Algorithm is retrieval-first; intake is minimal and targeted |
| Worked examples for novices (d=0.70-1.00) | Cold attempt failure → worked example → faded → independent |
| Productive failure (d=0.36-0.58) | Cold attempt IS productive failure — attempt before instruction |
| Self-explanation (d=0.55) | "Explain why X works" skills in curriculum; explain-back in conversations |
| Interleaving (d=0.83) | Algorithm interleaves after 2+ skills in practice |
| Diagnostic pretest | Cold attempt serves as diagnostic |
| 3 correct retrievals | Rawson & Dunlosky threshold for mastery |
| Temptation problems | Near-miss problems at retrieval 2 to test discrimination |
| Zero decisions / ADHD design | Algorithm decides everything; user just does and clicks next |
| No Socratic questioning | Feedback uses embedded solutions, not leading questions |
| LLM restraint | Prompt enforces: don't over-scaffold, don't hint unless stuck/wrong |

## Session AI Prompt Requirements

The prompt for the session AI must:
- Include context.md for course grounding
- Include the current skill name and description
- Include attempt history for this skill
- Enforce three-tier feedback (task + process + self-regulation)
- Enforce restraint (don't over-intervene, don't scaffold too fast)
- Adapt feedback intensity based on attempt history
- Use past exam problems when available from context.md
- Be able to add skills to curriculum.json when prerequisite gaps are discovered
- Generate problems appropriate to the user's demonstrated level

## Web UI Requirements

### Dashboard
- Topic map showing all topics and skills
- Progress indicator per skill (not attempted / practicing / mastered)
- Overall progress (% of skills mastered)
- One-click session start (zero decisions)
- External resource recommendations from context.md when relevant

### Exercise View
- Problem display (with LaTeX rendering via KaTeX)
- Text input for answers (plain text — AI parses informal math notation)
- Chat panel for the conversation with the AI
- "Next" button to move to the next problem
- Current skill name visible
- Progress visible at all times (which skill, how many correct, overall %)

### Motivation check-in
- Every ~25 minutes, a small non-intrusive pop-up: "Quick check — how are you feeling?" with options like: focused, tired, frustrated, bored
- One tap to dismiss, takes < 2 seconds
- Logged with timestamp to logs/ for future correlation analysis (motivation vs. learning outcomes)
- Not a UX feature — a data collection mechanism for improving the system over time

### Design
- Gorgeous, smooth, silky, fun to use
- No punitive mechanics (no hearts, no lives, no streaks)
- Visible progress everywhere — the user should always know where they are
- Mobile-friendly is nice-to-have, desktop-first

## Logging

- Every conversation saved to logs/ with full message history
- Every answer and assessment saved
- Session duration and accuracy trends tracked
- All curriculum changes logged (when skills are added/modified)
- Logging should be comprehensive enough for agents to debug issues and for analysis of learning patterns

## What's NOT in v1
- Anki integration (day 2 — distributed practice across days)
- Voice input
- Multiple simultaneous tests
- Confidence calibration
- Mobile-optimized UI
- External resource integration: intake agent reads/transcribes external resources, chunks them into ~10 min segments, each chunk becomes a topic with skills derived from that segment's content. UI adds a "go learn this, click when back" state before retrieval practice on that topic's skills. Resource lives at topic level since it covers multiple skills.
