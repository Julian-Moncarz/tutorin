# Research Context

## What they need and what they'll do with it
Design the optimal learning system for acing tests in minimal time. 

**Two deliverables (both ~100 lines of MD, research-report memo format):**
1. Learning interventions memo — what works, effects, principles. Sources + Admiralty ratings.
2. System design recommendation — high-level architecture, goal, options analysis. Blueprint to build from.

The system takes "I have this test" + files in a folder, interviews the user about the test to tailor + gathers more context itself, then guides the user through the optimal sequence of exercises to ace it.

## System scope
- Open-ended: could be a Claude Code skill, a skill + web UI, a full learning platform, or anything in between
- No constraint on form factor — let the research determine the right shape
- The "system" is whatever maximally helps the user ace tests efficiently

## Distributed study resolution
- User wants single-mission intense days — non-negotiable. Each day = one mission.
- Anki handles the spacing/distributed component across days automatically
- Research question: how to get spacing benefits WITHIN a single intense session (interleaving, varied retrieval, spaced within-session, etc.)

## Current skill pain points (confirmed complete list)
- Feels lost — no sense of where you are in the process
- No visible progress tracking
- AI drifts off course over time
- No technique/metacognitive feedback (just right/wrong)
- Not fun — lacks engagement, feels like a chore

## Key constraints
- Time budgets range from 1 day to ~1 week per test
- Tests vary widely: uni exams, behavioral interviews, technical interviews, conceptual questions
- Intel varies: files in a folder (lecture PDFs, past tests, interview questions from friends, or nothing) + AI does its own research to fill gaps
- User has ADHD-like attention patterns: choice paralysis, difficulty with distributed study, high engagement with intense single-mission days
- Scoped to ONE test at a time (user picks which test, system handles everything else)
- Budget: willing to pay for tools if genuinely good, but skeptical anything beats a well-prompted Claude
- Existing tutor skill at ~/Skills/tutor/SKILL.md — has problems but contains some good ideas

## User's learning profile (from journal + interview)
- **What works:** Intense single-mission days with one goal. Conversational learning with Claude. Teaching back / answering questions (80% retrieval, 20% intake). Anki for atomic facts.
- **What fails:** Distributed study. Choosing between tasks. Passive reading/watching. Studying without interaction.
- **Procrastination:** Sidetracks into interesting projects. Stops when he has to choose what to do next. External structure works; internal motivation for coursework doesn't.
- **Engagement:** The CONVERSATION with the agent IS the fun. All activity types rated fun: teach-back, quiz, progressive difficulty, debate, building things.
- **"Greased rails":** System decides everything. User shows up and slides forward. Zero decisions. Maybe "pick 1 of 3 fun options" occasionally.

## What they already know or believe
- Retrieval practice >> passive intake. Wants 80/20 ratio.
- Voice-typing answers works but they ramble — wants conciseness feedback
- Khan Academy mastery progression "feels safe" — visible progress, bird's-eye view
- Metacognitive coaching is extremely valuable — e.g., "think about the geometry first" for eigenvectors. Technique feedback, not just right/wrong.
- Existing skill problems: feels lost, no visible progress, AI drifts, no technique feedback, no trust in the process

## Concrete examples from interview
- **Bad ratio:** Watched 14 3B1B linalg videos for interview, then few questions. Should be inverted.
- **Good feedback:** AI said "think about the geometry first" — metacognitive coaching on HOW to approach problems.

## Existing tutor skill summary (~/Skills/tutor/SKILL.md — read this file)
- Two-phase: Planning → Tutoring. State in `goal.md` + `progress.md`.
- Good: pretesting, graduated prompting, mastery gating, format-matching, error-as-signal.
- Weak: no visible progress, no question bank, no technique feedback, limited interview prep.

## Complications to watch for
- Will abandon boring methods regardless of effectiveness
- Choice paralysis — must eliminate nearly all choice
- Different test types may need different modalities
- For some material: videos → transcripts → questions = valid
- Existing courses/tools might be the right answer — don't build what exists
- System should research domain-specific problem-solving technique per test

## User's technical environment
- React/Next.js, Vue, Python/FastAPI, TypeScript — all comfortable
- AnkiConnect working, voice app exists, can build full web apps
- Hypothesis: "app off files in folder, streaming JSON to claude code" — open to alternatives

## Sub-questions to research
1. **Evidence-based study techniques**: Optimal study in general AND for 1-7 day prep. Retrieval practice, elaborative interrogation, interleaving, spacing, desirable difficulty, testing effect. Intake-to-retrieval ratio. Variation by test type.
2. **AI tutoring systems**: Khanmigo, Duolingo, Brilliant design and evidence. Why no spaced rep in Khan? Can LLM match dedicated platforms?
3. **Metacognitive coaching & technique feedback**: Expert tutoring. Feedback on TECHNIQUE. Chi ICAP, self-explanation, Socratic method.
4. **Gamification & ADHD engagement**: What keeps ADHD learners engaged? Evidence-based "fun."
5. **Existing tools & platforms**: Build-vs-buy. Question generators, mastery trackers, quiz UIs, AI tutoring frameworks.
6. **Optimal single-session structure**: Intensive day structure. Breaks, variety, difficulty, energy, feedback density.
7. **Answer quality shaping**: Concise explanation training and retention. Shaping rambling responses.

## Planned sources
- Dunlosky et al. (2013), Roediger & Butler, Bjork, Karpicke — Google Scholar, PubMed
- Khanmigo docs, Duolingo research blog, ITS papers, LLM-as-tutor papers
- Chi ICAP, Bloom's 2-sigma, VanLehn — Google Scholar
- ADHD + gamification — PubMed
- GitHub, npm/PyPI, Product Hunt, HN
- Ultradian rhythms, cognitive fatigue — Google Scholar

## Assumptions to stress-test
1. A well-prompted Claude can match or beat dedicated tutoring platforms
2. System can auto-generate high-quality questions from arbitrary course materials
