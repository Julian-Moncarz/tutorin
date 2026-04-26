import {
  Curriculum,
  ExamReadinessSummary,
  NextSkillRecommendation,
  Progress,
  SkillDefinition,
} from './types';

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

// Projected exam score = sum of examWeight for skills you've actually
// earned (alreadyKnown + retired). Skills are binary in this system —
// retired or not — so the score is too. No probability, no band.
export function getExamReadiness(
  curriculum: Curriculum,
  progress: Progress
): ExamReadinessSummary {
  const alreadyKnown = curriculum.alreadyKnown || [];
  const alreadyKnownPct = alreadyKnown.reduce((acc, s) => acc + (s.examWeight || 0), 0);

  let retiredPct = 0;
  let totalCurriculumWeight = 0;
  for (const skill of getAllSkillsOrdered(curriculum)) {
    const def = findSkill(curriculum, skill);
    const w = def?.examWeight ?? 0;
    totalCurriculumWeight += w;
    if (isRetired(skill, progress)) retiredPct += w;
  }

  const earned = alreadyKnownPct + retiredPct;
  const totalWeight = alreadyKnownPct + totalCurriculumWeight;
  const readiness = totalWeight > 0 ? earned / totalWeight : 0;

  return {
    estimatedScore: Math.round(earned),
    alreadyKnownPct: Math.round(alreadyKnownPct),
    readiness,
  };
}
