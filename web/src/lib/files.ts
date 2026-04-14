import fs from 'fs';
import path from 'path';
import os from 'os';
import { Curriculum, Progress, MotivationLog, ChatMessage } from './types';

function getStudyDir(): string {
  const dir = process.env.STUDY_DIR;
  if (!dir) throw new Error('STUDY_DIR environment variable is required. Set it to your study folder path.');
  return dir;
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error(`Failed to parse ${filePath}:`, e);
    return fallback;
  }
}

// Atomic write: write to temp file then rename (prevents corruption from concurrent writes)
function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

export function getCurriculum(): Curriculum {
  const filePath = path.join(getStudyDir(), 'curriculum.json');
  const result = readJsonSafe<Curriculum | null>(filePath, null);
  if (!result) {
    throw new Error(`No curriculum.json found in ${getStudyDir()}. Run the intake skill first.`);
  }
  return result;
}

export function getProgress(): Progress {
  const filePath = path.join(getStudyDir(), 'progress.json');
  return readJsonSafe<Progress>(filePath, {});
}

export function saveProgress(progress: Progress): void {
  const filePath = path.join(getStudyDir(), 'progress.json');
  writeJsonAtomic(filePath, progress);
}

export function getContext(): string {
  const filePath = path.join(getStudyDir(), 'context.md');
  if (!fs.existsSync(filePath)) return 'No course context available.';
  return fs.readFileSync(filePath, 'utf-8');
}

export function saveCurriculum(curriculum: Curriculum): void {
  const filePath = path.join(getStudyDir(), 'curriculum.json');
  writeJsonAtomic(filePath, curriculum);
}

export function logConversation(
  skill: string,
  messages: ChatMessage[],
  correct: boolean
): void {
  const logsDir = path.join(getStudyDir(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeSkill = skill.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
  const filename = `${timestamp}_${safeSkill}.json`;

  fs.writeFileSync(
    path.join(logsDir, filename),
    JSON.stringify({ skill, correct, timestamp: new Date().toISOString(), messages }, null, 2)
  );
}

export function logMotivation(entry: MotivationLog): void {
  const logsDir = path.join(getStudyDir(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const filePath = path.join(logsDir, 'motivation.json');
  const existing = readJsonSafe<MotivationLog[]>(filePath, []);
  existing.push(entry);
  writeJsonAtomic(filePath, existing);
}
