import {
  Curriculum,
  ExamReadinessSummary,
  NextSkillRecommendation,
  Progress,
  SkillDefinition,
  SkillStatus,
  WeakSpot,
} from './types';

// One correct attempt retires a skill.
const MASTERY_THRESHOLD = 1;

// After any attempt on a skill, it sits out for this many subsequent
// attempts (across all skills) before it's eligible to be served again.
// Enforces a real retrieval gap after a walkthrough instead of an echo.
const COOLDOWN_ATTEMPTS = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getSkillName(skill: SkillDefinition): string {
  return skill.name;
}

function getSkillDefinition(
  curriculum: Curriculum,
  skillName: string
): { topic: string; skill: SkillDefinition } | null {
  for (const topic of curriculum.topics) {
    for (const skill of topic.skills) {
      if (skill.name === skillName) {
        return { topic: topic.topic, skill };
      }
    }
  }
  return null;
}

export function getCorrectCount(skillName: string, progress: Progress): number {
  const attempts = progress[skillName]?.attempts || [];
  return attempts.filter((attempt) => attempt.correct).length;
}

export function getSkillStatus(
  skillName: string,
  progress: Progress,
  _curriculum?: Curriculum
): SkillStatus {
  void _curriculum;
  const attempts = progress[skillName]?.attempts || [];
  if (attempts.length === 0) return 'not_started';
  if (getCorrectCount(skillName, progress) >= MASTERY_THRESHOLD) return 'mastered';
  return 'practicing';
}

export function getAllSkillsOrdered(curriculum: Curriculum): { topic: string; skill: string }[] {
  const result: { topic: string; skill: string }[] = [];
  for (const topic of curriculum.topics) {
    for (const skill of topic.skills) {
      result.push({ topic: topic.topic, skill: getSkillName(skill) });
    }
  }
  return result;
}

// Skills attempted in the last COOLDOWN_ATTEMPTS attempts (across all
// skills) are on cooldown. Enforces "see it again only after a few other
// problems," so the next encounter is a real retrieval test.
function getSkillsOnCooldown(progress: Progress): Set<string> {
  const allAttempts: { skill: string; timestamp: string }[] = [];
  for (const [skill, record] of Object.entries(progress)) {
    for (const attempt of record?.attempts || []) {
      allAttempts.push({ skill, timestamp: attempt.timestamp });
    }
  }
  allAttempts.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const recent = allAttempts.slice(-COOLDOWN_ATTEMPTS);
  return new Set(recent.map((a) => a.skill));
}

export function getNextSkill(
  curriculum: Curriculum,
  progress: Progress
): NextSkillRecommendation | null {
  const allSkills = getAllSkillsOrdered(curriculum);
  if (allSkills.length === 0) return null;

  const cooldown = getSkillsOnCooldown(progress);

  // Phase 1: walk curriculum in order; serve the first skill the student
  // hasn't gotten right yet and isn't on cooldown.
  for (const { topic, skill } of allSkills) {
    if (cooldown.has(skill)) continue;
    if (getCorrectCount(skill, progress) === 0) {
      return { topic, skill, status: getSkillStatus(skill, progress) };
    }
  }

  // Phase 2: unretired skills that were ALL cooldowned — stranded pool.
  // Serve the oldest-attempted one to maximize retrieval gap we can offer.
  const unretired = allSkills.filter(({ skill }) => getCorrectCount(skill, progress) === 0);
  if (unretired.length > 0) {
    const byOldest = unretired
      .map(({ topic, skill }) => ({
        topic,
        skill,
        lastTimestamp: progress[skill]?.attempts.slice(-1)[0]?.timestamp || '',
      }))
      .sort((a, b) => a.lastTimestamp.localeCompare(b.lastTimestamp));
    const pick = byOldest[0];
    return { topic: pick.topic, skill: pick.skill, status: getSkillStatus(pick.skill, progress) };
  }

  // Phase 3: review mode. Every skill has ≥1 correct. Serve the one
  // attempted longest ago.
  const byOldest = allSkills
    .map(({ topic, skill }) => ({
      topic,
      skill,
      lastTimestamp: progress[skill]?.attempts.slice(-1)[0]?.timestamp || '',
    }))
    .sort((a, b) => a.lastTimestamp.localeCompare(b.lastTimestamp));
  const pick = byOldest[0];
  return { topic: pick.topic, skill: pick.skill, status: getSkillStatus(pick.skill, progress) };
}

