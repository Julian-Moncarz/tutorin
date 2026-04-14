import { spawn } from 'child_process';
import { readFileSync, mkdirSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { ChatMessage } from '@/lib/types';

const CLAUDE_TIMEOUT_MS = 180_000;

const PROMPT_TEMPLATE = readFileSync(
  path.join(process.cwd(), 'src/app/api/feedback/prompt.md'),
  'utf8'
);

function getStudyDir(): string {
  const dir = process.env.STUDY_DIR;
  if (!dir) throw new Error('STUDY_DIR env var is required');
  return dir;
}

function getRepoRoot(): string {
  // web/ is one level under repo root
  return path.resolve(process.cwd(), '..');
}

function buildPrompt(
  sessionId: string,
  messages: ChatMessage[],
  issueState: string
): string {
  const conversationText =
    messages.length === 0
      ? '(No messages yet. The user just opened the panel. Greet them warmly in one short sentence — e.g. "Hey — what\'s on your mind?" — and wait.)'
      : messages
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n\n');

  const sessionDir = path.join(getStudyDir(), 'feedback', 'drafts', sessionId);
  mkdirSync(sessionDir, { recursive: true });

  return PROMPT_TEMPLATE
    .replace('{{repo}}', 'Julian-Moncarz/tutorin')
    .replace('{{sessionDir}}', sessionDir)
    .replace('{{issueState}}', issueState || '(no issue filed yet)')
    .replace('{{conversationText}}', conversationText);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = String(body.sessionId || '');
    const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];
    const issueState = String(body.issueState || '');

    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'sessionId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const prompt = buildPrompt(sessionId, messages, issueState);

    const proc = spawn(
      'claude',
      ['-p', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: getRepoRoot(),
      }
    );

    proc.stdin.write(prompt);
    proc.stdin.end();

    const timeout = setTimeout(() => proc.kill('SIGTERM'), CLAUDE_TIMEOUT_MS);

    const encoder = new TextEncoder();
    let buffer = '';
    let closed = false;
    let sentText = false;

    const stream = new ReadableStream({
      start(controller) {
        const safeEnqueue = (d: Uint8Array) => { if (!closed) controller.enqueue(d); };
        const safeClose = () => {
          if (!closed) { closed = true; clearTimeout(timeout); controller.close(); }
        };
        const safeError = (e: Error) => {
          if (!closed) { closed = true; clearTimeout(timeout); controller.error(e); }
        };

        function processLine(line: string) {
          if (!line.trim()) return;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'assistant' && parsed.message?.content) {
              for (const block of parsed.message.content) {
                if (block.type === 'text' && block.text) {
                  sentText = true;
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify({ text: block.text })}\n\n`));
                }
              }
            } else if (parsed.type === 'result' && parsed.result && !sentText) {
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ text: parsed.result })}\n\n`));
            }
          } catch {
            // ignore
          }
        }

        proc.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const l of lines) processLine(l);
        });

        proc.stderr.on('data', (d: Buffer) => {
          console.error('feedback claude stderr:', d.toString());
        });

        proc.on('close', () => {
          if (buffer.trim()) processLine(buffer);
          safeEnqueue(encoder.encode('data: [DONE]\n\n'));
          safeClose();
        });

        proc.on('error', (err) => {
          console.error('feedback claude process error:', err);
          safeError(err);
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Feedback chat error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
