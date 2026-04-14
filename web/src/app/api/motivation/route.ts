import { NextRequest, NextResponse } from 'next/server';
import { logMotivation } from '@/lib/files';

const VALID_FEELINGS = ['focused', 'tired', 'frustrated', 'bored'] as const;

export async function POST(req: NextRequest) {
  try {
    const { feeling } = (await req.json()) as { feeling: string };

    if (!VALID_FEELINGS.includes(feeling as typeof VALID_FEELINGS[number])) {
      return NextResponse.json({ error: 'Invalid feeling' }, { status: 400 });
    }

    logMotivation({
      timestamp: new Date().toISOString(),
      feeling: feeling as typeof VALID_FEELINGS[number],
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Motivation log error:', error);
    return NextResponse.json({ error: 'Failed to log' }, { status: 500 });
  }
}
