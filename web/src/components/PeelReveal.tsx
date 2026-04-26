'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { playPeel, playSkillRetiredHuge, playDigitTick, playLandingHit } from '@/lib/audio';

const LINES = [
  "A small parade has formed in your honor. The mayor is weeping. You're that good.",
  "Somewhere in the Swiss Alps, a bell was rung because you are, frankly, magnificent.",
  "We dispatched a falcon named Gerald to tell the world about you. He is screeching your name.",
  "The ancestors have convened. Unanimous verdict: you are their favorite descendant.",
  "Our panel — three otters and a retired physicist — rose to their feet and applauded YOU.",
  "You have been carved into a small oak plaque. We are mailing the plaque to you. To YOU.",
  "The moon winked at you. The moon. Has never winked at anyone else. Just you.",
  "A golden retriever named Murphy has been told about you and is now unmanageable with joy.",
  "Your neurons are high-fiving each other with tiny neuron hands, and the subject is you.",
  "We've etched your name onto a grain of rice and placed it in a velvet box labeled LEGEND.",
  "A statistician somewhere is weeping softly. The tears are about you. You did this.",
  "The Tutorin Council of Elders voted you Most Impressive Human. It wasn't close.",
  "A detective named Cheryl has been assigned to figure out how you got so smart.",
  "Your hippocampus is absolutely jacked right now. Other hippocampi are intimidated.",
  "A lighthouse on the coast of Maine flickered twice to salute you, specifically.",
  "We consulted the I Ching about you. It said, and I quote, \"oh yes, that one's great.\"",
  "Seventeen monks in Kyoto paused mid-tea and whispered your name with reverence.",
  "You have been entered into the Great Ledger under the heading \"People Who Are Crushing It.\"",
  "A small brass band just played a triumphant fanfare directly at your face. You've earned it.",
  "Your name has been pinned to our walnut corkboard of excellence. It's the best corkboard.",
  "An owl hooted. Owls only hoot for people like you. Which is nobody, usually. Except you.",
  "Our intern was so moved by your work she asked for your autograph. We said soon, maybe.",
  "A committee of ducks waddled in, quacked your name in unison, and waddled out. Surreal.",
  "We've dispatched a carrier pigeon with a letter that just says YOU ARE CRUSHING THIS.",
  "You have been inducted into the Tutorin Archives. The archives are in Reno. You belong there.",
  "A faint smell of lavender filled HQ the moment you showed up. Coincidence? Unlikely.",
  "A jazz trio across town just struck a chord of pure admiration. The admiration is for you.",
  "Harold, our tortoise quality inspector, gave you a solemn, slow, unmistakable thumbs up.",
  "A passing accountant saw your work and wept single, dignified tear. For you. Wow.",
  "Your neurons held a ribbon-cutting ceremony celebrating YOU. There was cake. You weren't invited because it was a surprise.",
  "The Council of Thoughtful Birds tilted their heads at your brilliance. This is their highest honor.",
  "A cactus bloomed the instant you started this problem. Deserts are reacting to you now.",
  "We rang the bell at the old Tutorin lighthouse to celebrate you. People came running. We told them your name.",
  "A passing stranger just gave the air a thumbs up. They sensed you. You radiated.",
  "The ghost of a math professor from 1894 nodded at you and said \"that one's got it.\"",
  "Your name has been inscribed on a diner napkin and taped to the wall next to the jukebox. Permanent.",
  "A small dog named Pretzel was told about you and has been barking supportively ever since.",
  "Our librarian looked up from her novel, saw your work, and said \"oh my.\" She never says that.",
  "The weather in Reykjavík is perfect today and we are choosing to credit you personally.",
  "We sent a paper balloon up with your name on it. Children pointed. Adults nodded. You are the balloon now.",
  "Good job. Claude is proud of you ❤️",
];

interface Props {
  scoreBefore: number; // exam-score percentage, pre-retire (0..100)
  scoreAfter: number;  // exam-score percentage, post-retire (0..100)
  onRevealed: () => void;
}

const PRE_ROLL_HOLD_MS = 500;            // hold on the original value before the slot roll starts
const PER_DIGIT_LANDING_DELAY = 1140;    // each digit lands this much after the previous one
const TICK_INTERVAL_MS = 70;             // how often we cycle digits during the roll
const FIREWORKS_DELAY = 80;              // after final digit lands, when fireworks burst
const BADGE_SLAM_DELAY = 180;            // after final digit lands, when the +points slams in

type FireworkBurst = {
  id: number;
  cx: number; // % of viewport
  cy: number; // % of viewport
  color: string;
  count: number;
  startMs: number;
};

const FIREWORK_COLORS = ['#ff5e5e', '#ffce42', '#42c47a', '#5b9eff', '#d56bff', '#ff9450'];

