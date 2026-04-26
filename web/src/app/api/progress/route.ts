import { NextRequest, NextResponse } from 'next/server';
import { getProgress, saveProgress, logConversation } from '@/lib/files';
import { archiveActiveChat } from '@/lib/activeChat';
import { ChatMessage } from '@/lib/types';

export async function GET() {
  try {
    const progress = getProgress();
    return NextResponse.json(progress);
  } catch (error) {
    console.error('Progress read error:', error);
    return NextResponse.json({}, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const skill = String(body.skill || '');
    const correct = body.correct === true;
    const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];

    if (!skill) {
      return NextResponse.json({ error: 'skill is required' }, { status: 400 });
    }

    const progress = getProgress();
    if (!progress[skill]) {
      progress[skill] = { attempts: [] };
    }
    progress[skill].attempts.push({
      timestamp: new Date().toISOString(),
      correct,
    });
    saveProgress(progress);
    logConversation(skill, messages, correct);
    // Once a skill is retired, the in-flight active chat is archived so the
    // dashboard goes back to "Start" for the next skill.
    if (correct) {
      try { archiveActiveChat(skill, true); } catch (err) { console.error('[progress] archive failed', err); }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Progress save error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
