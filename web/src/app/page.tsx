'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Curriculum, Progress, SkillStatus } from '@/lib/types';
import { startFirstQuestionPrefetch } from '@/lib/chatStream';

function getSkillStatusClient(skill: string, progress: Progress): SkillStatus {
  const p = progress[skill];
  if (!p || p.attempts.length === 0) return 'not_started';
  const correctCount = p.attempts.filter((a) => a.correct).length;
  if (correctCount >= 3) return 'mastered';
  if (p.attempts[0] && !p.attempts[0].correct && correctCount < 2) return 'needs_examples';
  return 'practicing';
}

function StatusDot({ status }: { status: SkillStatus }) {
  if (status === 'mastered') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" className="text-green/70 flex-shrink-0">
        <path d="M2 6.5L4.8 9L10 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === 'practicing' || status === 'needs_examples') {
    return <span className="inline-block w-1.5 h-1.5 rounded-full bg-green flex-shrink-0" />;
  }
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-cream-dark flex-shrink-0" />;
}

export default function Dashboard() {
  const router = useRouter();
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [nextUp, setNextUp] = useState<{ skill: string; topic: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/curriculum').then((r) => r.json()),
      fetch('/api/progress').then((r) => r.json()),
      fetch('/api/next-skill').then((r) => r.json()),
    ])
      .then(([c, p, n]) => {
        if (c.error) setError(c.error);
        else setCurriculum(c);
        setProgress(p);
        if (n && !n.done && n.skill) {
          setNextUp({ skill: n.skill, topic: n.topic });
          startFirstQuestionPrefetch(n.skill);
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <p className="text-charcoal-muted text-sm max-w-md text-center">{error}</p>
      </div>
    );
  }

  if (!curriculum) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex gap-1.5">
          <div className="w-1.5 h-1.5 bg-charcoal-muted thinking-dot" />
          <div className="w-1.5 h-1.5 bg-charcoal-muted thinking-dot" />
          <div className="w-1.5 h-1.5 bg-charcoal-muted thinking-dot" />
        </div>
      </div>
    );
  }

  const allSkills = curriculum.topics.flatMap((t) => t.skills);
  const mastered = allSkills.filter((s) => getSkillStatusClient(s, progress) === 'mastered').length;
  const total = allSkills.length;

  return (
    <div className="min-h-screen max-w-xl mx-auto px-6 pt-24 pb-16">
      {/* Hero */}
      <h1 className="text-[32px] sm:text-[38px] font-bold tracking-tight text-charcoal leading-[1.1]">
        {curriculum.test}
      </h1>

      {/* Next up + CTA */}
      <div className="mt-12">
        {nextUp && (
          <div className="mb-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-charcoal-muted font-medium mb-1.5">
              Next up
            </p>
            <p className="text-[15px] text-charcoal-secondary leading-snug">
              {nextUp.skill}
            </p>
          </div>
        )}
        <button
          onClick={() => router.push('/exercise')}
          className="mt-4 inline-flex items-center gap-2 px-7 py-3.5 bg-green text-white text-[15px] font-semibold hover:bg-green-hover active:scale-[0.98] transition-all shadow-sm hover:shadow"
        >
          {mastered === 0 ? 'Start' : 'Continue'}
          <span aria-hidden>→</span>
        </button>
      </div>

      {/* All skills (ambient) */}
      <div className="mt-20">
        <p className="text-[11px] uppercase tracking-[0.18em] text-charcoal-muted/70 font-medium mb-5">
          All skills
        </p>
        <div className="space-y-6">
          {curriculum.topics.map((topic) => {
            const N = topic.skills.length || 1;
            let t1c = 0, t2c = 0, t3c = 0;
            for (const s of topic.skills) {
              const c = (progress[s]?.attempts || []).filter((a) => a.correct).length;
              if (c >= 1) t1c++;
              if (c >= 2) t2c++;
              if (c >= 3) t3c++;
            }
            const tier1 = t1c / N;
            const tier2 = t2c / N;
            const tier3 = t3c / N;
            return (
              <div key={topic.topic}>
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-[12px] font-semibold text-charcoal-secondary/80">
                    {topic.topic}
                  </h2>
                  <span className="text-[11px] text-charcoal-muted/60 tabular-nums">
                    {t3c}/{topic.skills.length}
                  </span>
                </div>
                <div
                  className="relative w-full mb-3 rounded-full"
                  style={{
                    padding: `${tier3 * 4}px`,
                    background:
                      tier3 > 0
                        ? 'linear-gradient(90deg, #f9a8d4, #fbcfe8, #f472b6, #fbcfe8, #f9a8d4)'
                        : 'transparent',
                    boxShadow:
                      tier3 > 0
                        ? `0 0 ${6 + tier3 * 14}px rgba(244,114,182,${0.15 + tier3 * 0.3})`
                        : 'none',
                    transition: 'all 700ms cubic-bezier(0.22, 1, 0.36, 1)',
                  }}
                >
                  <div className="relative h-3 bg-cream-overlay rounded-full overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-green"
                      style={{
                        width: `${tier1 * 100}%`,
                        transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
                      }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${tier2 * 100}%`,
                        background: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                        transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
                      }}
                    />
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {topic.skills.map((skill) => {
                    const status = getSkillStatusClient(skill, progress);
                    return (
                      <li
                        key={skill}
                        className="flex items-center gap-2.5 text-[13px] leading-snug"
                      >
                        <StatusDot status={status} />
                        <span
                          className={
                            status === 'mastered'
                              ? 'text-charcoal-muted line-through decoration-cream-dark'
                              : 'text-charcoal-secondary/80'
                          }
                        >
                          {skill}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
