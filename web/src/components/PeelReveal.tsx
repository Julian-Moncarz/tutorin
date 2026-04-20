'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { playPeel, playBarRise, playSkillRetired } from '@/lib/audio';

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
  correct: boolean;
  topicName: string;
  tierBefore: number; // fraction of topic's skills retired, pre-attempt (0..1)
  tierAfter: number;  // fraction retired, post-attempt (0..1)
  onRevealed: () => void;
}

export default function PeelReveal({ correct, topicName, tierBefore, tierAfter, onRevealed }: Props) {
  const [line] = useState(() => LINES[Math.floor(Math.random() * LINES.length)]);

  const [tier, setTier] = useState<number>(tierBefore);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const pointerStartX = useRef(0);
  const pointerId = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Did this attempt retire a fresh skill in this topic?
  const retired: boolean = correct && tierBefore < tierAfter;

  useEffect(() => {
    // 180ms: bar starts filling + bar-rise sweep plays (~0.9s on correct).
    const t1 = setTimeout(() => {
      setTier(tierAfter);
      playBarRise(correct);
    }, 180);

    // ~1250ms: bar fill + bar-rise finished. NOW celebrate.
    let t2: ReturnType<typeof setTimeout> | null = null;
    if (retired) {
      t2 = setTimeout(() => {
        setCelebrate(true);
        playSkillRetired();
      }, 1250);
    }

    return () => {
      clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
  }, [tierAfter, correct, retired]);

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
    if (dragX < -90) {
      commit();
    } else {
      setDragX(0);
    }
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
        onClick={() => {
          if (committed) return;
          if (Math.abs(dragX) < 4) commit();
        }}
      >
        <div className="h-full w-full flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-md flex flex-col items-center">
            <p className="text-[10px] uppercase tracking-[0.18em] text-charcoal-muted mb-4">
              {topicName}
            </p>

            <div className="relative w-full mb-10 rounded-full">
              <div
                className={`relative h-5 bg-cream-dark/50 rounded-full overflow-hidden ${
                  celebrate ? 'celebrate-pop' : ''
                }`}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-green"
                  style={{
                    width: `${tier * 100}%`,
                    transition: 'width 1000ms cubic-bezier(0.22, 1, 0.36, 1)',
                  }}
                />
                {celebrate && <div className="celebrate-sheen t1" />}
              </div>
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
      </div>
    </div>
  );
}
