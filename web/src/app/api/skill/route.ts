import { NextRequest, NextResponse } from 'next/server';
import { getCurriculum, saveCurriculum } from '@/lib/files';
import { getSkillName } from '@/lib/algorithm';
import { deleteActiveChat } from '@/lib/activeChat';

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name');
    if (!name) {
      return NextResponse.json({ error: 'Missing skill name' }, { status: 400 });
    }

    const curriculum = getCurriculum();
    curriculum.topics = curriculum.topics.map((t) => ({
      ...t,
      skills: t.skills.filter((s) => getSkillName(s) !== name),
    }));
    saveCurriculum(curriculum);
    try { deleteActiveChat(name); } catch { /* ignore */ }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Delete skill error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
