'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import TextareaAutosize from 'react-textarea-autosize';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import MotivationPopup from '@/components/MotivationPopup';
import PeelReveal from '@/components/PeelReveal';
import WebcamCapture from '@/components/WebcamCapture';
import { getSkillName } from '@/lib/algorithm';
import { ChatMessage, Curriculum, Progress } from '@/lib/types';
import { streamChat, takeFirstQuestionPrefetch, QuestionPrefetch, newSessionId, SessionExpiredError, endSession, endSessionOnUnload, abandonFirstQuestionPrefetch } from '@/lib/chatStream';
import { playCorrectChime } from '@/lib/audio';

function isCorrectMessage(text: string): boolean {
  return text.trimStart().startsWith('✅');
}

interface Tiers {
  tier1: number; // fraction of skills with ≥1 correct
  tier2: number; // ≥2 correct
  tier3: number; // ≥3 correct (mastered)
}

function tieredFractionsForTopic(
  curriculum: Curriculum,
  progress: Progress,
  topicName: string
): Tiers {
  const topic = curriculum.topics.find((t) => t.topic === topicName);
  if (!topic || topic.skills.length === 0) return { tier1: 0, tier2: 0, tier3: 0 };
  const N = topic.skills.length;
  let t1 = 0, t2 = 0, t3 = 0;
  for (const rawSkill of topic.skills) {
    const s = getSkillName(rawSkill);
    const c = (progress[s]?.attempts || []).filter((a) => a.correct).length;
    if (c >= 1) t1++;
    if (c >= 2) t2++;
    if (c >= 3) t3++;
  }
  return { tier1: t1 / N, tier2: t2 / N, tier3: t3 / N };
}

interface PeelState {
  correct: boolean;
  topicName: string;
  tiersBefore: Tiers;
  tiersAfter: Tiers;
  pf: PrefetchState | null;
}

let messageIdCounter = 0;
interface DisplayMessage extends ChatMessage {
  id: number;
  imageDataUrl?: string;
}

const PHOTO_MESSAGE_TEXT = '📷 (photo of my work)';

interface PrefetchState {
  nextSkill: string | null;
  nextTopic: string | null;
  nextSessionId: string | null;
  text: string;
  completed: boolean;
  failed: boolean;
  allDone: boolean;
  controller: AbortController;
  onEvent: ((s: PrefetchState) => void) | null;
}

function Dots() {
  return (
    <div className="flex gap-1.5 py-1">
      <div className="w-1.5 h-1.5 bg-charcoal-muted thinking-dot" />
      <div className="w-1.5 h-1.5 bg-charcoal-muted thinking-dot" />
      <div className="w-1.5 h-1.5 bg-charcoal-muted thinking-dot" />
    </div>
  );
}

