import {
  Curriculum,
  ExamReadinessSummary,
  NextSkillRecommendation,
  Progress,
  SkillDefinition,
  WeakSpot,
} from './types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getSkillName(skill: SkillDefinition): string {
  return skill.name;
}

function findSkill(curriculum: Curriculum, skillName: string): SkillDefinition | null {
  for (const topic of curriculum.topics) {
    for (const skill of topic.skills) {
      if (skill.name === skillName) return skill;
    }
  }
  return null;
}

export function getCorrectCount(skillName: string, progress: Progress): number {
  const attempts = progress[skillName]?.attempts || [];
  return attempts.filter((attempt) => attempt.correct).length;
}

export function isRetired(skillName: string, progress: Progress): boolean {
  return getCorrectCount(skillName, progress) > 0;
}

export function getAllSkillsOrdered(curriculum: Curriculum): string[] {
  const result: string[] = [];
  for (const topic of curriculum.topics) {
    for (const skill of topic.skills) {
      result.push(getSkillName(skill));
    }
  }
  return result;
}

// Walk curriculum in order; serve the first un-retired skill.
// If every skill is retired, the student is done.
export function getNextSkill(
  curriculum: Curriculum,
  progress: Progress
): NextSkillRecommendation | null {
  for (const skill of getAllSkillsOrdered(curriculum)) {
    if (!isRetired(skill, progress)) return { skill };
  }
  return null;
}

// P(correct on exam) per skill. Under teach-till-✅ a skill is either
// un-retired (no signal) or retired (1 correct attempt).
function pCorrectForSkill(skillName: string, progress: Progress): number {
  return isRetired(skillName, progress) ? 0.85 : 0.35;
}

function uncertaintyForSkill(skillName: string, progress: Progress): number {
  return isRetired(skillName, progress) ? 0.08 : 0.25;
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

  for (const skill of allSkills) {
    const def = findSkill(curriculum, skill);
    const w = def?.examWeight ?? 0;
    const p = pCorrectForSkill(skill, progress);
    const u = uncertaintyForSkill(skill, progress);
    weightedP += p * w;
    weightedUncertainty += u * w;
    totalCurriculumWeight += w;
    weakSpots.push({ skill, pCorrect: p });
  }

  const center = alreadyKnownPct + weightedP;
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
