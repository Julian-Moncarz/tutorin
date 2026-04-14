import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

function getStudyDir(): string {
  const dir = process.env.STUDY_DIR;
  if (!dir) throw new Error('STUDY_DIR env var is required');
  return dir;
}

// Parse simple YAML frontmatter with a title field.
// Accepts:
//   ---
//   title: Some title
//   state: draft
//   ---
//   body...
function parseDraft(raw: string): { title: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { title: '', body: raw.trim() };
  const fm = match[1];
  const body = match[2].replace(/^\n+/, '');
  const titleLine = fm.split('\n').find((l) => l.trim().startsWith('title:'));
  const title = titleLine ? titleLine.replace(/^\s*title:\s*/, '').trim() : '';
  return { title, body };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId') || '';
    const file = searchParams.get('file') || '';
    if (!sessionId || !file) {
      return new Response(JSON.stringify({ error: 'sessionId and file required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!/^[\w.-]+$/.test(file)) {
      return new Response(JSON.stringify({ error: 'invalid file name' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const filePath = path.join(getStudyDir(), 'feedback', 'drafts', sessionId, file);
    if (!existsSync(filePath)) {
      return new Response(JSON.stringify({ error: 'not found', path: filePath }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const raw = readFileSync(filePath, 'utf8');
    const { title, body } = parseDraft(raw);
    return new Response(JSON.stringify({ title, body, raw }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
