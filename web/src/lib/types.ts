export interface SkillDefinition {
  name: string;
  examWeight: number;
  timeCost: number;
}

export interface Topic {
  topic: string;
  skills: SkillDefinition[];
}

export interface Curriculum {
  test: string;
  topics: Topic[];
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

export interface SkillExamSignals {
  examWeight: number;
  deficit: number;
  timeCost: number;
  flowBoost: number;
  roi: number;
  masteryTarget: number;
}

export interface NextSkillRecommendation {
  topic: string;
  skill: string;
  status: SkillStatus;
  roi: number;
  estimatedMinutes: number;
  signal: SkillExamSignals;
}

export interface WeakSpot {
  topic: string;
  skill: string;
  projectedGain: number;
}

export interface ExamReadinessSummary {
  estimatedScoreLow: number;
  estimatedScoreHigh: number;
  readiness: number;
  biggestGains: WeakSpot[];
  nextThirtyMinutes: WeakSpot[];
}
