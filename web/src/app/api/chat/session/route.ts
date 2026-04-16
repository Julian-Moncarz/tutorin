import { NextRequest } from 'next/server';
import { deleteSession } from '@/lib/claudeSessions';

function endSession(id: string) {
  if (!id) return new Response(null, { status: 400 });
  deleteSession(id);
  return new Response(null, { status: 204 });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id') || '';
  return endSession(id);
}

// Accept POST too so `navigator.sendBeacon(...)` can be used from the
// browser's `unload` / `pagehide` handlers — sendBeacon is POST-only and
// the most reliable "fire and forget" primitive for tab-close cleanup.
export async function POST(req: NextRequest) {
  let id = new URL(req.url).searchParams.get('id') || '';
  if (!id) {
    try {
      const body = await req.json();
      if (typeof body?.id === 'string') id = body.id;
    } catch {
      // sendBeacon sends body as a Blob — if it's not JSON, ignore.
    }
  }
  return endSession(id);
}
