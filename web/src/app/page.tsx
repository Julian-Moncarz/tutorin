'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSkillName, getSkillStatus } from '@/lib/algorithm';
import { Curriculum, ExamReadinessSummary, NextSkillRecommendation, Progress, SkillStatus } from '@/lib/types';
import { startFirstQuestionPrefetch } from '@/lib/chatStream';

function StatusDot({ status }: { status: SkillStatus }) {
  if (status === 'mastered') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" className="text-green/70 flex-shrink-0">
        <path d="M2 6.5L4.8 9L10 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === 'practicing') {
    return <span className="inline-block w-1.5 h-1.5 rounded-full bg-green flex-shrink-0" />;
  }
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-cream-dark flex-shrink-0" />;
}

export default function Dashboard() {
  const router = useRouter();
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [nextUp, setNextUp] = useState<NextSkillRecommendation | null>(null);
  const [readiness, setReadiness] = useState<ExamReadinessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/curriculum').then((r) => r.json()),
      fetch('/api/progress').then((r) => r.json()),
      fetch('/api/next-skill').then((r) => r.json()),
      fetch('/api/readiness').then((r) => r.json()),
    ])
      .then(([c, p, n, readinessData]) => {
        if (c.error) setError(c.error);
        else setCurriculum(c);
        setProgress(p);
        if (n && !n.done && n.skill) {
          setNextUp(n);
          startFirstQuestionPrefetch(n.skill);
        }
        if (!readinessData?.error) setReadiness(readinessData);
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

  const allSkills = curriculum.topics.flatMap((t) => t.skills.map(getSkillName));

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
          Start
          <span aria-hidden>→</span>
        </button>
      </div>

      {readiness && (
        <div className="mt-14 border border-cream-border bg-cream-raised/40 p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-charcoal-muted font-medium">
            Projected exam score
          </p>
          <p className="mt-2 text-[26px] leading-none font-semibold text-charcoal">
            {readiness.estimatedScoreLow}–{readiness.estimatedScoreHigh}%
          </p>
          <p className="mt-2 text-[12px] text-charcoal-muted">
            Already know: {readiness.alreadyKnownPct}%
          </p>
          {readiness.biggestGains.length > 0 && (
            <p className="mt-2 text-[13px] text-charcoal-secondary leading-relaxed">
              Biggest score gains left:
              {' '}
              {readiness.biggestGains.map((gain) => gain.skill).join(' • ')}
            </p>
          )}
        </div>
      )}

      {/* All skills (ambient) */}
      <div className="mt-20">
        <p className="text-[11px] uppercase tracking-[0.18em] text-charcoal-muted/70 font-medium mb-5">
          All skills
        </p>
        <div className="space-y-6">
          {curriculum.topics.map((topic) => {
            const N = topic.skills.length || 1;
            let retiredCount = 0;
            for (const rawSkill of topic.skills) {
              const s = getSkillName(rawSkill);
              if (getSkillStatus(s, progress, curriculum) === 'mastered') retiredCount++;
            }
            const retired = retiredCount / N;
            return (
              <div key={topic.topic}>
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-[12px] font-semibold text-charcoal-secondary/80">
                    {topic.topic}
                  </h2>
                  <span className="text-[11px] text-charcoal-muted/60 tabular-nums">
                    {retiredCount}/{topic.skills.length}
                  </span>
                </div>
                <div className="relative w-full mb-3 rounded-full">
                  <div className="relative h-3 bg-cream-overlay rounded-full overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-green"
                      style={{
                        width: `${retired * 100}%`,
                        transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
                      }}
                    />
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {topic.skills.map((rawSkill) => {
                    const skill = getSkillName(rawSkill);
                    const status = getSkillStatus(skill, progress, curriculum);
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
