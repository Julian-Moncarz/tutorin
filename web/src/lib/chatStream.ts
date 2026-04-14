import { ChatMessage } from './types';

export async function streamChat(
  skill: string,
  messages: ChatMessage[],
  onText: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill, messages }),
    signal,
  });
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
  firstQuestionPrefetch?.controller.abort();
  const controller = new AbortController();
  const s: QuestionPrefetch = {
    skill, text: '', completed: false, failed: false, controller, onEvent: null,
  };
  firstQuestionPrefetch = s;
  streamChat(skill, [], (t) => { s.text = t; s.onEvent?.(s); }, controller.signal)
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