export default function PeelReveal({ scoreBefore, scoreAfter, onRevealed }: Props) {
  const [line] = useState(() => LINES[Math.floor(Math.random() * LINES.length)]);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const beforeStr = String(Math.round(scoreBefore));
  const afterStr = String(Math.round(scoreAfter));
  const width = Math.max(beforeStr.length, afterStr.length);
  const fromStr = beforeStr.padStart(width, ' ');
  const toStr = afterStr.padStart(width, ' ');

  const [rollingDigits, setRollingDigits] = useState<string[]>(() => fromStr.split(''));
  const [landed, setLanded] = useState<boolean[]>(() => fromStr.split('').map(() => false));
  const [rollStarted, setRollStarted] = useState(false);
  const [allLanded, setAllLanded] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const [bursts, setBursts] = useState<FireworkBurst[]>([]);

  const pointerStartX = useRef(0);
  const pointerId = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const delta = scoreAfter - scoreBefore;
  const deltaLabel = (Math.round(delta * 10) / 10).toFixed(1);

  const landingTimes = useMemo(() => {
    return fromStr.split('').map((_, i) => PRE_ROLL_HOLD_MS + (i + 1) * PER_DIGIT_LANDING_DELAY);
  }, [fromStr]);

  const fireFireworks = useCallback(() => {
    const now = performance.now();
    const positions = [
      { cx: 22, cy: 28 },
      { cx: 78, cy: 32 },
      { cx: 50, cy: 16 },
      { cx: 30, cy: 72 },
      { cx: 72, cy: 70 },
      { cx: 50, cy: 48 },
    ];
    let id = now;
    const newBursts: FireworkBurst[] = positions.map((p, i) => ({
      id: id++,
      cx: p.cx + (Math.random() - 0.5) * 10,
      cy: p.cy + (Math.random() - 0.5) * 10,
      color: FIREWORK_COLORS[i % FIREWORK_COLORS.length],
      count: 22,
      startMs: i * 130,
    }));
    setBursts(newBursts);
    setTimeout(() => setBursts([]), 2600);
  }, []);

  useEffect(() => {
    // Hold silently on the original value for a beat. Fanfare fires the moment
    // the slot roll starts, so the audio and the visual move together.
    const fanfareTimer = setTimeout(() => playSkillRetiredHuge(), PRE_ROLL_HOLD_MS);

    const start = performance.now();
    let raf = 0;
    let lastTick = 0;
    let finalized = false;

    const targets = toStr.split('');
    const sources = fromStr.split('');
    const landedLocal = sources.map(() => false);

    const tick = (now: number) => {
      const elapsed = now - start;

      for (let i = 0; i < targets.length; i++) {
        if (!landedLocal[i] && elapsed >= landingTimes[i]) {
          landedLocal[i] = true;
          const ix = i;
          setLanded((prev) => prev.map((v, j) => (j === ix ? true : v)));
          setRollingDigits((prev) => prev.map((v, j) => (j === ix ? targets[ix] : v)));
          if (targets[ix] !== ' ') playDigitTick(ix);
        }
      }

      // Pre-roll hold: show the original value until the hold elapses.
      if (elapsed < PRE_ROLL_HOLD_MS) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (!rollStarted) setRollStarted(true);

      if (now - lastTick >= TICK_INTERVAL_MS) {
        lastTick = now;
        setRollingDigits((prev) =>
          prev.map((cur, i) => {
            if (landedLocal[i]) return targets[i];
            if (sources[i] === ' ' && targets[i] === ' ') return ' ';
            return String(Math.floor(Math.random() * 10));
          })
        );
      }

      const everyoneLanded = landedLocal.every(Boolean);
      if (!everyoneLanded) {
        raf = requestAnimationFrame(tick);
      } else if (!finalized) {
        finalized = true;
        setAllLanded(true);
        playLandingHit();
        setTimeout(() => fireFireworks(), FIREWORKS_DELAY);
        setTimeout(() => setShowBadge(true), BADGE_SLAM_DELAY);
      }
    };
    raf = requestAnimationFrame(tick);

    const t1 = setTimeout(() => setCelebrate(true), 200);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(fanfareTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = useCallback(() => {
    setCommitted((prev) => {
      if (prev) return prev;
      playPeel();
      setTimeout(onRevealed, 520);
      return true;
    });
  }, [onRevealed]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (committed) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        commit();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [commit, committed]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (committed) return;
    pointerStartX.current = e.clientX;
    pointerId.current = e.pointerId;
    setDragging(true);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || committed) return;
    const dx = Math.min(0, e.clientX - pointerStartX.current);
    setDragX(dx);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    pointerId.current = null;
    if (dragX < -90) commit();
    else setDragX(0);
  };

  const rotate = dragX * 0.02;
  const cardStyle: React.CSSProperties = committed
    ? {
        transform: 'translateX(-110vw) rotate(-4deg)',
        transition: 'transform 520ms cubic-bezier(0.5, 0.1, 0.25, 1)',
      }
    : {
        transform: `translateX(${dragX}px) rotate(${rotate}deg)`,
        transition: dragging ? 'none' : 'transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      };

  const dragProgress = Math.min(1, -dragX / 90);
  const cornerLift = 18 + dragProgress * 40;

  return (
    <div className="fixed inset-0 z-50">
      <div
        ref={cardRef}
        className="absolute inset-0 bg-cream cursor-grab active:cursor-grabbing select-none"
        style={{
          ...cardStyle,
          boxShadow: '-20px 0 60px rgba(0,0,0,0.12), -4px 0 12px rgba(0,0,0,0.06)',
          willChange: 'transform',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="h-full w-full flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-md flex flex-col items-center">
            <p className="text-[10px] uppercase tracking-[0.18em] text-charcoal-muted mb-4">
              Projected exam score
            </p>

            <div className={`mb-2 flex items-baseline ${celebrate ? 'celebrate-pop' : ''} ${allLanded ? 'score-land-pop' : ''}`}>
              <span className="text-[88px] font-bold tabular-nums text-charcoal leading-none flex">
                {rollingDigits.map((d, i) => (
                  <span
                    key={i}
                    className={`slot-digit ${landed[i] ? 'slot-digit-landed' : rollStarted ? 'slot-digit-rolling' : ''}`}
                    style={{
                      minWidth: d === ' ' ? '0' : '0.62em',
                      display: 'inline-block',
                      textAlign: 'center',
                    }}
                  >
                    {d === ' ' ? '' : d}
                  </span>
                ))}
              </span>
              <span className="text-[36px] font-semibold text-charcoal-muted">%</span>
            </div>

            <div className="h-12 mb-10 flex items-center justify-center">
              {delta > 0 && showBadge && (
                <div className="badge-slam flex items-baseline gap-1.5 text-green">
                  <svg width="14" height="16" viewBox="0 0 14 16" className="-mb-0.5" aria-hidden>
                    <path d="M7 2L7 14M7 2L2 7M7 2L12 7" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-[22px] font-bold tabular-nums tracking-tight">
                    +{deltaLabel}
                  </span>
                  <span className="text-[14px] uppercase tracking-[0.16em] font-semibold opacity-80 ml-1">
                    percent
                  </span>
                </div>
              )}
            </div>

            <p className="text-center text-[17px] text-charcoal leading-relaxed max-w-sm">
              {line}
            </p>
          </div>

          <div className="absolute right-8 top-0 bottom-0 flex flex-row items-center gap-2 pointer-events-none">
            <div className="h-10 w-1 bg-charcoal-muted/30 rounded-full" />
            <div
              className="text-[11px] uppercase tracking-[0.18em] text-charcoal-muted/70"
              style={{
                opacity: 1 - dragProgress * 0.8,
                writingMode: 'vertical-rl',
              }}
            >
              swipe left to continue
            </div>
          </div>
        </div>

        <div
          className="absolute bottom-0 right-0 pointer-events-none"
          style={{
            width: `${cornerLift * 2}px`,
            height: `${cornerLift * 2}px`,
            background:
              'linear-gradient(135deg, rgba(0,0,0,0) 49.5%, rgba(0,0,0,0.04) 50%, #ede7dd 50.5%)',
            clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
            transition: dragging ? 'none' : 'width 320ms ease-out, height 320ms ease-out',
            filter: 'drop-shadow(-2px -2px 6px rgba(0,0,0,0.08))',
          }}
        />

        {/* Fireworks layer */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {bursts.map((b) => (
            <FireworkBurstView key={b.id} burst={b} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FireworkBurstView({ burst }: { burst: FireworkBurst }) {
  const particles = useMemo(() => {
    const out: { i: number; px: number; py: number; size: number; life: number }[] = [];
    for (let i = 0; i < burst.count; i++) {
      const angle = (i / burst.count) * Math.PI * 2 + Math.random() * 0.25;
      const dist = 130 + Math.random() * 110;
      out.push({
        i,
        px: Math.cos(angle) * dist,
        py: Math.sin(angle) * dist,
        size: 6 + Math.random() * 6,
        life: 1100 + Math.random() * 600,
      });
    }
    return out;
  }, [burst.count]);

  return (
    <div
      className="absolute"
      style={{
        left: `${burst.cx}%`,
        top: `${burst.cy}%`,
      }}
    >
      <span
        className="firework-flash"
        style={{
          background: burst.color,
          color: burst.color,
          animationDelay: `${burst.startMs}ms`,
        }}
      />
      {particles.map((p) => (
        <span
          key={p.i}
          className="firework-particle"
          style={
            {
              ['--px' as string]: `${p.px}px`,
              ['--py' as string]: `${p.py}px`,
              ['--life' as string]: `${p.life}ms`,
              ['--delay' as string]: `${burst.startMs}ms`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: burst.color,
              color: burst.color,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
