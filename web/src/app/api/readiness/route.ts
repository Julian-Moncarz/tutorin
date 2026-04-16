import { NextResponse } from 'next/server';
import { getCurriculum, getProgress } from '@/lib/files';
import { getExamReadiness } from '@/lib/algorithm';

export async function GET() {
  try {
    const curriculum = getCurriculum();
    const progress = getProgress();
    const readiness = getExamReadiness(curriculum, progress);

    return NextResponse.json(readiness);
  } catch (error) {
    console.error('Readiness error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
