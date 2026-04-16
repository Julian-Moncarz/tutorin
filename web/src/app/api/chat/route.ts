import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { getContext, getCurriculum, getProgress } from '@/lib/files';
import { getSkillStatus, shouldBeTemptation } from '@/lib/algorithm';
import { ChatMessage } from '@/lib/types';

const CLAUDE_TIMEOUT_MS = 90_000;

const PROMPT_TEMPLATE = readFileSync(
  path.join(process.cwd(), 'src/app/api/chat/tutor-prompt.md'),
  'utf8'
);

function buildPrompt(
  skill: string,
  messages: ChatMessage[],
  context: string,
  attemptHistory: string,
  status: string,
  isTemptation: boolean
): string {
  const conversationText = messages
    .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
    .join('\n\n');

  const temptationBlock = isTemptation
    ? '\n** THIS SHOULD BE A TEMPTATION PROBLEM: Generate a problem that LOOKS like this skill but actually requires a different approach. Test whether the student can discriminate between similar-looking problems. **\n'
    : '';

  const adaptiveBlock = [
    status === 'practicing'
      ? `- The student is improving. Focus feedback on errors. Don't over-explain what they already know. Increase difficulty slightly.`
      : '',
    status === 'mastered'
      ? `- The student has mastered this. This is REVIEW. Keep feedback brief — "Correct. Nice work recognizing [key insight]." Vary the problem.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const taskBlock =
    messages.length === 0
      ? `## Task\nWrite ONE minimal exam-style problem that tests the skill: "${skill}".\n\n- Output ONLY the problem statement. No title, no preamble, no meta-commentary, no hints, no encouragement, no closing remarks.\n- Keep it as short as possible while still testing the skill. Match the test's style/notation. Multi-part is fine if the skill description has multiple parts.\n- Do not include "Notes:" or guidance about how to approach it.`
      : `## Conversation So Far\n${conversationText}\n\nRespond to the student's latest message following the guidelines above.`;

  return PROMPT_TEMPLATE
    .replace('{{context}}', context)
    .replace('{{skill}}', skill)
    .replace('{{attemptHistory}}', attemptHistory)
    .replace('{{status}}', status)
    .replace('{{temptationBlock}}', temptationBlock)
    .replace('{{adaptiveBlock}}', adaptiveBlock)
    .replace('{{taskBlock}}', taskBlock);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const skill = String(body.skill || '');
    const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];

    if (!skill) {
      return new Response(JSON.stringify({ error: 'skill is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const context = getContext();
    const curriculum = getCurriculum();
    const progress = getProgress();
    const status = getSkillStatus(skill, progress, curriculum);
    const isTemptation = shouldBeTemptation(skill, progress);

    const attemptHistory =
      progress[skill]?.attempts
        .map((a, i) => `Attempt ${i + 1}: ${a.correct ? 'Correct' : 'Incorrect'} (${a.timestamp})`)
        .join('\n') || 'No previous attempts.';

    const prompt = buildPrompt(skill, messages, context, attemptHistory, status, isTemptation);

    const proc = spawn('claude', ['-p', '--verbose', '--output-format', 'stream-json'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    // Kill process after timeout
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
    }, CLAUDE_TIMEOUT_MS);

    const encoder = new TextEncoder();
    let buffer = '';
    let closed = false;
    let sentText = false;

    const stream = new ReadableStream({
      start(controller) {
        function safeEnqueue(data: Uint8Array) {
          if (!closed) controller.enqueue(data);
        }

        function safeClose() {
          if (!closed) {
            closed = true;
            clearTimeout(timeout);
            controller.close();
          }
        }

        function safeError(err: Error) {
          if (!closed) {
            closed = true;
            clearTimeout(timeout);
            controller.error(err);
          }
        }

        function processLine(line: string) {
          if (!line.trim()) return;
          try {
            const parsed = JSON.parse(line);
            // Handle claude CLI --verbose --output-format stream-json
            if (parsed.type === 'assistant' && parsed.message?.content) {
              for (const block of parsed.message.content) {
                if (block.type === 'text' && block.text) {
                  sentText = true;
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify({ text: block.text })}\n\n`));
                }
              }
            } else if (parsed.type === 'result' && parsed.result && !sentText) {
              // Final result fallback — only if no assistant message was sent
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ text: parsed.result })}\n\n`));
            }
          } catch {
            // Not valid JSON or unexpected format
          }
        }

        proc.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            processLine(line);
          }
        });

        proc.stderr.on('data', (d: Buffer) => {
          console.error('claude stderr:', d.toString());
        });

        proc.on('close', () => {
          if (buffer.trim()) processLine(buffer);
          safeEnqueue(encoder.encode('data: [DONE]\n\n'));
          safeClose();
        });

        proc.on('error', (err) => {
          console.error('claude process error:', err);
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
    console.error('Chat error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
