import { NextResponse } from 'next/server';
import { getCurriculum, getProgress } from '@/lib/files';
import { getNextSkill } from '@/lib/algorithm';

export async function GET() {
  try {
    const curriculum = getCurriculum();
    const progress = getProgress();
    const next = getNextSkill(curriculum, progress);

    if (!next) {
      return NextResponse.json({ done: true, message: 'All skills mastered!' });
    }

    return NextResponse.json(next);
  } catch (error) {
    console.error('Next skill error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