function ProblemMarkdown({ children, dim = false }: { children: string; dim?: boolean }) {
  return (
    <div
      className={`prose-chat prose-problem text-[17px] leading-[1.7] ${
        dim ? 'text-charcoal-secondary/75' : 'text-charcoal'
      }`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

function TutorMarkdown({ children }: { children: string }) {
  return (
    <div className="prose-chat text-[16px] leading-[1.7] text-charcoal">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default function ExercisePage() {
  const router = useRouter();
  const [skill, setSkill] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const loadNextSkillRef = useRef<(() => void) | null>(null);
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [peel, setPeel] = useState<PeelState | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string>('');
  const [answer, setAnswer] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [allDone, setAllDone] = useState(false);
  const [leftPct, setLeftPct] = useState(42);
  const [focusMode, setFocusMode] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const draggingRef = useRef(false);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prefetchRef = useRef<PrefetchState | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  // Locally-tracked progress snapshot. Seeded from the server on mount, then
  // updated optimistically after each attempt — so tier computations don't
  // race with the background POST in startPrefetch.
  const progressRef = useRef<Progress>({});
  const progressLoadedRef = useRef(false);

  useEffect(() => {
    const handlePageHide = () => {
      const id = sessionIdRef.current;
      if (id) endSessionOnUnload(id);
      const nextId = prefetchRef.current?.nextSessionId;
      if (nextId) endSessionOnUnload(nextId);
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      abortRef.current?.abort();
      prefetchRef.current?.controller.abort();
      const id = sessionIdRef.current;
      if (id) endSession(id);
      const nextId = prefetchRef.current?.nextSessionId;
      if (nextId) endSession(nextId);
      abandonFirstQuestionPrefetch();
    };
  }, []);

  // Load curriculum once for topic→fraction computations
  useEffect(() => {
    fetch('/api/curriculum')
      .then((r) => r.json())
      .then((c) => { if (!c.error) setCurriculum(c); })
      .catch(() => {});
  }, []);

  // Seed the local progress snapshot from the server once on mount.
  useEffect(() => {
    fetch('/api/progress')
      .then((r) => r.json())
      .then((p: Progress) => {
        if (p && !(p as any).error) progressRef.current = p;
        progressLoadedRef.current = true;
      })
      .catch(() => {});
  }, []);

  // Ensure the pre-attempt progress snapshot is loaded. Falling back to a
  // fresh fetch here is safe: it runs before any attempt is POSTed, so it
  // always reflects pre-answer state.
  const ensureProgressLoaded = useCallback(async () => {
    if (progressLoadedRef.current) return;
    try {
      const res = await fetch('/api/progress');
      const p: Progress = await res.json();
      if (p && !(p as any).error) progressRef.current = p;
    } catch {}
    progressLoadedRef.current = true;
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const pct = (e.clientX / window.innerWidth) * 100;
      setLeftPct(Math.max(20, Math.min(65, pct)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const Divider = () => (
    <div
      onMouseDown={startDrag}
      className="flex-shrink-0 w-px bg-cream-border/40 hover:bg-cream-border relative cursor-col-resize group transition-colors"
    >
      <div className="absolute inset-y-0 -left-2 -right-2" />
    </div>
  );

  const submitted = messages.filter((m) => m.role === 'user').length > 0;

  useEffect(() => {
    if (submitted && !loading) chatInputRef.current?.focus();
  }, [submitted, loading, messages.length]);

  useEffect(() => {
    if (!submitted) return;
    const last = messages[messages.length - 1];
    if (last?.role === 'user') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, submitted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        if (submitted) {
          e.preventDefault();
          setFocusMode((v) => !v);
        }
      } else if (mod && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        if (skill && !loading && !allDone && !initializing) {
          e.preventDefault();
          setCameraOpen(true);
        }
      } else if (mod && (e.key === 'j' || e.key === 'J')) {
        if (submitted) {
          e.preventDefault();
          handleNext();
        }
      } else if (e.key === 'Escape' && focusMode && !cameraOpen) {
        setFocusMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted, focusMode, messages, skill, loading, allDone, initializing, cameraOpen]);

  const doChat = useCallback(async (
    currentSkill: string,
    message: string | null,
    image?: string
  ): Promise<string> => {
    setLoading(true);
    setStreamingText('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let chimed = false;
      if (!sessionIdRef.current) sessionIdRef.current = newSessionId();
      const fullText = await streamChat(
        currentSkill,
        message,
        sessionIdRef.current,
        (text) => {
          setStreamingText(text);
          if (!chimed && isCorrectMessage(text)) {
            chimed = true;
            playCorrectChime();
          }
        },
        controller.signal,
        image
      );
      if (fullText) {
        setMessages((prev) => [
          ...prev,
          { id: ++messageIdCounter, role: 'assistant', content: fullText },
        ]);
      }
      return fullText;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return '';
      if (error instanceof SessionExpiredError) {
        console.warn('Chat session expired, reloading skill');
        setMessages((prev) => [
          ...prev,
          { id: ++messageIdCounter, role: 'assistant', content: 'This session timed out. Starting a fresh problem…' },
        ]);
        sessionIdRef.current = null;
        setTimeout(() => loadNextSkillRef.current?.(), 800);
        return '';
      }
      console.error('Chat error:', error);
      setMessages((prev) => [
        ...prev,
        { id: ++messageIdCounter, role: 'assistant', content: 'Something went wrong. Try again.' },
      ]);
      return '';
    } finally {
      setStreamingText('');
      setLoading(false);
    }
  }, []);

  const consumeFirstPrefetch = useCallback((pf: QuestionPrefetch, topicName: string | null) => {
    setSkill(pf.skill);
    const oldId = sessionIdRef.current;
    if (oldId && oldId !== pf.sessionId) endSession(oldId);
    sessionIdRef.current = pf.sessionId;
    if (topicName) setTopic(topicName);
    setInitializing(false);
    const finish = (s: QuestionPrefetch) => {
      if (s.failed || !s.text) {
        setStreamingText('');
        doChat(s.skill, null).then(() => answerRef.current?.focus());
        return;
      }
      setStreamingText('');
      setMessages([{ id: ++messageIdCounter, role: 'assistant', content: s.text }]);
      setLoading(false);
      answerRef.current?.focus();
    };
    if (pf.completed) {
      finish(pf);
      return;
    }
    setLoading(true);
    setStreamingText(pf.text);
    pf.onEvent = (s) => {
      if (s.completed) finish(s);
      else setStreamingText(s.text);
    };
  }, [doChat]);

  const loadNextSkill = useCallback(async () => {
    setInitializing(true);
    setMessages([]);
    setAnswer('');
    setChatInput('');
    setStreamingText('');
    const oldId = sessionIdRef.current;
    if (oldId) endSession(oldId);
    sessionIdRef.current = null;
    try {
      const res = await fetch('/api/next-skill');
      const data = await res.json();
      if (data.done) {
        setAllDone(true);
        setInitializing(false);
        return;
      }
      const pf = takeFirstQuestionPrefetch(data.skill);
      if (pf) {
        consumeFirstPrefetch(pf, data.topic);
        return;
      }
      setSkill(data.skill);
      setTopic(data.topic);
      setInitializing(false);
      await doChat(data.skill, null);
      answerRef.current?.focus();
    } catch (error) {
      console.error('Failed to load skill:', error);
      setInitializing(false);
    }
  }, [doChat, consumeFirstPrefetch]);

  useEffect(() => {
    loadNextSkillRef.current = loadNextSkill;
  }, [loadNextSkill]);

  useEffect(() => {
    loadNextSkill();
  }, [loadNextSkill]);

  const problem = messages.find((m) => m.role === 'assistant')?.content || '';
  const firstUserMsg = messages.find((m) => m.role === 'user');
  const firstAnswer = firstUserMsg?.content || '';
  const firstAnswerImage = firstUserMsg?.imageDataUrl;
  const feedbackMessages = (() => {
    let sawUser = false;
    return messages.filter((m) => {
      if (!sawUser) {
        if (m.role === 'user') sawUser = true;
        return false;
      }
      return true;
    });
  })();

  const startPrefetch = useCallback(async (
    assessMessages: ChatMessage[],
    currentSkill: string,
    correct: boolean
  ) => {
    if (prefetchRef.current) return;
    const controller = new AbortController();
    const state: PrefetchState = {
      nextSkill: null,
      nextTopic: null,
      nextSessionId: null,
      text: '',
      completed: false,
      failed: false,
      allDone: false,
      controller,
      onEvent: null,
    };
    prefetchRef.current = state;
    const emit = () => state.onEvent?.(state);
    try {
      await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: currentSkill, correct, messages: assessMessages }),
        signal: controller.signal,
      });
      const nextRes = await fetch('/api/next-skill', { signal: controller.signal });
      const nextData = await nextRes.json();
      if (nextData.done) {
        state.allDone = true;
        state.completed = true;
        emit();
        return;
      }
      state.nextSkill = nextData.skill;
      state.nextTopic = nextData.topic ?? null;
      state.nextSessionId = newSessionId();
      emit();
      const full = await streamChat(
        nextData.skill,
        null,
        state.nextSessionId,
        (t) => { state.text = t; emit(); },
        controller.signal
      );
      state.text = full;
      state.completed = true;
      emit();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Prefetch error:', err);
      state.failed = true;
      state.completed = true;
      emit();
    }
  }, []);

  const submitAnswer = async (imageDataUrl?: string) => {
    if (!skill || loading) return;
    const text = imageDataUrl ? PHOTO_MESSAGE_TEXT : answer.trim();
    if (!text) return;
    // Snapshot pre-attempt progress before startPrefetch's POST can land.
    await ensureProgressLoaded();
    const currentSkill = skill;
    const userMessage: DisplayMessage = {
      id: ++messageIdCounter,
      role: 'user',
      content: text,
      imageDataUrl,
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    if (!imageDataUrl) setAnswer('');
    const tutorText = await doChat(currentSkill, text, imageDataUrl);
    if (tutorText) {
      const assessMessages: ChatMessage[] = [
        ...newMessages.map(({ role, content }) => ({ role, content })),
        { role: 'assistant', content: tutorText },
      ];
      const correct = isCorrectMessage(tutorText);
      startPrefetch(assessMessages, currentSkill, correct);
    }
  };

  const sendChat = async (imageDataUrl?: string) => {
    if (!skill || loading) return;
    const text = imageDataUrl ? PHOTO_MESSAGE_TEXT : chatInput.trim();
    if (!text) return;
    const userMessage: DisplayMessage = {
      id: ++messageIdCounter,
      role: 'user',
      content: text,
      imageDataUrl,
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    if (!imageDataUrl) setChatInput('');
    requestAnimationFrame(() => {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
    await doChat(skill, text, imageDataUrl);
  };

  const handleCameraCapture = useCallback(
    (dataUrl: string) => {
      setCameraOpen(false);
      if (submitted) {
        void sendChat(dataUrl);
      } else {
        void submitAnswer(dataUrl);
      }
    },
    // submitAnswer/sendChat are unstable closures over setters/refs; listing
    // their inputs instead so the handler always sees fresh state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [submitted, skill, loading, messages, answer, chatInput]
  );

  const consumePrefetch = useCallback((pf: PrefetchState | null) => {
    if (!pf) {
      loadNextSkill();
      return;
    }
    prefetchRef.current = null;
    abortRef.current?.abort();
    // We're transitioning off the current problem's session. Tear it down
    // so the server subprocess doesn't linger.
    const oldId = sessionIdRef.current;
    if (oldId && oldId !== pf.nextSessionId) endSession(oldId);
    setMessages([]);
    setAnswer('');
    setChatInput('');
    setStreamingText('');
    setInitializing(true);

    const apply = (s: PrefetchState) => {
      if (s.allDone) {
        setAllDone(true);
        setInitializing(false);
        setLoading(false);
        return;
      }
      if (s.failed && !s.nextSkill) {
        loadNextSkill();
        return;
      }
      if (!s.nextSkill) return;
      setSkill(s.nextSkill);
      sessionIdRef.current = s.nextSessionId;
      if (s.nextTopic) setTopic(s.nextTopic);
      setInitializing(false);
      if (s.completed) {
        if (s.failed || !s.text) {
          setStreamingText('');
          doChat(s.nextSkill, null).then(() => answerRef.current?.focus());
        } else {
          setStreamingText('');
          setMessages([{ id: ++messageIdCounter, role: 'assistant', content: s.text }]);
          setLoading(false);
          answerRef.current?.focus();
        }
      } else {
        setStreamingText(s.text);
        setLoading(true);
      }
    };
    pf.onEvent = apply;
    apply(pf);
  }, [loadNextSkill, doChat]);

  const deleteSkill = async () => {
    if (!skill || loading) return;
    if (!confirm(`Delete skill "${skill}"? This removes it from the curriculum permanently.`)) return;
    const toDelete = skill;
    abortRef.current?.abort();
    const orphanedNextId = prefetchRef.current?.nextSessionId;
    if (orphanedNextId) endSession(orphanedNextId);
    prefetchRef.current?.controller.abort();
    prefetchRef.current = null;
    try {
      await fetch(`/api/skill?name=${encodeURIComponent(toDelete)}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to delete skill:', err);
    }
    // Refresh curriculum in memory, then load next.
    try {
      const c = await fetch('/api/curriculum').then((r) => r.json());
      if (!c.error) setCurriculum(c);
    } catch {}
    loadNextSkill();
  };

  const handleNext = async () => {
    if (!skill || !topic || loading) return;

    // Derive correctness from last assistant message
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const correct = lastAssistant ? isCorrectMessage(lastAssistant.content) : false;

    let pf = prefetchRef.current;

    // If no prefetch (e.g. user clicked Next before a prefetch trigger), fire the
    // progress save + next-skill fetch now using the derived correctness.
    if (!pf) {
      const plainMsgs: ChatMessage[] = messages.map(({ role, content }) => ({ role, content }));
      startPrefetch(plainMsgs, skill, correct);
      pf = prefetchRef.current;
    }

    // Compute tiered fractions from the local progress snapshot and simulate
    // this attempt forward. Reading the server here would race with the
    // background POST in startPrefetch and often leave the bar static.
    let tiersBefore: Tiers = { tier1: 0, tier2: 0, tier3: 0 };
    let tiersAfter: Tiers = { tier1: 0, tier2: 0, tier3: 0 };
    if (curriculum) {
      const progress = progressRef.current;
      tiersBefore = tieredFractionsForTopic(curriculum, progress, topic);
      const topicDef = curriculum.topics.find((t) => t.topic === topic);
      if (topicDef) {
        const existingCorrect = (progress[skill]?.attempts || []).filter((a) => a.correct).length;
        const step = 1 / topicDef.skills.length;
        tiersAfter = { ...tiersBefore };
        if (correct) {
          const nowCorrect = existingCorrect + 1;
          if (nowCorrect === 1) tiersAfter.tier1 = Math.min(1, tiersBefore.tier1 + step);
          else if (nowCorrect === 2) tiersAfter.tier2 = Math.min(1, tiersBefore.tier2 + step);
          else if (nowCorrect === 3) tiersAfter.tier3 = Math.min(1, tiersBefore.tier3 + step);
        } else {
          // Wrong: visual-only teaser nudge on the tier that would have moved.
          const nudge = step * 0.33;
          if (existingCorrect === 0) tiersAfter.tier1 = Math.min(1, tiersBefore.tier1 + nudge);
          else if (existingCorrect === 1) tiersAfter.tier2 = Math.min(1, tiersBefore.tier2 + nudge);
          else if (existingCorrect === 2) tiersAfter.tier3 = Math.min(1, tiersBefore.tier3 + nudge);
        }
      } else {
        tiersAfter = tiersBefore;
      }

      // Optimistically record the attempt so subsequent tier computations stay
      // in sync with what startPrefetch will persist.
      if (!progress[skill]) progress[skill] = { attempts: [] };
      progress[skill].attempts.push({
        timestamp: new Date().toISOString(),
        correct,
      });
    }

    setPeel({ correct, topicName: topic, tiersBefore, tiersAfter, pf });
    // Swap the page underneath to the next problem immediately, so when the peel
    // animates away the new problem is already rendered beneath.
    consumePrefetch(pf);
  };

  const onPeelRevealed = useCallback(() => {
    setPeel(null);
  }, []);

  const HomeButton = () => (
    <button
      onClick={() => router.push('/')}
      className="fixed top-4 left-4 z-10 text-charcoal-muted hover:text-charcoal transition-colors text-[13px] px-2 py-1"
    >
      &larr; Home
    </button>
  );

  if (allDone) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-bold text-charcoal mb-4">All skills mastered</h1>
          <button
            onClick={() => router.push('/')}
            className="mt-2 text-charcoal-muted text-sm hover:text-charcoal transition-colors"
          >
            &larr; Home
          </button>
        </div>
      </div>
    );
  }

  // PHASE 1 — answer the problem
  if (!submitted) {
    const showProblem = problem || streamingText;
    const hasContent = answer.trim().length > 0;

    const onAnswerKey = (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submitAnswer();
      }
    };

    return (
      <div className="h-screen flex flex-col">
        <MotivationPopup />
        <HomeButton />
        <div className="flex-1 flex min-h-0">
          <div
            style={{ width: `${leftPct}%` }}
            className="overflow-y-auto px-10 pt-24 pb-10"
          >
            <div className="max-w-[460px] ml-auto">
              {initializing || (loading && !showProblem) ? (
                <Dots />
              ) : (
                <ProblemMarkdown>{showProblem}</ProblemMarkdown>
              )}
            </div>
          </div>
          <Divider />
          <div
            style={{ width: `${100 - leftPct}%` }}
            className="flex flex-col px-10 pt-24 pb-6 min-h-0"
          >
            <textarea
              ref={answerRef}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={onAnswerKey}
              placeholder="Start with part (a)…"
              autoFocus
              className="flex-1 w-full bg-transparent text-[16px] text-charcoal leading-[1.7] resize-none focus:outline-none placeholder:text-charcoal-muted/40 min-h-[65vh]"
            />
            <div className="flex items-center justify-end gap-4 pt-4">
              <button
                onClick={deleteSkill}
                disabled={loading || !skill}
                title="Delete this skill"
                aria-label="Delete this skill"
                className="mr-auto p-2 text-charcoal-muted/60 hover:text-red-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                  <path d="M10 11v6"></path>
                  <path d="M14 11v6"></path>
                  <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
              <button
                onClick={() => setCameraOpen(true)}
                disabled={loading || !skill}
                title="Submit a photo of your work (⌘⇧C)"
                aria-label="Submit a photo of your work"
                className="flex items-center gap-2 px-3 py-2 text-[13px] text-charcoal-muted hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span>📷</span>
                <span className="text-[11px] tabular-nums">⌘ + ⇧ + C</span>
              </button>
              <span
                className={`text-[11px] text-charcoal-muted/60 tabular-nums transition-opacity ${
                  hasContent ? 'opacity-100' : 'opacity-0'
                }`}
              >
                ⌘ + ↵
              </span>
              <button
                onClick={() => submitAnswer()}
                disabled={!hasContent}
                className={`px-6 py-2.5 text-[14px] font-semibold transition-all active:scale-[0.98] ${
                  hasContent
                    ? 'bg-green text-white hover:bg-green-hover shadow-sm hover:shadow'
                    : 'border border-cream-border text-charcoal-muted/50 cursor-not-allowed'
                }`}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
        {peel && (
          <PeelReveal
            correct={peel.correct}
            topicName={peel.topicName}
            tiersBefore={peel.tiersBefore}
            tiersAfter={peel.tiersAfter}
            onRevealed={onPeelRevealed}
          />
        )}
        <WebcamCapture
          open={cameraOpen}
          onCancel={() => setCameraOpen(false)}
          onCapture={handleCameraCapture}
        />
      </div>
    );
  }

  // PHASE 2 — feedback + chat
  return (
    <div className="h-screen flex flex-col">
      <MotivationPopup />
      <HomeButton />
      <div className="flex-1 flex min-h-0">
        {/* LEFT — archive (hidden in focus mode) */}
        {!focusMode && (
          <>
            <div
              style={{ width: `${leftPct}%` }}
              className="overflow-y-auto px-10 pt-24 pb-10"
            >
              <div className="max-w-[460px] ml-auto space-y-8">
                <ProblemMarkdown dim>{problem}</ProblemMarkdown>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-charcoal-muted/70 font-medium mb-3">
                    Your answer
                  </p>
                  <div className="border-l-2 border-green/40 pl-4">
                    {firstAnswerImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={firstAnswerImage}
                        alt="Photo of your work"
                        className="max-w-full max-h-[360px] border border-cream-border"
                      />
                    ) : (
                      <p className="text-[15px] text-charcoal-secondary leading-[1.7] whitespace-pre-wrap">
                        {firstAnswer}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <Divider />
          </>
        )}

        {/* RIGHT — tutor + chat */}
        <div
          style={{ width: focusMode ? '100%' : `${100 - leftPct}%` }}
          className="flex flex-col min-h-0 relative"
        >
          {/* Top bar — focus toggle + Next */}
          <div className="absolute top-4 right-6 z-10 flex items-center gap-3">
            <button
              onClick={() => setFocusMode((v) => !v)}
              className="flex items-center gap-2 text-[13px] text-charcoal-muted hover:text-charcoal transition-colors px-2 py-1"
            >
              <span>{focusMode ? '⤢ Exit focus' : '⤢ Focus'}</span>
              <span className="text-[11px] text-charcoal-muted/60 tabular-nums">⌘ + ⇧ + F</span>
            </button>
            <button
              onClick={handleNext}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold bg-green text-white hover:bg-green-hover transition-all active:scale-[0.98] shadow-sm hover:shadow disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>Next →</span>
              <span className="text-[11px] text-white/70 tabular-nums">⌘ + J</span>
            </button>
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-10 pt-24 pb-6">
            <div className="max-w-2xl mx-auto space-y-7">
              {feedbackMessages.map((msg) =>
                msg.role === 'assistant' ? (
                  <div key={msg.id} className="animate-fade-up">
                    <TutorMarkdown>{msg.content}</TutorMarkdown>
                  </div>
                ) : (
                  <div key={msg.id} className="animate-fade-up flex justify-end">
                    {msg.imageDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={msg.imageDataUrl}
                        alt="Photo of your work"
                        className="max-w-[80%] max-h-[320px] border border-cream-border rounded-sm"
                      />
                    ) : (
                      <p className="max-w-[80%] text-[15px] text-charcoal-secondary leading-[1.65] whitespace-pre-wrap bg-cream-raised/70 px-4 py-2.5 rounded-sm">
                        {msg.content}
                      </p>
                    )}
                  </div>
                )
              )}
              {streamingText && (
                <div className="animate-fade-up">
                  <TutorMarkdown>{streamingText}</TutorMarkdown>
                </div>
              )}
              {loading && !streamingText && <Dots />}
              <div ref={chatBottomRef} />
            </div>
          </div>

          <div className="flex-shrink-0 px-10 pb-6">
            <div className="max-w-2xl mx-auto">
              <div className="border-t border-cream-border/60 pt-4">
                <TextareaAutosize
                  ref={chatInputRef}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      sendChat();
                    }
                  }}
                  minRows={3}
                  maxRows={8}
                  placeholder="Ask a question or think out loud…"
                  className="w-full bg-transparent text-[15px] text-charcoal placeholder:text-charcoal-muted/45 resize-none focus:outline-none disabled:opacity-40 leading-relaxed"
                />
                <div className="flex items-center justify-end gap-4 pt-2">
                  <button
                    onClick={() => setCameraOpen(true)}
                    disabled={loading || !skill}
                    title="Submit a photo of your work (⌘⇧C)"
                    aria-label="Submit a photo of your work"
                    className="flex items-center gap-1.5 text-[11px] text-charcoal-muted/70 hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <span>📷</span>
                    <span className="tabular-nums">⌘ + ⇧ + C</span>
                  </button>
                  <span
                    className={`text-[11px] text-charcoal-muted/60 tabular-nums transition-opacity ${
                      chatInput.trim() ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    ⌘ + ↵
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {peel && (
        <PeelReveal
          correct={peel.correct}
          topicName={peel.topicName}
          tiersBefore={peel.tiersBefore}
          tiersAfter={peel.tiersAfter}
          onRevealed={onPeelRevealed}
        />
      )}
      <WebcamCapture
        open={cameraOpen}
        onCancel={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
      />
    </div>
  );
}