export function getOverallProgress(
  curriculum: Curriculum,
  progress: Progress
): {
  total: number;
  mastered: number;
  practicing: number;
  notStarted: number;
} {
  const allSkills = getAllSkillsOrdered(curriculum);
  let mastered = 0;
  let practicing = 0;
  let notStarted = 0;

  for (const { skill } of allSkills) {
    const status = getSkillStatus(skill, progress);
    if (status === 'mastered') mastered += 1;
    else if (status === 'not_started') notStarted += 1;
    else practicing += 1;
  }

  return { total: allSkills.length, mastered, practicing, notStarted };
}

// P(correct on exam) per skill, given attempt history.
// Priors chosen to feel honest: 0 attempts ≈ coin-flippy, 1 correct is
// decent evidence but not overconfident, ≥2 correct is solid.
function pCorrectForSkill(skillName: string, progress: Progress): number {
  const attempts = progress[skillName]?.attempts || [];
  if (attempts.length === 0) return 0.35;
  const correctCount = attempts.filter((a) => a.correct).length;
  if (correctCount === 0) return 0.15;
  if (correctCount === 1) return 0.75;
  return 0.9;
}

// Rough uncertainty per skill: how much the P estimate could be off.
// 0 attempts: wide; 1 attempt: medium; 2+: narrow.
function uncertaintyForSkill(skillName: string, progress: Progress): number {
  const attempts = progress[skillName]?.attempts || [];
  if (attempts.length === 0) return 0.25;
  if (attempts.length === 1) return 0.12;
  return 0.05;
}

export function getExamReadiness(
  curriculum: Curriculum,
  progress: Progress
): ExamReadinessSummary {
  const alreadyKnown = curriculum.alreadyKnown || [];
  const alreadyKnownPct = alreadyKnown.reduce((acc, s) => acc + (s.examWeight || 0), 0);

  const allSkills = getAllSkillsOrdered(curriculum);
  if (allSkills.length === 0) {
    const pct = Math.round(alreadyKnownPct);
    return {
      estimatedScoreLow: pct,
      estimatedScoreHigh: pct,
      alreadyKnownPct: Math.round(alreadyKnownPct),
      readiness: alreadyKnownPct / 100,
      biggestGains: [],
    };
  }

  let weightedP = 0;
  let weightedUncertainty = 0;
  let totalCurriculumWeight = 0;
  const weakSpots: WeakSpot[] = [];

  for (const { topic, skill } of allSkills) {
    const def = getSkillDefinition(curriculum, skill)?.skill;
    const w = def?.examWeight ?? 0;
    const p = pCorrectForSkill(skill, progress);
    const u = uncertaintyForSkill(skill, progress);
    weightedP += p * w;
    weightedUncertainty += u * w;
    totalCurriculumWeight += w;
    weakSpots.push({ topic, skill, pCorrect: p });
  }

  // Expected mark: already-known (locked) + expected fraction of curriculum weight.
  const expectedCurriculumMark = weightedP; // already in "exam-weight units"
  const center = alreadyKnownPct + expectedCurriculumMark;
  const uncertainty = totalCurriculumWeight > 0 ? weightedUncertainty : 0;

  const estimatedScoreLow = Math.round(clamp(center - uncertainty, 0, 100));
  const estimatedScoreHigh = Math.round(clamp(center + uncertainty, 0, 100));
  const totalWeight = alreadyKnownPct + totalCurriculumWeight;
  const readiness = totalWeight > 0 ? center / totalWeight : 0;

  const biggestGains = [...weakSpots]
    .sort((a, b) => a.pCorrect - b.pCorrect)
    .slice(0, 3);

  return {
    estimatedScoreLow,
    estimatedScoreHigh,
    alreadyKnownPct: Math.round(alreadyKnownPct),
    readiness,
    biggestGains,
  };
}
