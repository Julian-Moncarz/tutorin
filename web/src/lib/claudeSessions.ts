import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

const DEFAULT_TURN_TIMEOUT_MS = 120_000;

export interface SessionOptions {
  turnTimeoutMs?: number;
  // If set, the subprocess is started with `--resume <id>` so it picks up
  // the existing claude-code transcript instead of starting fresh. The
  // system prompt baked into the original session is reused; we don't pass
  // --system-prompt on resume.
  resumeId?: string;
  // Fired once when the stream-json `system` init event arrives, carrying
  // the claude-internal session id. Use it to persist the id so a future
  // process can `--resume` against this transcript.
  onClaudeSessionId?: (id: string) => void;
}

export type StdoutEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; tool: string; summary: string }
  | { type: 'tool_done'; id: string; isError?: boolean }
  | { type: 'done' }
  | { type: 'busy' }
  | { type: 'error'; error: string };

function summarizeToolUse(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;
  const pick = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
  switch (name) {
    case 'Bash': return pick('command');
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit': return pick('file_path');
    case 'Grep':
    case 'Glob': return pick('pattern');
    case 'WebFetch': return pick('url');
    case 'Task': return (pick('description') || pick('prompt')).split('\n')[0];
    default:
      for (const v of Object.values(i)) {
        if (typeof v === 'string' && v.length > 0) return v;
      }
      return '';
  }
}

class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(v: T) => void> = [];

  push(v: T) {
    const w = this.waiters.shift();
    if (w) w(v);
    else this.items.push(v);
  }

  pull(): Promise<T> {
    const v = this.items.shift();
    if (v !== undefined) return Promise.resolve(v);
    return new Promise<T>((resolve) => this.waiters.push(resolve));
  }
}

export class ClaudeSession {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private turnQueue: AsyncQueue<StdoutEvent> | null = null;
  private busy = false;

  constructor(
    private readonly systemPrompt: string,
    private readonly options: SessionOptions = {}
  ) {}

