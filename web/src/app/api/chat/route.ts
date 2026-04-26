import { readFileSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { getContext, saveStudentPhoto } from '@/lib/files';
import { deleteSession, getOrCreateSession, hasSession } from '@/lib/claudeSessions';
import {
  getActiveChat,
  appendActiveMessages,
  saveActiveChat,
} from '@/lib/activeChat';

const SYSTEM_PROMPT_TEMPLATE = readFileSync(
  path.join(process.cwd(), '..', 'tutor_prompt.md'),
  'utf8'
);

function buildSystemPrompt(): string {
  return SYSTEM_PROMPT_TEMPLATE.replace('{{context}}', getContext());
}

// Kept deliberately minimal — no behavior instructions here. The system
// prompt is the single source of truth for how the tutor opens a session.
function renderTurn1(skill: string): string {
  return `${skill}\n\nBegin.`;
}

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'invalid or empty JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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

    const active = getActiveChat(skill);

    // If the server doesn't already have an in-memory subprocess for this
    // sessionId, decide whether we can rebuild it via `--resume` against a
    // persisted active chat, or whether the client needs to start fresh.
    const serverHasSession = hasSession(sessionId);
    let resumeId: string | undefined;
    if (!serverHasSession && message !== null) {
      // Client wants to continue a chat the server doesn't remember.
      // Resume only if our active record matches and has a claude session id.
      if (
        active &&
        active.tutorinSessionId === sessionId &&
        active.claudeSessionId
      ) {
        resumeId = active.claudeSessionId;
      } else {
        console.warn(`[chat] session ${sessionId} unknown and no resumable record — 409`);
        deleteSession(sessionId);
        return new Response(
          JSON.stringify({ error: 'session expired', code: 'session_expired' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // The onClaudeSessionId callback runs at most once per subprocess (on
    // the system/init event). We use it to record the claude-internal id so
    // future processes can `--resume` against the same transcript.
    const onClaudeSessionId = (claudeId: string) => {
      try {
        const cur = getActiveChat(skill);
        if (cur && cur.tutorinSessionId === sessionId) {
          if (!cur.claudeSessionId) {
            saveActiveChat({ ...cur, claudeSessionId: claudeId });
          }
        } else if (!cur) {
          // Fresh begin: seed the active record now so a hard-refresh during
          // the very first turn can still resume.
          saveActiveChat({
            skill,
            tutorinSessionId: sessionId,
            claudeSessionId: claudeId,
            messages: [],
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('[chat] failed to persist claudeSessionId', err);
      }
    };

    const { session, isNew } = getOrCreateSession(
      sessionId,
      buildSystemPrompt,
      { resumeId, onClaudeSessionId }
    );

    // message === null  → "start a new session, generate first problem"
    // message !== null  → "student reply"
    if (isNew && message !== null && !resumeId) {
      // Shouldn't reach here — covered by the 409 above.
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
    const isResumingFresh = isNew && resumeId;
    let photoPath: string | null = null;
    if (image && (message !== null || isResumingFresh)) {
      try {
        photoPath = saveStudentPhoto(image);
      } catch (err) {
        console.error('[chat] failed to save student photo:', err);
        return new Response(JSON.stringify({ error: 'failed to save photo' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else if (image && isNew && !resumeId) {
      console.warn(`[chat] new session ${sessionId} received a photo — ignoring (problem must be generated first)`);
    }
    const photoLine = photoPath
      ? `\n\nAttached photo of my work at ${photoPath} — please read that file.`
      : '';

    let userMessage: string;
    if (isNew && !resumeId) {
      userMessage = renderTurn1(skill);
    } else {
      userMessage = (message as string) + photoLine;
    }

    // Persist the user-side turn before streaming. For a brand-new "begin"
    // we don't record the synthetic turn-1 prompt — it's not student-authored.
    if (message !== null) {
      appendActiveMessages(skill, sessionId, [
        { role: 'user', content: photoPath ? `📷 (photo of my work)` : (message as string) },
      ]);
    }

    const encoder = new TextEncoder();
    let assistantText = '';
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
              assistantText += evt.text;
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
          if (assistantText) {
            try {
              appendActiveMessages(skill, sessionId, [
                { role: 'assistant', content: assistantText },
              ]);
            } catch (err) {
              console.error('[chat] failed to persist assistant message', err);
            }
          }
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
