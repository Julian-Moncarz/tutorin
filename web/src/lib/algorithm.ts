import {
  Curriculum,
  ExamReadinessSummary,
  NextSkillRecommendation,
  Progress,
  SkillDefinition,
  SkillExamSignals,
  SkillStatus,
  WeakSpot,
} from './types';

const DEFAULT_MASTERY_THRESHOLD = 3;

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

function topicForSkill(curriculum: Curriculum, skillName: string): string {
  return getSkillDefinition(curriculum, skillName)?.topic || 'General review';
}

function estimateMinutes(timeCost: number): number {
  return Math.max(4, Math.round(10 * timeCost));
}

function coverageForSkill(skillName: string, progress: Progress, masteryTarget: number): number {
  const attempts = progress[skillName]?.attempts || [];
  if (attempts.length === 0) return 0.16;

  const correctCount = attempts.filter((attempt) => attempt.correct).length;
  const wrongCount = attempts.length - correctCount;
  const base = clamp(correctCount / masteryTarget, 0, 1);

  if (correctCount === 0) return wrongCount > 0 ? 0.28 : 0.16;
  if (base >= 1) return 1;
  return clamp(0.38 + base * 0.52, 0, 0.95);
}

export function getCorrectCount(skillName: string, progress: Progress): number {
  const attempts = progress[skillName]?.attempts || [];
  return attempts.filter((attempt) => attempt.correct).length;
}

export function getMasteryTarget(skillName: string, curriculum?: Curriculum): number {
  if (!curriculum) return DEFAULT_MASTERY_THRESHOLD;

  const definition = getSkillDefinition(curriculum, skillName)?.skill;
  if (!definition) throw new Error(`Missing skill metadata for "${skillName}"`);
  const examWeight = definition.examWeight;
  const timeCost = definition.timeCost;

  if (examWeight >= 3 || timeCost >= 1.3) return 3;
  if (examWeight >= 1) return 2;
  return 1;
}

export function getSkillSignals(
  curriculum: Curriculum,
  skillName: string,
  progress: Progress
): SkillExamSignals {
  const definition = getSkillDefinition(curriculum, skillName)?.skill;
  if (!definition) throw new Error(`Missing skill metadata for "${skillName}"`);
  const attempts = progress[skillName]?.attempts || [];
  const correctCount = getCorrectCount(skillName, progress);
  const examWeight = definition.examWeight;
  const timeCost = definition.timeCost;
  const masteryTarget = getMasteryTarget(skillName, curriculum);

  let deficit = 0.82;
  if (attempts.length === 0) deficit = 1.15;
  else if (correctCount === 0) deficit = 1;
  else if (correctCount >= masteryTarget) deficit = 0.08;
  else deficit = clamp(0.82 - (correctCount - 1) * 0.28, 0.2, 0.82);

  const flowBoost =
    attempts.length > 0 && correctCount < masteryTarget && attempts[attempts.length - 1]?.correct
      ? 1.08
      : 1;

  const roi = (examWeight * deficit * flowBoost) / timeCost;

  return {
    examWeight,
    deficit,
    timeCost,
    flowBoost,
    roi,
    masteryTarget,
  };
}

export function getSkillStatus(
  skillName: string,
  progress: Progress,
  curriculum?: Curriculum
): SkillStatus {
  const attempts = progress[skillName]?.attempts || [];
  if (attempts.length === 0) return 'not_started';

  const correctCount = getCorrectCount(skillName, progress);
  const masteryTarget = getMasteryTarget(skillName, curriculum);
  if (correctCount >= masteryTarget) return 'mastered';

  return 'practicing';
}

