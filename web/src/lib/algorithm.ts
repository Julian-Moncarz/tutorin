import { Curriculum, Progress, SkillStatus } from './types';

const MASTERY_THRESHOLD = 3;
const MAX_EXAMPLES_ATTEMPTS = 5; // After this many failed attempts, move to practicing anyway

export function getSkillStatus(skill: string, progress: Progress): SkillStatus {
  const p = progress[skill];
  if (!p || p.attempts.length === 0) return 'not_started';

  const correctCount = p.attempts.filter((a) => a.correct).length;
  if (correctCount >= MASTERY_THRESHOLD) return 'mastered';

  // If first attempt was wrong and fewer than 2 correct, needs examples
  // But cap it: after MAX_EXAMPLES_ATTEMPTS total attempts, move to practicing
  if (
    p.attempts[0] &&
    !p.attempts[0].correct &&
    correctCount < 2 &&
    p.attempts.length < MAX_EXAMPLES_ATTEMPTS
  ) {
    return 'needs_examples';
  }

  return 'practicing';
}

export function getCorrectCount(skill: string, progress: Progress): number {
  const p = progress[skill];
  if (!p) return 0;
  return p.attempts.filter((a) => a.correct).length;
}

export function getNextSkill(
  curriculum: Curriculum,
  progress: Progress
): { topic: string; skill: string; status: SkillStatus } | null {
  const allSkills = getAllSkillsOrdered(curriculum);
  if (allSkills.length === 0) return null;

  // 1. Find first unattempted skill in order
  for (const { topic, skill } of allSkills) {
    const status = getSkillStatus(skill, progress);
    if (status === 'not_started') {
      return { topic, skill, status };
    }
  }

  // 2. Find skills that need more practice (not yet mastered)
  const needsPractice = allSkills.filter(({ skill }) => {
    const status = getSkillStatus(skill, progress);
    return status === 'needs_examples' || status === 'practicing';
  });

  if (needsPractice.length > 0) {
    // Interleave: pick the one with fewest correct retrievals
    const sorted = [...needsPractice].sort((a, b) => {
      return getCorrectCount(a.skill, progress) - getCorrectCount(b.skill, progress);
    });
    const { topic, skill } = sorted[0];
    return { topic, skill, status: getSkillStatus(skill, progress) };
  }

  // 3. All mastered — pick from review pool (interleaved)
  const mastered = allSkills.filter(({ skill }) => getSkillStatus(skill, progress) === 'mastered');
  if (mastered.length > 0) {
    const sorted = [...mastered].sort((a, b) => {
      const aLast = progress[a.skill]?.attempts.slice(-1)[0]?.timestamp || '';
      const bLast = progress[b.skill]?.attempts.slice(-1)[0]?.timestamp || '';
      return aLast.localeCompare(bLast);
    });
    const { topic, skill } = sorted[0];
    return { topic, skill, status: 'mastered' };
  }

  return null;
}

export function getAllSkillsOrdered(curriculum: Curriculum): { topic: string; skill: string }[] {
  const result: { topic: string; skill: string }[] = [];
  for (const t of curriculum.topics) {
    for (const s of t.skills) {
      result.push({ topic: t.topic, skill: s });
    }
  }
  return result;
}

export function getOverallProgress(curriculum: Curriculum, progress: Progress): {
  total: number;
  mastered: number;
  practicing: number;
  notStarted: number;
} {
  const allSkills = getAllSkillsOrdered(curriculum);
  let mastered = 0,
    practicing = 0,
    notStarted = 0;

  for (const { skill } of allSkills) {
    const status = getSkillStatus(skill, progress);
    if (status === 'mastered') mastered++;
    else if (status === 'not_started') notStarted++;
    else practicing++;
  }

  return { total: allSkills.length, mastered, practicing, notStarted };
}

export function shouldBeTemptation(skill: string, progress: Progress): boolean {
  return getCorrectCount(skill, progress) === 2;
}
