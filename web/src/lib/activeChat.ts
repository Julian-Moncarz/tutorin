import fs from 'fs';
import path from 'path';
import { ChatMessage } from './types';

// One in-flight tutoring chat per skill. Persisted to disk so reload (or
// even closing the tab and coming back days later) drops the user back into
// the same chat. The Claude CLI keeps the underlying transcript at
// ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl and we resume against
// that with `claude -p --resume <claudeSessionId>`.

export interface ActiveChat {
  skill: string;
  // Client-generated UUID. Identifies the chat across reloads so the
  // exercise page can pick the same one back up.
  tutorinSessionId: string;
  // Captured from the stream-json `system` init event the first time the
  // subprocess starts. `null` until the very first turn finishes.
  claudeSessionId: string | null;
  messages: ChatMessage[];
  updatedAt: string;
}

function getStudyDir(): string {
  const dir = process.env.STUDY_DIR;
  if (!dir) throw new Error('STUDY_DIR environment variable is required.');
  return dir;
}

function activeDir(): string {
  return path.join(getStudyDir(), 'logs', 'active');
}

function archiveDir(): string {
  return path.join(getStudyDir(), 'logs');
}

function safeName(skill: string): string {
  return skill.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80);
}

function activePath(skill: string): string {
  return path.join(activeDir(), `${safeName(skill)}.json`);
}

function writeAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

export function getActiveChat(skill: string): ActiveChat | null {
  const p = activePath(skill);
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as ActiveChat;
    // Defensive: if the file is for a different skill (slug collision), ignore it.
    if (data.skill !== skill) return null;
    return data;
  } catch (err) {
    console.error('[activeChat] failed to read', p, err);
    return null;
  }
}

export function saveActiveChat(chat: ActiveChat): void {
  const next: ActiveChat = { ...chat, updatedAt: new Date().toISOString() };
  writeAtomic(activePath(chat.skill), next);
}

export function appendActiveMessages(
  skill: string,
  tutorinSessionId: string,
  newMessages: ChatMessage[],
  claudeSessionId?: string | null
): ActiveChat {
  const existing = getActiveChat(skill);
  const merged: ActiveChat = {
    skill,
    tutorinSessionId,
    claudeSessionId:
      claudeSessionId !== undefined ? claudeSessionId : existing?.claudeSessionId ?? null,
    messages: [...(existing?.messages ?? []), ...newMessages],
    updatedAt: new Date().toISOString(),
  };
  // If the existing record was for a different tutorinSessionId, the user
  // started a fresh chat — overwrite cleanly.
  if (existing && existing.tutorinSessionId !== tutorinSessionId) {
    merged.messages = newMessages;
    merged.claudeSessionId = claudeSessionId ?? null;
  }
  writeAtomic(activePath(skill), merged);
  return merged;
}

// Move the active record into the archive (regular logs/) once the skill
// has been retired, so the dashboard goes back to "Start" for the next skill.
export function archiveActiveChat(skill: string, correct: boolean): void {
  const p = activePath(skill);
  if (!fs.existsSync(p)) return;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as ActiveChat;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(
      archiveDir(),
      `${stamp}_${safeName(skill)}.json`
    );
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          skill: data.skill,
          correct,
          timestamp: new Date().toISOString(),
          messages: data.messages,
          claudeSessionId: data.claudeSessionId,
        },
        null,
        2
      )
    );
    fs.unlinkSync(p);
  } catch (err) {
    console.error('[activeChat] failed to archive', p, err);
  }
}

// Discard the active record without archiving (e.g. user explicitly deleted
// the skill from the curriculum).
export function deleteActiveChat(skill: string): void {
  const p = activePath(skill);
  if (fs.existsSync(p)) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
}
