import fs from 'fs';
import path from 'path';

// Tiny per-feedback-session record so a Pimberton chat can survive a
// `next dev` restart. We persist only the claude-internal session id; the
// claude CLI keeps the actual transcript at
// ~/.claude/projects/<encoded-cwd>/<claudeSessionId>.jsonl, and a fresh
// subprocess spawned with `--resume <id>` reconstitutes itself from there.
//
// The UI manages its own visible chat history client-side. This file only
// has to answer one question after a restart: "do we have a claude session
// id we can resume against for this sessionId?"

export interface ActiveFeedbackChat {
  sessionId: string;
  claudeSessionId: string;
  updatedAt: string;
}

function getStudyDir(): string {
  const dir = process.env.STUDY_DIR;
  if (!dir) throw new Error('STUDY_DIR environment variable is required.');
  return dir;
}

function safeId(sessionId: string): string {
  // Defensive: prevent path traversal via a malicious sessionId. Mirrors
  // the same conservative slug used in activeChat.ts.
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function recordPath(sessionId: string): string {
  return path.join(
    getStudyDir(),
    'feedback',
    'drafts',
    safeId(sessionId),
    'session.json'
  );
}

function writeAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

export function getActiveFeedbackChat(sessionId: string): ActiveFeedbackChat | null {
  const p = recordPath(sessionId);
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as ActiveFeedbackChat;
    if (data.sessionId !== sessionId) return null;
    if (!data.claudeSessionId) return null;
    return data;
  } catch (err) {
    console.error('[activeFeedbackChat] failed to read', p, err);
    return null;
  }
}

export function saveClaudeSessionId(sessionId: string, claudeSessionId: string): void {
  const next: ActiveFeedbackChat = {
    sessionId,
    claudeSessionId,
    updatedAt: new Date().toISOString(),
  };
  writeAtomic(recordPath(sessionId), next);
}

export function deleteActiveFeedbackChat(sessionId: string): void {
  const p = recordPath(sessionId);
  if (fs.existsSync(p)) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
}
