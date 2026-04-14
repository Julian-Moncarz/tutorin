import { NextResponse } from 'next/server';
import { getCurriculum } from '@/lib/files';

export async function GET() {
  try {
    const curriculum = getCurriculum();
    return NextResponse.json(curriculum);
  } catch (error) {
    console.error('Curriculum error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
