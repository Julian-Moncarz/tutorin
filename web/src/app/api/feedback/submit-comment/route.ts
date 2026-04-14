import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { NextRequest } from 'next/server';

const pExec = promisify(execFile);

const UPSTREAM_REPO = 'Julian-Moncarz/tutorin';

function getRepoRoot(): string {
  return path.resolve(process.cwd(), '..');
}

export async function POST(req: NextRequest) {
  try {
    const { issueNumber, body } = await req.json();
    if (!issueNumber || !body) {
      return new Response(JSON.stringify({ error: 'issueNumber and body required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const { stdout } = await pExec(
      'gh',
      [
        'issue',
        'comment',
        String(issueNumber),
        '--repo',
        UPSTREAM_REPO,
        '--body',
        body,
      ],
      { maxBuffer: 4 * 1024 * 1024, cwd: getRepoRoot() }
    );
    const url = stdout.trim().split('\n').pop() || '';
    return new Response(JSON.stringify({ url }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    const msg = e.stderr || e.message || String(err);
    console.error('gh issue comment failed:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
