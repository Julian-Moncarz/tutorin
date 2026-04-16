import { readFileSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { getContext, getCurriculum, getProgress, saveStudentPhoto } from '@/lib/files';
import { getSkillStatus, shouldBeTemptation } from '@/lib/algorithm';
import { deleteSession, getOrCreateSession } from '@/lib/claudeSessions';

const TURN1_TEMPLATE = readFileSync(
  path.join(process.cwd(), 'src/app/api/chat/tutor-turn1-template.md'),
  'utf8'
);

const SYSTEM_PROMPT_TEMPLATE = readFileSync(
  path.join(process.cwd(), 'src/app/api/chat/tutor-system-prompt.md'),
  'utf8'
);

function buildSystemPrompt(): string {
  return SYSTEM_PROMPT_TEMPLATE.replace('{{context}}', getContext());
}

function renderTurn1(
  skill: string,
  attemptHistory: string,
  status: string,
  isTemptation: boolean
): string {
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

  return TURN1_TEMPLATE
    .replace(/\{\{skill\}\}/g, skill)
    .replace('{{attemptHistory}}', attemptHistory)
    .replace('{{status}}', status)
    .replace('{{temptationBlock}}', temptationBlock)
    .replace('{{adaptiveBlock}}', adaptiveBlock);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const skill = String(body.skill || '');
    const sessionId = String(body.sessionId || '');
    const rawMessage = body.message;
    const message: string | null =
      rawMessage === null || rawMessage === undefined
        ? null
        : typeof rawMessage === 'string'
          ? rawMessage
          : null;
    const image = typeof body.image === 'string' && body.image.length > 0 ? body.image : null;

    const MAX_IMAGE_BYTES = 12_000_000; // ~12 MB of base64 ≈ 9 MB binary
    if (image && image.length > MAX_IMAGE_BYTES) {
      return new Response(JSON.stringify({ error: 'image too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!skill) {
      return new Response(JSON.stringify({ error: 'skill is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'sessionId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { session, isNew } = getOrCreateSession(sessionId, buildSystemPrompt);

    // message === null  → "start a new session, generate first problem" (isNew must be true)
    // message !== null  → "student reply in an existing session" (isNew must be false)
    if (isNew && message !== null) {
      // Client has a message to send but the server doesn't know this session —
      // it was swept, the server restarted, or the client hand-rolled a bad id.
      // Delete the accidental new-session and tell the client to start fresh.
      console.warn(`[chat] session ${sessionId} not on server but client sent a message — returning 409`);
      deleteSession(sessionId);
      return new Response(
        JSON.stringify({ error: 'session expired', code: 'session_expired' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!isNew && message === null) {
      return new Response(
        JSON.stringify({ error: 'message required for existing session' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Photo only applies to follow-ups — a fresh session has no problem yet
    // for the student to have worked on.
    let photoPath: string | null = null;
    if (image && !isNew) {
      try {
        photoPath = saveStudentPhoto(image);
      } catch (err) {
        console.error('[chat] failed to save student photo:', err);
        return new Response(JSON.stringify({ error: 'failed to save photo' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else if (image && isNew) {
      console.warn(`[chat] new session ${sessionId} received a photo — ignoring (problem must be generated first)`);
    }
    const photoLine = photoPath
      ? `\n\nAttached photo of my work at ${photoPath} — please read that file.`
      : '';

    let userMessage: string;
    if (isNew) {
      const curriculum = getCurriculum();
      const progress = getProgress();
      const status = getSkillStatus(skill, progress, curriculum);
      const isTemptation = shouldBeTemptation(skill, progress);
      const attemptHistory =
        progress[skill]?.attempts
          .map((a, i) => `Attempt ${i + 1}: ${a.correct ? 'Correct' : 'Incorrect'} (${a.timestamp})`)
          .join('\n') || 'No previous attempts.';
      userMessage = renderTurn1(skill, attemptHistory, status, isTemptation);
    } else {
      userMessage = (message as string) + photoLine;
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

        try {
          await session.send(userMessage, (evt) => {
            if (evt.type === 'text') {
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ text: evt.text })}\n\n`)
              );
            } else if (evt.type === 'busy') {
              console.warn(`[chat] session ${sessionId} is busy — concurrent turn rejected`);
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ error: 'session busy' })}\n\n`)
              );
            } else if (evt.type === 'error') {
              console.error(`[chat] session error for ${sessionId}: ${evt.error}`);
              deleteSession(sessionId);
            }
            // done: nothing to emit; the promise will resolve
          });
        } catch (err) {
          console.error('[chat] stream error', err);
        } finally {
          safeEnqueue(encoder.encode('data: [DONE]\n\n'));
          safeClose();
        }
      },
      cancel() {
        // Client closed the stream. Do NOT kill the subprocess — let the
        // turn run to completion so the session stays usable and busy clears
        // naturally. safeEnqueue will no-op once the controller is closed.
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
