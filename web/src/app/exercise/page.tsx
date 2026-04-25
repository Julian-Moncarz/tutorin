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
import { getExamReadiness } from '@/lib/algorithm';
import { ChatMessage, Curriculum, ExamReadinessSummary, Progress } from '@/lib/types';
import {
  streamChat,
  takeFirstQuestionPrefetch,
  QuestionPrefetch,
  newSessionId,
  SessionExpiredError,
  endSession,
  endSessionOnUnload,
  abandonFirstQuestionPrefetch,
} from '@/lib/chatStream';

function isCorrectMessage(text: string): boolean {
  return text.includes('✅');
}

let messageIdCounter = 0;
interface DisplayMessage extends ChatMessage {
  id: number;
  imageDataUrl?: string;
  // Locked once the message finishes streaming so a stable copy of the text
  // is what gets scanned for ✅. Streaming chunks aren't trustworthy yet.
  done?: boolean;
}

const PHOTO_MESSAGE_TEXT = '📷 (photo of my work)';

interface PrefetchState {
  nextSkill: string | null;
  nextSessionId: string | null;
  text: string;
  completed: boolean;
  failed: boolean;
  allDone: boolean;
  controller: AbortController;
  onEvent: ((s: PrefetchState) => void) | null;
}

interface PeelState {
  scoreBefore: number;
  scoreAfter: number;
  pf: PrefetchState | null;
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
  const sessionIdRef = useRef<string | null>(null);
  const loadNextSkillRef = useRef<(() => void) | null>(null);
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [peel, setPeel] = useState<PeelState | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string>('');
  const [chatInput, setChatInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [allDone, setAllDone] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadingNextRef = useRef(false);
  const prefetchRef = useRef<PrefetchState | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  // First ✅ in any tutor message wins. Once latched, we ignore later ✅
  // tokens and don't double-fire the celebration.
  const retiredLatchedRef = useRef(false);
  // Cached server progress + readiness, snapshotted before the ✅ POST so
  // peel can show a real score-before / score-after.
  const progressRef = useRef<Progress>({});
  const readinessRef = useRef<ExamReadinessSummary | null>(null);

  useEffect(() => {
    const handlePageHide = (e: PageTransitionEvent) => {
      if (e.persisted) return;
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

  useEffect(() => {
    fetch('/api/curriculum')
      .then((r) => r.json())
      .then((c) => { if (!c.error) setCurriculum(c); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/progress')
      .then((r) => r.json())
      .then((p: Progress) => {
        if (p && !(p as { error?: string }).error) progressRef.current = p;
      })
      .catch(() => {});
    fetch('/api/readiness')
      .then((r) => r.json())
      .then((rd: ExamReadinessSummary) => {
        if (rd && !(rd as unknown as { error?: string }).error) readinessRef.current = rd;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading) chatInputRef.current?.focus();
  }, [loading, messages.length]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === 'user' || streamingText) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, streamingText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        if (skill && !loading && !allDone && !initializing) {
          e.preventDefault();
          setCameraOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skill, loading, allDone, initializing, cameraOpen]);

  // Compute the post-retire score client-side by simulating the new attempt
  // against the cached progress snapshot + curriculum. Avoids racing the
  // background progress POST and a server readiness refetch.
  const simulateScoreAfter = useCallback((retireSkill: string): number => {
    if (!curriculum) return 0;
    const sim: Progress = JSON.parse(JSON.stringify(progressRef.current || {}));
    if (!sim[retireSkill]) sim[retireSkill] = { attempts: [] };
    sim[retireSkill].attempts.push({
      timestamp: new Date().toISOString(),
      correct: true,
    });
    const r = getExamReadiness(curriculum, sim);
    progressRef.current = sim;
    return (r.estimatedScoreLow + r.estimatedScoreHigh) / 2;
  }, [curriculum]);

  const startPrefetch = useCallback(async (
    finishedMessages: ChatMessage[],
    currentSkill: string
  ) => {
    if (prefetchRef.current) return;
    const controller = new AbortController();
    const state: PrefetchState = {
      nextSkill: null,
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
        body: JSON.stringify({ skill: currentSkill, correct: true, messages: finishedMessages }),
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

  // Called once a tutor message finishes streaming. If it contains the first
  // ✅ of the session, fire the retire flow.
  const handleTutorMessageDone = useCallback(async (
    fullText: string,
    convoSnapshot: ChatMessage[],
    currentSkill: string
  ) => {
    if (retiredLatchedRef.current) return;
    if (!isCorrectMessage(fullText)) return;
    retiredLatchedRef.current = true;

    let scoreBefore = 0;
    if (curriculum) {
      const r = getExamReadiness(curriculum, progressRef.current || {});
      scoreBefore = (r.estimatedScoreLow + r.estimatedScoreHigh) / 2;
    } else if (readinessRef.current) {
      scoreBefore = (readinessRef.current.estimatedScoreLow + readinessRef.current.estimatedScoreHigh) / 2;
    }

    const scoreAfter = simulateScoreAfter(currentSkill);
    startPrefetch(convoSnapshot, currentSkill);

    setPeel({ scoreBefore, scoreAfter, pf: prefetchRef.current });
  }, [startPrefetch, simulateScoreAfter, curriculum]);

  const doChat = useCallback(async (
    currentSkill: string,
    message: string | null,
    convoBeforeReply: ChatMessage[],
    image?: string
  ): Promise<string> => {
    setLoading(true);
    setStreamingText('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (message === null) {
        const stale = sessionIdRef.current;
        if (stale) endSession(stale);
        sessionIdRef.current = newSessionId();
      } else if (!sessionIdRef.current) {
        sessionIdRef.current = newSessionId();
      }
      const fullText = await streamChat(
        currentSkill,
        message,
        sessionIdRef.current,
        (text) => setStreamingText(text),
        controller.signal,
        image
      );
      if (fullText) {
        setMessages((prev) => [
          ...prev,
          { id: ++messageIdCounter, role: 'assistant', content: fullText, done: true },
        ]);
        const fullConvo: ChatMessage[] = [
          ...convoBeforeReply,
          { role: 'assistant', content: fullText },
        ];
        await handleTutorMessageDone(fullText, fullConvo, currentSkill);
      }
      return fullText;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return '';
      if (error instanceof SessionExpiredError) {
        console.warn('Chat session expired, reloading skill');
        setMessages((prev) => [
          ...prev,
          { id: ++messageIdCounter, role: 'assistant', content: 'This session timed out. Starting fresh…', done: true },
        ]);
        sessionIdRef.current = null;
        setTimeout(() => loadNextSkillRef.current?.(), 800);
        return '';
      }
      console.error('Chat error:', error);
      setMessages((prev) => [
        ...prev,
        { id: ++messageIdCounter, role: 'assistant', content: 'Something went wrong. Try again.', done: true },
      ]);
      return '';
    } finally {
      setStreamingText('');
      setLoading(false);
    }
  }, [handleTutorMessageDone]);

  const consumeFirstPrefetch = useCallback((pf: QuestionPrefetch) => {
    setSkill(pf.skill);
    const oldId = sessionIdRef.current;
    if (oldId && oldId !== pf.sessionId) endSession(oldId);
    sessionIdRef.current = pf.sessionId;
    setInitializing(false);
    const finish = (s: QuestionPrefetch) => {
      if (s.failed || !s.text) {
        setStreamingText('');
        doChat(s.skill, null, []);
        return;
      }
      setStreamingText('');
      const msg: DisplayMessage = { id: ++messageIdCounter, role: 'assistant', content: s.text, done: true };
      setMessages([msg]);
      setLoading(false);
      // The opener teaches; it shouldn't contain ✅, but scan defensively.
      void handleTutorMessageDone(
        s.text,
        [{ role: 'assistant', content: s.text }],
        s.skill
      );
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
  }, [doChat, handleTutorMessageDone]);

  const loadNextSkill = useCallback(async () => {
    if (loadingNextRef.current) return;
    loadingNextRef.current = true;
    setInitializing(true);
    setMessages([]);
    setChatInput('');
    setStreamingText('');
    retiredLatchedRef.current = false;
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
        consumeFirstPrefetch(pf);
        return;
      }
      setSkill(data.skill);
      setInitializing(false);
      await doChat(data.skill, null, []);
    } catch (error) {
      console.error('Failed to load skill:', error);
      setInitializing(false);
    } finally {
      loadingNextRef.current = false;
    }
  }, [doChat, consumeFirstPrefetch]);

  useEffect(() => {
    loadNextSkillRef.current = loadNextSkill;
  }, [loadNextSkill]);

  useEffect(() => {
    loadNextSkill();
  }, [loadNextSkill]);

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
    const convoBeforeReply: ChatMessage[] = newMessages.map(({ role, content }) => ({ role, content }));
    await doChat(skill, text, convoBeforeReply, imageDataUrl);
  };

  const handleCameraCapture = useCallback(
    (dataUrl: string) => {
      setCameraOpen(false);
      void sendChat(dataUrl);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skill, loading, messages, chatInput]
  );

  const consumePrefetch = useCallback((pf: PrefetchState | null) => {
    if (!pf) {
      loadNextSkill();
      return;
    }
    prefetchRef.current = null;
    abortRef.current?.abort();
    const oldId = sessionIdRef.current;
    if (oldId && oldId !== pf.nextSessionId) endSession(oldId);
    setMessages([]);
    setChatInput('');
    setStreamingText('');
    setInitializing(true);
    retiredLatchedRef.current = false;

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
      setInitializing(false);
      if (s.completed) {
        if (s.failed || !s.text) {
          setStreamingText('');
          doChat(s.nextSkill, null, []);
        } else {
          setStreamingText('');
          const msg: DisplayMessage = { id: ++messageIdCounter, role: 'assistant', content: s.text, done: true };
          setMessages([msg]);
          setLoading(false);
          void handleTutorMessageDone(
            s.text,
            [{ role: 'assistant', content: s.text }],
            s.nextSkill!
          );
        }
      } else {
        setStreamingText(s.text);
        setLoading(true);
      }
    };
    pf.onEvent = apply;
    apply(pf);
  }, [loadNextSkill, doChat, handleTutorMessageDone]);

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
    try {
      const c = await fetch('/api/curriculum').then((r) => r.json());
      if (!c.error) setCurriculum(c);
    } catch {}
    loadNextSkill();
  };

  const onPeelRevealed = useCallback(() => {
    const pf = peel?.pf ?? null;
    setPeel(null);
    consumePrefetch(pf);
  }, [peel, consumePrefetch]);

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
          <h1 className="text-2xl font-bold text-charcoal mb-4">All skills retired</h1>
          <p className="text-charcoal-muted text-sm mb-6">You're done. Go take the test.</p>
          <button
            onClick={() => router.push('/')}
            className="text-charcoal-muted text-sm hover:text-charcoal transition-colors"
          >
            &larr; Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <MotivationPopup />
      <HomeButton />

      <div className="absolute top-4 right-6 z-10 flex items-center gap-3">
        <button
          onClick={deleteSkill}
          disabled={loading || !skill}
          title="Delete this skill"
          aria-label="Delete this skill"
          className="p-2 text-charcoal-muted/60 hover:text-red-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>

      <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-10 pt-24 pb-6">
        <div className="max-w-2xl mx-auto space-y-7">
          {initializing && messages.length === 0 && !streamingText && <Dots />}
          {messages.map((msg) =>
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
          {loading && !streamingText && messages.length > 0 && <Dots />}
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
                  void sendChat();
                }
              }}
              minRows={3}
              maxRows={8}
              placeholder="Reply, ask a question, or think out loud…"
              className="w-full bg-transparent text-[15px] text-charcoal placeholder:text-charcoal-muted/45 resize-none focus:outline-none disabled:opacity-40 leading-relaxed"
              disabled={loading || !skill}
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

      {peel && (
        <PeelReveal
          scoreBefore={peel.scoreBefore}
          scoreAfter={peel.scoreAfter}
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
