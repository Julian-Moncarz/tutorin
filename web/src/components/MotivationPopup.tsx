'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const INTERVAL_MS = 50 * 60 * 1000;

const feelings = [
  { label: 'Focused', value: 'focused', emoji: '\uD83C\uDFAF' },
  { label: 'Tired', value: 'tired', emoji: '\uD83D\uDE34' },
  { label: 'Frustrated', value: 'frustrated', emoji: '\uD83D\uDE24' },
  { label: 'Bored', value: 'bored', emoji: '\uD83D\uDE10' },
];

export default function MotivationPopup() {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedulePopup = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShow(true), INTERVAL_MS);
  }, []);

  useEffect(() => {
    schedulePopup();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [schedulePopup]);

  const handleSelect = useCallback(
    async (value: string) => {
      setShow(false);
      schedulePopup();
      try {
        await fetch('/api/motivation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feeling: value }),
        });
      } catch {}
    },
    [schedulePopup]
  );

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 backdrop-blur-sm">
      <div className="bg-cream border border-cream-border p-6 shadow-xl max-w-sm w-full mx-4">
        <p className="text-charcoal-secondary text-center mb-5 text-sm">
          Quick check. If you have been pushing for a while, this is a good time for a 10 minute break.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {feelings.map((f) => (
            <button
              key={f.value}
              onClick={() => handleSelect(f.value)}
              className="flex items-center gap-2.5 px-4 py-3 bg-cream-raised border border-cream-border hover:border-charcoal-muted/30 transition-colors text-sm text-charcoal-secondary"
            >
              <span className="text-base">{f.emoji}</span>
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
