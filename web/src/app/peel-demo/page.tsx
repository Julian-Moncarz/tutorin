'use client';

import { useEffect, useState } from 'react';
import PeelReveal from '@/components/PeelReveal';

// Prototype-only demo route to preview the celebration without retiring a skill.
// Hit /peel-demo, optionally with ?before=72&after=78 to override the numbers.
// Click "Replay" after the peel finishes to run it again.
export default function PeelDemoPage() {
  const [key, setKey] = useState(0);
  const [done, setDone] = useState(false);
  const [params, setParams] = useState({ before: 72, after: 78 });

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const b = Number(sp.get('before'));
    const a = Number(sp.get('after'));
    if (Number.isFinite(b) && b > 0 && Number.isFinite(a) && a > 0) {
      setParams({ before: b, after: a });
    }
  }, []);

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold mb-2">Peel celebration preview</h1>
        <p className="text-charcoal-muted mb-6">
          Showing {params.before}% → {params.after}%. Override via
          <code className="mx-1 bg-cream-dark px-1 rounded">?before=72&amp;after=78</code>.
        </p>
        <button
          onClick={() => {
            setDone(false);
            setKey((k) => k + 1);
          }}
          className="px-5 py-2.5 rounded-full bg-charcoal text-cream font-semibold"
        >
          {done ? 'Replay' : 'Play celebration'}
        </button>
        <p className="text-xs text-charcoal-muted mt-4">
          Once it plays, swipe the page left (or hit Enter) to dismiss.
        </p>
      </div>
      {!done && key > 0 && (
        <PeelReveal
          key={key}
          scoreBefore={params.before}
          scoreAfter={params.after}
          onRevealed={() => setDone(true)}
        />
      )}
    </div>
  );
}
