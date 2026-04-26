import { NextRequest } from 'next/server';
import { getActiveChat, deleteActiveChat } from '@/lib/activeChat';

// GET /api/active-chat?skill=<name>
// Returns the persisted in-flight chat for this skill, or { active: null }.
export async function GET(req: NextRequest) {
  const skill = req.nextUrl.searchParams.get('skill') || '';
  if (!skill) {
    return new Response(JSON.stringify({ error: 'skill is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const active = getActiveChat(skill);
    return new Response(JSON.stringify({ active }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// DELETE /api/active-chat?skill=<name>
// Discards the active record without archiving. Used when the user
// explicitly deletes a skill from the curriculum.
export async function DELETE(req: NextRequest) {
  const skill = req.nextUrl.searchParams.get('skill') || '';
  if (!skill) {
    return new Response(JSON.stringify({ error: 'skill is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    deleteActiveChat(skill);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
