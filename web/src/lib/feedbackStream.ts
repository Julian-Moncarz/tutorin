import { ChatMessage } from './types';

export async function streamFeedback(
  sessionId: string,
  messages: ChatMessage[],
  issueState: string,
  onText: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch('/api/feedback/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, messages, issueState }),
    signal,
  });
  if (!res.ok) throw new Error(`Feedback chat failed: ${res.status}`);
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
