import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

const TURN_TIMEOUT_MS = 120_000;

export type StdoutEvent =
  | { type: 'text'; text: string }
  | { type: 'done' }
  | { type: 'busy' }
  | { type: 'error'; error: string };

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

  constructor(private readonly systemPrompt: string) {}

  private start() {
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--system-prompt', this.systemPrompt,
      '--dangerously-skip-permissions',
    ];
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
    const d = data as { type?: string; message?: { content?: Array<{ type?: string; text?: string }> }; result?: string; is_error?: boolean };

    if (d.type === 'assistant' && d.message?.content) {
      for (const block of d.message.content) {
        if (block.type === 'text' && block.text) {
          this.turnQueue?.push({ type: 'text', text: block.text });
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

      const deadline = Date.now() + TURN_TIMEOUT_MS;
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
const sessions = new Map<string, ClaudeSession>();

export function getOrCreateSession(
  id: string,
  buildSystemPrompt: () => string
): { session: ClaudeSession; isNew: boolean } {
  let s = sessions.get(id);
  const isNew = !s;
  if (!s) {
    s = new ClaudeSession(buildSystemPrompt());
    sessions.set(id, s);
  }
  return { session: s, isNew };
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
