export interface SkillDefinition {
  name: string;
  examWeight: number;
}

export interface Topic {
  topic: string;
  skills: SkillDefinition[];
}

export interface AlreadyKnownSkill {
  name: string;
  examWeight: number;
}

export interface Curriculum {
  test: string;
  topics: Topic[];
  alreadyKnown?: AlreadyKnownSkill[];
}

export interface Attempt {
  timestamp: string;
  correct: boolean;
}

export interface SkillProgress {
  attempts: Attempt[];
}

export interface Progress {
  [skillName: string]: SkillProgress;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface MotivationLog {
  timestamp: string;
  feeling: 'focused' | 'tired' | 'frustrated' | 'bored';
}

export type SkillStatus = 'not_started' | 'practicing' | 'mastered';

export interface NextSkillRecommendation {
  topic: string;
  skill: string;
  status: SkillStatus;
}

export interface WeakSpot {
  topic: string;
  skill: string;
  pCorrect: number;
}

export interface ExamReadinessSummary {
  estimatedScoreLow: number;
  estimatedScoreHigh: number;
  alreadyKnownPct: number;
  readiness: number;
  biggestGains: WeakSpot[];
}
