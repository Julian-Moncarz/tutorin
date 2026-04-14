export interface Topic {
  topic: string;
  skills: string[];
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

export type SkillStatus = 'not_started' | 'needs_examples' | 'practicing' | 'mastered';
