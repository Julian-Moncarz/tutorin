import { spawn } from 'child_process';
import { NextRequest, NextResponse } from 'next/server';
import { ChatMessage } from '@/lib/types';

function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', '--output-format', 'text'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('claude assessment timed out'));
    }, 30_000);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('close', (code: number | null) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`claude exited ${code}: ${stderr}`));
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const skill = String(body.skill || '');
    const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];

    const conversation = messages
      .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
      .join('\n\n');

    const prompt = `Based on this tutoring conversation about the skill "${skill}", did the student ultimately demonstrate correct understanding and execution?

Consider:
- Their FINAL understanding, not just initial attempts
- Whether they grasped the concept after feedback
- Whether they could explain why the approach works

Conversation:
${conversation}

Respond with ONLY the word CORRECT or INCORRECT.`;

    const response = await callClaude(prompt);
    const upper = response.trim().toUpperCase();
    const correct = upper === 'CORRECT' || (upper.includes('CORRECT') && !upper.includes('INCORRECT'));

    return NextResponse.json({ correct });
  } catch (error) {
    console.error('Assess error:', error);
    // Return error status so frontend knows this was a failure, not an incorrect assessment
    return NextResponse.json(
      { error: 'Assessment failed', correct: null },
      { status: 500 }
    );
  }
}