function buildRecommendation(
  curriculum: Curriculum,
  progress: Progress,
  skillName: string
): NextSkillRecommendation {
  const topic = topicForSkill(curriculum, skillName);
  const status = getSkillStatus(skillName, progress, curriculum);
  const signal = getSkillSignals(curriculum, skillName, progress);
  const estimatedMinutes = estimateMinutes(signal.timeCost);

  return {
    topic,
    skill: skillName,
    status,
    roi: signal.roi,
    estimatedMinutes,
    signal,
  };
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

export function getNextSkill(
  curriculum: Curriculum,
  progress: Progress
): NextSkillRecommendation | null {
  const allSkills = getAllSkillsOrdered(curriculum);
  if (allSkills.length === 0) return null;

  const active = allSkills
    .filter(({ skill }) => getSkillStatus(skill, progress, curriculum) !== 'mastered')
    .map(({ skill }) => buildRecommendation(curriculum, progress, skill))
    .sort((a, b) => b.roi - a.roi);

  if (active.length > 0) return active[0];

  const mastered = allSkills
    .map(({ skill }) => buildRecommendation(curriculum, progress, skill))
    .sort((a, b) => {
      const aLast = progress[a.skill]?.attempts.slice(-1)[0]?.timestamp || '';
      const bLast = progress[b.skill]?.attempts.slice(-1)[0]?.timestamp || '';
      return aLast.localeCompare(bLast);
    });

  return mastered[0] ?? null;
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
    const status = getSkillStatus(skill, progress, curriculum);
    if (status === 'mastered') mastered += 1;
    else if (status === 'not_started') notStarted += 1;
    else practicing += 1;
  }

  return { total: allSkills.length, mastered, practicing, notStarted };
}

export function shouldBeTemptation(skillName: string, progress: Progress): boolean {
  return getCorrectCount(skillName, progress) === 2;
}

function computeWeakSpot(
  curriculum: Curriculum,
  progress: Progress,
  skillName: string
): WeakSpot {
  const topic = topicForSkill(curriculum, skillName);
  const signal = getSkillSignals(curriculum, skillName, progress);
  const coverage = coverageForSkill(skillName, progress, signal.masteryTarget);
  const projectedGain = (1 - coverage) * signal.examWeight;

  return {
    topic,
    skill: skillName,
    projectedGain,
  };
}

function evidenceLevel(skillName: string, progress: Progress): number {
  const attempts = progress[skillName]?.attempts || [];
  if (attempts.length === 0) return 0.15;
  if (attempts.length === 1) return 0.45;
  if (attempts.length === 2) return 0.7;
  return 1;
}

export function getExamReadiness(
  curriculum: Curriculum,
  progress: Progress
): ExamReadinessSummary {
  const allSkills = getAllSkillsOrdered(curriculum);
  if (allSkills.length === 0) {
    return {
      estimatedScoreLow: 0,
      estimatedScoreHigh: 0,
      readiness: 0,
      biggestGains: [],
      nextThirtyMinutes: [],
    };
  }

  let weightedCoverage = 0;
  let totalWeight = 0;
  let evidenceGap = 0;

  const weakSpots = allSkills.map(({ skill }) => computeWeakSpot(curriculum, progress, skill));

  for (const { skill } of allSkills) {
    const signal = getSkillSignals(curriculum, skill, progress);
    const coverage = coverageForSkill(skill, progress, signal.masteryTarget);
    weightedCoverage += coverage * signal.examWeight;
    totalWeight += signal.examWeight;
    evidenceGap += (1 - evidenceLevel(skill, progress)) * signal.examWeight;
  }

  const readiness = totalWeight > 0 ? weightedCoverage / totalWeight : 0;
  const center = clamp(28 + readiness * 62, 25, 96);
  const uncertainty = clamp((evidenceGap / totalWeight) * 16 + 4, 4, 18);

  const estimatedScoreLow = Math.round(clamp(center - uncertainty, 0, 100));
  const estimatedScoreHigh = Math.round(clamp(center + uncertainty, 0, 100));

  const biggestGains = [...weakSpots]
    .sort((a, b) => b.projectedGain - a.projectedGain)
    .slice(0, 3);

  const nextThirtyMinutes: WeakSpot[] = [];
  let minutes = 0;
  for (const spot of [...biggestGains, ...weakSpots.sort((a, b) => b.projectedGain - a.projectedGain)]) {
    if (nextThirtyMinutes.some((item) => item.skill === spot.skill)) continue;
    const signal = getSkillSignals(curriculum, spot.skill, progress);
    const estimate = estimateMinutes(signal.timeCost);
    if (minutes + estimate > 32 && nextThirtyMinutes.length > 0) continue;
    nextThirtyMinutes.push(spot);
    minutes += estimate;
    if (minutes >= 24 || nextThirtyMinutes.length >= 3) break;
  }

  return {
    estimatedScoreLow,
    estimatedScoreHigh,
    readiness,
    biggestGains,
    nextThirtyMinutes,
  };
}
