export class SessionExpiredError extends Error {
  constructor(message = 'session expired') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Explicitly tear down a server-side session. Fire-and-forget; failures are
// benign (the session will die with the server process anyway).
export function endSession(sessionId: string): void {
  if (!sessionId) return;
  try {
    fetch(`/api/chat/session?id=${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}

// Best-effort cleanup on tab close / pagehide. Uses sendBeacon when available
// (most reliable during unload) and falls back to fetch+keepalive.
export function endSessionOnUnload(sessionId: string): void {
  if (!sessionId) return;
  try {
    const url = `/api/chat/session?id=${encodeURIComponent(sessionId)}`;
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url);
      return;
    }
    fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
  } catch {
    // ignore
  }
}

// `message === null` signals "new session, generate first problem".
// Any non-null string is forwarded as the student's latest user message.
export async function streamChat(
  skill: string,
  message: string | null,
  sessionId: string,
  onText: (text: string) => void,
  signal?: AbortSignal,
  image?: string
): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill, message, sessionId, image }),
    signal,
  });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    throw new SessionExpiredError(body?.error || 'session expired');
  }
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ') && line !== 'data: [DONE]') {
        try {
          const { text } = JSON.parse(line.slice(6));
          if (text) {
            fullText += text;
            onText(fullText);
          }
        } catch {}
      }
    }
  }
  return fullText;
}

export interface QuestionPrefetch {
  skill: string;
  sessionId: string;
  text: string;
  completed: boolean;
  failed: boolean;
  controller: AbortController;
  onEvent: ((s: QuestionPrefetch) => void) | null;
}

let firstQuestionPrefetch: QuestionPrefetch | null = null;

export function startFirstQuestionPrefetch(skill: string): QuestionPrefetch {
  if (firstQuestionPrefetch && firstQuestionPrefetch.skill === skill && !firstQuestionPrefetch.failed) {
    return firstQuestionPrefetch;
  }
  if (firstQuestionPrefetch) {
    firstQuestionPrefetch.controller.abort();
    // If the superseded prefetch had a live server-side session, tear it down.
    endSession(firstQuestionPrefetch.sessionId);
  }
  const controller = new AbortController();
  const s: QuestionPrefetch = {
    skill,
    sessionId: newSessionId(),
    text: '',
    completed: false,
    failed: false,
    controller,
    onEvent: null,
  };
  firstQuestionPrefetch = s;
  streamChat(skill, null, s.sessionId, (t) => { s.text = t; s.onEvent?.(s); }, controller.signal)
    .then((full) => { s.text = full; s.completed = true; s.onEvent?.(s); })
    .catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('First-question prefetch error:', err);
      s.failed = true; s.completed = true; s.onEvent?.(s);
    });
  return s;
}

export function takeFirstQuestionPrefetch(skill: string): QuestionPrefetch | null {
  if (firstQuestionPrefetch && firstQuestionPrefetch.skill === skill) {
    const s = firstQuestionPrefetch;
    firstQuestionPrefetch = null;
    return s;
  }
  return null;
}

// Call when the app stops caring about an unconsumed prefetch (e.g. the
// student picks a different skill, or the page unmounts).
export function abandonFirstQuestionPrefetch(): void {
  if (!firstQuestionPrefetch) return;
  firstQuestionPrefetch.controller.abort();
  endSession(firstQuestionPrefetch.sessionId);
  firstQuestionPrefetch = null;
}

// Best-effort cleanup of any unconsumed prefetch on tab close, regardless
// of which page currently owns it. Runs once per module load.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (firstQuestionPrefetch) {
      endSessionOnUnload(firstQuestionPrefetch.sessionId);
    }
  });
}
