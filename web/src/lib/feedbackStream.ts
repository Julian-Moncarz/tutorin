export interface ToolEvent {
  id: string;
  tool: string;
  summary: string;
  done: boolean;
  isError?: boolean;
}

export interface FeedbackStreamCallbacks {
  onText: (text: string) => void;
  onTool?: (ev: ToolEvent) => void;
  onToolDone?: (id: string, isError: boolean) => void;
  onError?: (msg: string) => void;
}

export async function streamFeedback(
  sessionId: string,
  userMessage: string,
  callbacks: FeedbackStreamCallbacks,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch('/api/feedback/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, userMessage }),
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
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      let evt: {
        type?: string;
        text?: string;
        id?: string;
        tool?: string;
        summary?: string;
        isError?: boolean;
        error?: string;
      };
      try {
        evt = JSON.parse(line.slice(6));
      } catch {
        continue;
      }

      if (evt.type === 'text' && evt.text) {
        // Pimberton interleaves text with tool calls; each text event from the
        // stream is a separate thought. Keep them on their own paragraphs so
        // they don't visually smoosh together.
        if (fullText.length > 0 && !/\n\s*$/.test(fullText)) {
          fullText += '\n\n';
        }
        fullText += evt.text;
        callbacks.onText(fullText);
      } else if (evt.type === 'tool' && evt.id && evt.tool) {
        callbacks.onTool?.({
          id: evt.id,
          tool: evt.tool,
          summary: evt.summary || '',
          done: false,
        });
      } else if (evt.type === 'tool_done' && evt.id) {
        callbacks.onToolDone?.(evt.id, !!evt.isError);
      } else if (evt.type === 'error' && evt.error) {
        callbacks.onError?.(evt.error);
      }
    }
  }
  return fullText;
}

export async function deleteFeedbackSession(sessionId: string): Promise<void> {
  try {
    await fetch(
      `/api/feedback/chat?sessionId=${encodeURIComponent(sessionId)}`,
      { method: 'DELETE', keepalive: true }
    );
  } catch {
    // Best-effort cleanup — don't block the UI if the server is down.
  }
}
