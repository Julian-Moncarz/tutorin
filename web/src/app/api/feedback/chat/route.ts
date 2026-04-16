import { readFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { NextRequest } from 'next/server';
import { deleteSession, getOrCreateSession } from '@/lib/claudeSessions';

const PROMPT_TEMPLATE = readFileSync(
  path.join(process.cwd(), 'src/app/api/feedback/prompt.md'),
  'utf8'
);

// Feedback turns can include npm ci, playwright install, etc. — give Pimberton
// 10 minutes so a single turn that kicks off a prototype has headroom.
const FEEDBACK_TURN_TIMEOUT_MS = 600_000;

const REPO = 'Julian-Moncarz/tutorin';

function getStudyDir(): string {
  const dir = process.env.STUDY_DIR;
  if (!dir) throw new Error('STUDY_DIR env var is required');
  return dir;
}

function getRepoRoot(): string {
  return path.resolve(process.cwd(), '..');
}

function buildSystemPrompt(sessionDir: string): string {
  return PROMPT_TEMPLATE
    .replaceAll('{{repo}}', REPO)
    .replaceAll('{{repoRoot}}', getRepoRoot())
    .replaceAll('{{sessionDir}}', sessionDir);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = String(body.sessionId || '');
    const userMessage = typeof body.userMessage === 'string' ? body.userMessage : '';

    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'sessionId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sessionDir = path.join(getStudyDir(), 'feedback', 'drafts', sessionId);
    mkdirSync(sessionDir, { recursive: true });

    const { session, isNew } = getOrCreateSession(
      sessionId,
      () => buildSystemPrompt(sessionDir),
      { turnTimeoutMs: FEEDBACK_TURN_TIMEOUT_MS }
    );

    // If the UI opens a fresh session without typing anything, prompt Pimberton
    // to greet. Later "empty" messages (mid-session) are ignored.
    let msgToSend = userMessage;
    if (!msgToSend) {
      if (isNew) {
        msgToSend =
          '[SYSTEM] The user just opened the feedback panel. Greet them warmly as Pimberton in one short sentence and ask what is on their mind.';
      } else {
        return new Response(JSON.stringify({ error: 'userMessage is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const safeEnqueue = (data: Uint8Array) => {
          if (closed) return;
          try { controller.enqueue(data); } catch { closed = true; }
        };
        const safeClose = () => {
          if (!closed) { closed = true; try { controller.close(); } catch { /* already closed */ } }
        };
        const send = (obj: unknown) => {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        try {
          await session.send(msgToSend, (evt) => {
            if (evt.type === 'text') {
              send({ type: 'text', text: evt.text });
            } else if (evt.type === 'tool') {
              send({ type: 'tool', id: evt.id, tool: evt.tool, summary: evt.summary });
            } else if (evt.type === 'tool_done') {
              send({ type: 'tool_done', id: evt.id, isError: evt.isError });
            } else if (evt.type === 'busy') {
              send({ type: 'error', error: 'session busy' });
            } else if (evt.type === 'error') {
              console.error(`[feedback] session error for ${sessionId}: ${evt.error}`);
              send({ type: 'error', error: evt.error });
              deleteSession(sessionId);
            }
          });
        } catch (err) {
          console.error('[feedback] stream error', err);
        } finally {
          safeEnqueue(encoder.encode('data: [DONE]\n\n'));
          safeClose();
        }
      },
      cancel() {
        // Client bailed. Leave the turn running so the session stays usable.
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

function cleanupSandbox(sessionDir: string) {
  const hintPath = path.join(sessionDir, '.sandbox');
  if (!existsSync(hintPath)) return;
  let sandboxPath = '';
  let port = '';
  try {
    const [p, prt] = readFileSync(hintPath, 'utf8').split('\n');
    sandboxPath = (p || '').trim();
    port = (prt || '').trim();
  } catch {
    return;
  }
  // Kill the prototype dev server by port pattern. Don't trust npm PIDs.
  if (port && /^\d+$/.test(port)) {
    try {
      spawnSync('pkill', ['-f', `next dev.*-p ${port}`], { stdio: 'ignore' });
    } catch {
      // Ignore — pkill may not be on PATH in every environment.
    }
  }
  // Wipe the sandbox. Safety rail: must be under /Users/julianmoncarz/tutorin-wt/
  // so we can't accidentally blow up anything else.
  if (
    sandboxPath &&
    sandboxPath.startsWith('/Users/julianmoncarz/tutorin-wt/') &&
    existsSync(sandboxPath)
  ) {
    try {
      rmSync(sandboxPath, { recursive: true, force: true });
    } catch (err) {
      console.error('[feedback] sandbox rm failed:', err);
    }
  }
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const sessionDir = path.join(getStudyDir(), 'feedback', 'drafts', sessionId);
  cleanupSandbox(sessionDir);
  deleteSession(sessionId);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