  private start() {
    const baseArgs = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--effort', 'medium',
      '--dangerously-skip-permissions',
    ];
    const args = this.options.resumeId
      ? ['--resume', this.options.resumeId, ...baseArgs]
      : ['--system-prompt', this.systemPrompt, ...baseArgs];
    const proc = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.buf = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      this.buf += chunk.toString();
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (line) this.handleLine(line);
      }
    });

    proc.stderr.on('data', (d: Buffer) => {
      console.error('[claude session stderr]', d.toString().trim());
    });

    proc.stdin.on('error', (err) => {
      console.error('[claude session stdin error]', err);
      if (this.turnQueue) {
        this.turnQueue.push({ type: 'error', error: `stdin error: ${String(err)}` });
      }
    });

    proc.on('close', (code) => {
      console.log(`[claude session] process closed code=${code}`);
      if (this.turnQueue) {
        this.turnQueue.push({ type: 'error', error: `process closed (code=${code})` });
      }
      if (this.proc === proc) this.proc = null;
    });

    proc.on('error', (err) => {
      console.error('[claude session] process error', err);
      if (this.turnQueue) {
        this.turnQueue.push({ type: 'error', error: String(err) });
      }
    });
  }

  private handleLine(line: string) {
    let data: unknown;
    try { data = JSON.parse(line); } catch { return; }
    if (!data || typeof data !== 'object') return;
    const d = data as {
      type?: string;
      subtype?: string;
      session_id?: string;
      message?: {
        role?: string;
        content?: Array<{
          type?: string;
          text?: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          is_error?: boolean;
        }>;
      };
      result?: string;
      is_error?: boolean;
    };

    if (d.type === 'system' && d.subtype === 'init' && d.session_id) {
      try { this.options.onClaudeSessionId?.(d.session_id); } catch { /* ignore */ }
      return;
    }

    if (d.type === 'assistant' && d.message?.content) {
      for (const block of d.message.content) {
        if (block.type === 'text' && block.text) {
          this.turnQueue?.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use' && block.id && block.name) {
          this.turnQueue?.push({
            type: 'tool',
            id: block.id,
            tool: block.name,
            summary: summarizeToolUse(block.name, block.input),
          });
        }
      }
    } else if (d.type === 'user' && d.message?.content) {
      for (const block of d.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          this.turnQueue?.push({
            type: 'tool_done',
            id: block.tool_use_id,
            isError: !!block.is_error,
          });
        }
      }
    } else if (d.type === 'result') {
      if (d.is_error && d.result) {
        this.turnQueue?.push({ type: 'error', error: d.result });
      } else {
        this.turnQueue?.push({ type: 'done' });
      }
    }
  }

  isAlive(): boolean {
    return !!this.proc && this.proc.exitCode === null && !this.proc.killed;
  }

  isBusy(): boolean {
    return this.busy;
  }

  // Runs a turn to completion regardless of whether the caller keeps listening.
  // `onEvent` may be called after the caller has stopped caring (e.g. HTTP
  // request aborted); the callback is responsible for being abort-safe.
  async send(userMessage: string, onEvent: (e: StdoutEvent) => void): Promise<void> {
    if (this.busy) {
      onEvent({ type: 'busy' });
      return;
    }
    this.busy = true;
    const queue = new AsyncQueue<StdoutEvent>();
    this.turnQueue = queue;

    try {
      if (!this.isAlive()) this.start();

      const msg = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: userMessage },
      });

      try {
        this.proc!.stdin.write(msg + '\n');
      } catch (err) {
        onEvent({ type: 'error', error: `stdin write failed: ${String(err)}` });
        this.killProc();
        return;
      }

      const deadline = Date.now() + (this.options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS);
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          onEvent({ type: 'error', error: 'turn timeout' });
          this.killProc();
          return;
        }
        let timer: NodeJS.Timeout | null = null;
        const evt = await Promise.race([
          queue.pull(),
          new Promise<StdoutEvent>((resolve) => {
            timer = setTimeout(() => resolve({ type: 'error', error: 'turn timeout' }), remaining);
          }),
        ]);
        if (timer) clearTimeout(timer);
        if (evt.type === 'error') {
          onEvent(evt);
          this.killProc();
          return;
        }
        onEvent(evt);
        if (evt.type === 'done') return;
      }
    } finally {
      this.busy = false;
      if (this.turnQueue === queue) this.turnQueue = null;
    }
  }

  killProc() {
    if (this.proc) {
      try { this.proc.kill('SIGTERM'); } catch { /* ignore */ }
      this.proc = null;
    }
  }
}

// Module-level registry. Sessions live until the client explicitly DELETEs
// them (via /api/chat/session) or the Node process exits. No idle sweeper —
// clients are expected to tear down on Next, page unmount, and tab close
// (via fetch keepalive:true).
// Pinned to globalThis so Next.js dev module re-evaluation (first-time
// compile of a route that also imports this module) doesn't orphan the Map.
const sessions: Map<string, ClaudeSession> =
  ((globalThis as unknown) as { __tutorinSessions?: Map<string, ClaudeSession> })
    .__tutorinSessions ??= new Map<string, ClaudeSession>();

export function getOrCreateSession(
  id: string,
  buildSystemPrompt: () => string,
  options?: SessionOptions
): { session: ClaudeSession; isNew: boolean } {
  let s = sessions.get(id);
  const isNew = !s;
  if (!s) {
    s = new ClaudeSession(buildSystemPrompt(), options ?? {});
    sessions.set(id, s);
  }
  return { session: s, isNew };
}

export function hasSession(id: string): boolean {
  return sessions.has(id);
}

export function deleteSession(id: string) {
  const s = sessions.get(id);
  if (s) {
    s.killProc();
    sessions.delete(id);
  }
}

export function sessionCount(): number {
  return sessions.size;
}
