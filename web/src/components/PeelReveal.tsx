'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { playPeel } from '@/lib/audio';

const LINES = [
  "A small parade has formed in your honor. The mayor is weeping.",
  "Somewhere in the Swiss Alps, a bell was rung. Possibly for you.",
  "We've dispatched a falcon named Gerald with news of your attempt. He will arrive Tuesday.",
  "The ancestors have convened. Opinions were shared. Snacks were served.",
  "Our panel — three otters and a retired physicist — rose from their seats.",
  "This answer has been carved into a small oak plaque. We'll mail it shortly.",
  "The moon winked at you just now. Look up. No — too late. You missed it.",
  "A golden retriever named Murphy has been informed. He is thrilled either way.",
  "Your neurons are high-fiving each other with tiny neuron hands. It's very cute.",
  "We've etched your answer onto a grain of rice and placed it in a velvet box.",
  "Somewhere, a statistician weeps softly into a clean handkerchief. We don't know why.",
  "The Tutorin Council of Elders has convened. They brought their best pens.",
  "A detective named Cheryl has been assigned to your case. She is on it.",
  "Your hippocampus just got a little bit more swole. Keep going.",
  "A lighthouse on the coast of Maine flickered twice the moment you submitted.",
  "We consulted the I Ching. It said, and I quote, \"yeah, sure, okay.\"",
  "Seventeen monks in Kyoto paused mid-tea and nodded, as if sensing something.",
  "Your answer has been logged in the Great Ledger. The Great Ledger weighs 80 lbs.",
  "A small brass band just played a single, triumphant note in your general direction.",
  "We pinned your answer to a corkboard. The corkboard is made of walnut. Classy.",
  "An owl has hooted. Owls hoot rarely. Interpret as you will.",
  "The intern who judges your work was replaced by a more enthusiastic intern.",
  "A committee of ducks waddled into the boardroom. They quacked their approval.",
  "We've dispatched a carrier pigeon. It will get there when it gets there.",
  "Your work has been entered into the archives. The archives are in a basement in Reno.",
  "A faint smell of lavender filled Tutorin headquarters. We take this as a good sign.",
  "Somewhere, a jazz trio struck a surprise chord. No one knows why. You, maybe.",
  "Our quality inspector, a tortoise named Harold, has signed off. Slowly.",
  "A single tear of joy rolled down the cheek of a passing accountant.",
  "Your neurons held a small ribbon-cutting ceremony. There was cake.",
  "The Council of Thoughtful Birds tilted their heads in unison. This is rare.",
  "A nearby cactus bloomed. The desert rejoices.",
  "We've rung the bell at the top of the old Tutorin lighthouse. It still works.",
  "A passing stranger gave a thumbs up. They have no idea what they're endorsing.",
  "The ghost of a math professor from 1894 nodded from across the room.",
  "Your answer has been inscribed on a napkin and pinned to the wall of a diner.",
  "A small dog named Pretzel has been notified. He is barking supportively.",
  "Our librarian looked up from her novel and said \"hm, interesting.\"",
  "The weather in Reykjavík is, coincidentally, perfect today. Draw your own conclusions.",
  "We've sent your answer up in a little paper balloon. Godspeed, paper balloon.",
];

interface Props {
  correct: boolean;
  topicName: string;
  fractionBefore: number; // 0..1 mastered fraction in topic before this attempt
  fractionAfter: number;  // 0..1 after
  onRevealed: () => void;
}

export default function PeelReveal({ correct, topicName, fractionBefore, fractionAfter, onRevealed }: Props) {
  const [line] = useState(() => LINES[Math.floor(Math.random() * LINES.length)]);

  // On wrong, nudge the bar by a small fraction of the remaining gap to mastery
  const targetFraction = correct
    ? fractionAfter
    : Math.min(1, fractionBefore + Math.max(0.015, (1 - fractionBefore) * 0.04));

  const [barWidth, setBarWidth] = useState(fractionBefore);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [committed, setCommitted] = useState(false);
  const pointerStartY = useRef(0);
  const pointerId = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setBarWidth(targetFraction), 180);
    return () => clearTimeout(t);
  }, [targetFraction]);

  const commit = useCallback(() => {
    setCommitted((prev) => {
      if (prev) return prev;
      playPeel(correct);
      setTimeout(onRevealed, 520);
      return true;
    });
  }, [correct, onRevealed]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (committed) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault();
        commit();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [commit, committed]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (committed) return;
    pointerStartY.current = e.clientY;
    pointerId.current = e.pointerId;
    setDragging(true);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || committed) return;
    const dy = Math.min(0, e.clientY - pointerStartY.current);
    setDragY(dy);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    pointerId.current = null;
    if (dragY < -90) {
      commit();
    } else {
      setDragY(0);
    }
  };

  const rotate = dragY * 0.02;
  const cardStyle: React.CSSProperties = committed
    ? {
        transform: 'translateY(-110vh) rotate(-4deg)',
        transition: 'transform 520ms cubic-bezier(0.5, 0.1, 0.25, 1)',
      }
    : {
        transform: `translateY(${dragY}px) rotate(${rotate}deg)`,
        transition: dragging ? 'none' : 'transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      };

  const dragProgress = Math.min(1, -dragY / 90);
  const cornerLift = 18 + dragProgress * 40;

  return (
    <div className="fixed inset-0 z-50">
      <div
        ref={cardRef}
        className="absolute inset-0 bg-cream cursor-grab active:cursor-grabbing select-none"
        style={{
          ...cardStyle,
          boxShadow: '0 -20px 60px rgba(0,0,0,0.12), 0 -4px 12px rgba(0,0,0,0.06)',
          willChange: 'transform',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => {
          if (committed) return;
          if (Math.abs(dragY) < 4) commit();
        }}
      >
        <div className="h-full w-full flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-md flex flex-col items-center">
            <p className="text-[10px] uppercase tracking-[0.18em] text-charcoal-muted mb-4">
              {topicName}
            </p>

            <div className="w-full h-1.5 bg-cream-dark/50 rounded-full overflow-hidden mb-10">
              <div
                className="h-full bg-green rounded-full"
                style={{
                  width: `${barWidth * 100}%`,
                  transition: 'width 1000ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              />
            </div>

            <p className="text-center text-[17px] text-charcoal leading-relaxed max-w-sm">
              {line}
            </p>
          </div>

          <div className="absolute bottom-12 left-0 right-0 flex flex-col items-center pointer-events-none">
            <div
              className="text-[11px] uppercase tracking-[0.18em] text-charcoal-muted/70 mb-2"
              style={{ opacity: 1 - dragProgress * 0.8 }}
            >
              pull up to continue
            </div>
            <div className="w-10 h-1 bg-charcoal-muted/30 rounded-full" />
          </div>
        </div>

        {/* Bottom-right curled corner affordance */}
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
      </div>
    </div>
  );
}
