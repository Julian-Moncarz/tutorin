import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { NextRequest } from 'next/server';

const pExec = promisify(execFile);

const UPSTREAM_REPO = 'Julian-Moncarz/tutorin';
const FEEDBACK_LABEL = 'user-feedback';

function getRepoRoot(): string {
  return path.resolve(process.cwd(), '..');
}

// Ensure the label exists. `gh label create` with --force is idempotent
// (creates or updates). Swallow errors: worst case, the issue gets filed
// without the label, which is better than the whole flow failing.
async function ensureLabel(cwd: string) {
  try {
    await pExec(
      'gh',
      [
        'label',
        'create',
        FEEDBACK_LABEL,
        '--repo',
        UPSTREAM_REPO,
        '--color',
        'FBCA04',
        '--description',
        'Collected via in-app feedback flow',
        '--force',
      ],
      { cwd }
    );
  } catch (err) {
    console.warn('ensureLabel failed (continuing without label):', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { title, body } = await req.json();
    if (!title || !body) {
      return new Response(JSON.stringify({ error: 'title and body required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const cwd = getRepoRoot();
    await ensureLabel(cwd);
    // Always file upstream so feedback from forks still lands in the canonical repo.
    const { stdout } = await pExec(
      'gh',
      [
        'issue',
        'create',
        '--repo',
        UPSTREAM_REPO,
        '--title',
        title,
        '--body',
        body,
        '--label',
        FEEDBACK_LABEL,
      ],
      { maxBuffer: 4 * 1024 * 1024, cwd }
    );
    const url = stdout.trim().split('\n').pop() || '';
    const m = url.match(/\/issues\/(\d+)/);
    const number = m ? Number(m[1]) : null;
    return new Response(JSON.stringify({ url, number }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    const msg = e.stderr || e.message || String(err);
    console.error('gh issue create failed:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
