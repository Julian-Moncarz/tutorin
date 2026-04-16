'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import TextareaAutosize from 'react-textarea-autosize';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { ChatMessage } from '@/lib/types';
import { streamFeedback } from '@/lib/feedbackStream';

let msgIdCounter = 0;
interface DisplayMessage extends ChatMessage {
  id: number;
}

function newSessionId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${rand}`;
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

function stripSentinels(text: string): string {
  return text.replace(/<<<\s*draft:[\w.-]+\s*>>>/g, '').trim();
}

const REPO = 'Julian-Moncarz/tutorin';
const REPO_ROOT = '/Users/julianmoncarz/tutorin';

function buildPrPrompt(issueNumber: number): string {
  return `You're helping implement user feedback for Tutorin.

Read issue #${issueNumber} on ${REPO}:

  gh issue view ${issueNumber} --repo ${REPO} --comments

The latest comment describes what the user actually wants fixed. Implement the minimum change that delivers that outcome.

Constraints:
- Work from ${REPO_ROOT}
- Run \`npx tsc --noEmit\` from web/ before committing
- Branch name: fix/issue-${issueNumber}
- Open the PR with:
    gh pr create --repo ${REPO} --base main --title "<short imperative title>" --body "Closes #${issueNumber}"
- Keep the diff minimal; no refactors.`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function FeedbackMarkdown({ children }: { children: string }) {
  return (
    <div className="prose-chat text-[15px] leading-[1.65] text-charcoal">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {stripSentinels(children)}
      </ReactMarkdown>
    </div>
  );
}

/**
 * 56px cream circle with centered green chat-spark icon, plus a bold green
 * caption "tinker / improve this app!" to the right. Bounces on dashboard
 * mount (parent toggles `bouncing`). Lives top-most (z-[100]).
 */
function FeedbackPill({ onClick, bouncing }: { onClick: () => void; bouncing?: boolean }) {
  return (
    <div
      className={`fixed bottom-6 left-6 z-[100] flex items-center gap-3 ${
        bouncing ? 'animate-feedback-bounce' : ''
      }`}
    >
      <button
        onClick={onClick}
        aria-label="Tinker / improve this app"
        title="Tinker / improve this app (⌘/ · ⌘⇧/ fullscreen)"
        className="relative w-14 h-14 rounded-full bg-cream border border-cream-border hover:-translate-y-0.5 active:translate-y-0 transition-transform"
        style={{
          boxShadow:
            '0 6px 18px rgba(0,0,0,0.14), 0 2px 4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.6)',
        }}
      >
        <svg viewBox="0 0 56 56" width="56" height="56" className="block">
          <g transform="translate(28,28)" className="text-green">
            <path
              d="M -11 -6 Q -11 -12 -5 -12 L 5 -12 Q 11 -12 11 -6 L 11 2 Q 11 8 5 8 L -2 8 L -7 12 L -6 8 Q -11 7 -11 2 Z"
              fill="currentColor"
            />
          </g>
        </svg>
        <span
          aria-hidden
          className="absolute -top-1.5 -right-1.5 text-[9px] font-semibold tracking-wider text-charcoal-muted bg-cream border border-cream-border rounded px-1 py-[1px] pointer-events-none select-none"
          style={{
            boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          ⌘/
        </span>
      </button>
      <button
        onClick={onClick}
        className="text-[12px] font-bold text-green tracking-tight whitespace-nowrap hover:text-green-hover transition-colors"
      >
        tinker / improve this app!
      </button>
    </div>
  );
}

export default function FeedbackButton() {
  const pathname = usePathname();
  const [bouncing, setBouncing] = useState(false);
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string>(() => newSessionId());

  useEffect(() => {
    if (pathname !== '/') return;
    setBouncing(false);
    const raf = requestAnimationFrame(() => setBouncing(true));
    const t = setTimeout(() => setBouncing(false), 950);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [pathname]);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [issueState, setIssueState] = useState<string>('');
  // Draft state: which file Claude just wrote, and the loaded title/body for editing.
  const [draft, setDraft] = useState<{
    file: 'issue.md' | 'comment.md';
    title: string;
    body: string;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [filing, setFiling] = useState(false);
  const [filedIssue, setFiledIssue] = useState<{ number: number; url: string } | null>(null);
  const [filedNotice, setFiledNotice] = useState<
    { kind: 'issue' | 'comment'; number: number; url: string } | null
  >(null);
  const [prPrompt, setPrPrompt] = useState<string | null>(null);
  const [prCopied, setPrCopied] = useState(false);
  // Panel position (offset from bottom-right corner). Dragged via header.
  const [pos, setPos] = useState<{ left: number; bottom: number }>({ left: 24, bottom: 96 });
  const [fullscreen, setFullscreen] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startBottom: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const greetedRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ⌘/ toggles panel · ⌘⇧/ toggles fullscreen (opens if closed) · Esc exits fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Shift+/ on US layout produces "?", so accept either key + rely on e.code as a fallback.
      const isSlash = e.key === '/' || e.key === '?' || e.code === 'Slash';
      if ((e.metaKey || e.ctrlKey) && isSlash) {
        e.preventDefault();
        if (e.shiftKey) {
          setOpen((o) => {
            if (!o) {
              setFullscreen(true);
              return true;
            }
            setFullscreen((f) => !f);
            return true;
          });
        } else {
          setOpen((v) => !v);
        }
        return;
      }
      if (e.key === 'Escape' && fullscreen) {
        e.preventDefault();
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // Reset fullscreen when the panel closes — don't persist across sessions.
  useEffect(() => {
    if (!open) setFullscreen(false);
  }, [open]);

  const loadDraft = useCallback(
    async (file: 'issue.md' | 'comment.md') => {
      setDraft({ file, title: '', body: '', loading: true, error: null });
      try {
        const res = await fetch(
          `/api/feedback/draft?sessionId=${encodeURIComponent(sessionId)}&file=${file}`
        );
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: 'load failed' }));
          setDraft({ file, title: '', body: '', loading: false, error });
          return;
        }
        const { title, body } = await res.json();
        setDraft({ file, title, body, loading: false, error: null });
      } catch (err) {
        setDraft({ file, title: '', body: '', loading: false, error: String(err) });
      }
    },
    [sessionId]
  );

  const runChat = useCallback(
    async (msgs: DisplayMessage[], issueStateOverride?: string) => {
      setLoading(true);
      setStreamingText('');
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const plain: ChatMessage[] = msgs.map(({ role, content }) => ({ role, content }));
        const full = await streamFeedback(
          sessionId,
          plain,
          issueStateOverride ?? issueState,
          (t) => setStreamingText(t),
          controller.signal
        );
        if (full) {
          setMessages((prev) => [
            ...prev,
            { id: ++msgIdCounter, role: 'assistant', content: full },
          ]);
          // Sentinel detection — open the right draft window.
          if (/<<<\s*draft:issue\.md\s*>>>/.test(full)) {
            loadDraft('issue.md');
          } else if (/<<<\s*draft:comment\.md\s*>>>/.test(full)) {
            loadDraft('comment.md');
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('Feedback chat error:', err);
      } finally {
        setLoading(false);
        setStreamingText('');
      }
    },
    [sessionId, issueState, loadDraft]
  );

  // Greet on first open of a session
  useEffect(() => {
    if (!open) return;
    if (greetedRef.current) return;
    if (messages.length > 0) return;
    greetedRef.current = true;
    runChat([]);
  }, [open, messages.length, runChat]);

  // Scroll to bottom on new messages / streaming
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingText, open]);

  useEffect(() => {
    if (open && !loading) inputRef.current?.focus();
  }, [open, loading]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg: DisplayMessage = {
      id: ++msgIdCounter,
      role: 'user',
      content: input.trim(),
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    await runChat(next);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const fileIssue = async () => {
    if (!draft || draft.file !== 'issue.md') return;
    if (!draft.title.trim() || !draft.body.trim()) return;
    setFiling(true);
    try {
      const res = await fetch('/api/feedback/submit-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, body: draft.body }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setDraft((d) => (d ? { ...d, error: data.error || 'Failed to file issue' } : d));
        return;
      }
      // Update state Claude sees on next turn.
      setIssueState(`Issue #${data.number} filed at ${data.url}`);
      // Inject a note into the chat transcript.
      setMessages((prev) => [
        ...prev,
        {
          id: ++msgIdCounter,
          role: 'assistant',
          content: `**Filed →** [#${data.number}](${data.url})`,
        },
      ]);
      setDraft(null);
      setFiledIssue({ number: data.number, url: data.url });
      setFiledNotice({ kind: 'issue', number: data.number, url: data.url });
      setTimeout(() => setFiledNotice(null), 8000);
      // Auto-kick Claude so it pivots to "what would the fix look like?"
      // immediately, without waiting for the user to type.
      const pivotMessages: DisplayMessage[] = [
        ...messages,
        {
          id: ++msgIdCounter,
          role: 'assistant',
          content: `**Filed →** [#${data.number}](${data.url})`,
        },
      ];
      const freshIssueState = `Issue #${data.number} filed at ${data.url}`;
      setTimeout(() => runChat(pivotMessages, freshIssueState), 400);
    } catch (err) {
      setDraft((d) => (d ? { ...d, error: String(err) } : d));
    } finally {
      setFiling(false);
    }
  };

  const postComment = async () => {
    if (!draft || draft.file !== 'comment.md' || !filedIssue) return;
    if (!draft.body.trim()) return;
    setFiling(true);
    try {
      const res = await fetch('/api/feedback/submit-comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueNumber: filedIssue.number, body: draft.body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDraft((d) => (d ? { ...d, error: data.error || 'Failed to post comment' } : d));
        return;
      }
      const promptText = buildPrPrompt(filedIssue.number);
      setPrPrompt(promptText);
      const copied = await copyToClipboard(promptText);
      setPrCopied(copied);
      const clipboardNote = copied
        ? '📋 **Copied a prompt to your clipboard.**'
        : '⚠️ Couldn\'t access your clipboard — copy the prompt below.';
      const intro =
        `**Comment delivered →** [#${filedIssue.number}](${filedIssue.url})\n\n` +
        `${clipboardNote} Paste it into Claude Code in \`${REPO_ROOT}\` — it will modify the app to match your feedback and open a PR for you.\n\n` +
        '```\n' + promptText + '\n```';
      setMessages((prev) => [
        ...prev,
        { id: ++msgIdCounter, role: 'assistant', content: intro },
      ]);
      setDraft(null);
      setFiledNotice({ kind: 'comment', number: filedIssue.number, url: filedIssue.url });
      setTimeout(() => setFiledNotice(null), 8000);
    } catch (err) {
      setDraft((d) => (d ? { ...d, error: String(err) } : d));
    } finally {
      setFiling(false);
    }
  };

  const newChat = () => {
    abortRef.current?.abort();
    greetedRef.current = false;
    setMessages([]);
    setStreamingText('');
    setDraft(null);
    setIssueState('');
    setFiledIssue(null);
    setFiledNotice(null);
    setPrPrompt(null);
    setPrCopied(false);
    setInput('');
    setLoading(false);
    setSessionId(newSessionId());
  };

  // Drag handlers — pointer-based, captures on the header. Position stored
  // as offset from bottom-right so resizing the window behaves sanely.
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore drags that start on the action buttons
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: pos.left,
      startBottom: pos.bottom,
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const nextLeft = Math.max(8, dragRef.current.startLeft + dx);
    const nextBottom = Math.max(8, dragRef.current.startBottom - dy);
    setPos({ left: nextLeft, bottom: nextBottom });
  };
  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    }
  };

  if (!open) return <FeedbackPill onClick={() => setOpen(true)} bouncing={bouncing} />;

  return (
    <>
      <FeedbackPill onClick={() => setOpen(false)} bouncing={bouncing} />
      <div
        className={
          fullscreen
            ? 'fixed z-[101] inset-0 bg-cream flex flex-col overflow-hidden'
            : 'fixed z-[101] w-[420px] max-w-[calc(100vw-3rem)] bg-cream border border-cream-border rounded-lg flex flex-col overflow-hidden'
        }
        onWheel={(e) => {
          // Block page-scroll while the cursor is over the panel. Allow the
          // wheel event only inside the transcript (its own scroll container).
          const inTranscript = (e.target as HTMLElement).closest(
            '[data-feedback-scroll]'
          );
          if (!inTranscript) e.preventDefault();
        }}
        style={
          fullscreen
            ? undefined
            : {
                left: `${pos.left}px`,
                bottom: `${pos.bottom}px`,
                height: 'min(620px, calc(100vh - 7rem))',
                boxShadow:
                  '0 20px 50px rgba(0,0,0,0.18), 0 6px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.02)',
              }
        }
      >
        {/* Header — drag handle (drag disabled in fullscreen) */}
        <div
          onPointerDown={fullscreen ? undefined : onHeaderPointerDown}
          onPointerMove={fullscreen ? undefined : onHeaderPointerMove}
          onPointerUp={fullscreen ? undefined : onHeaderPointerUp}
          onPointerCancel={fullscreen ? undefined : onHeaderPointerUp}
          className={`flex items-center justify-between px-4 py-2.5 border-b border-cream-border bg-cream-raised select-none touch-none ${
            fullscreen ? '' : 'cursor-grab active:cursor-grabbing'
          }`}>
          <span className="text-[11px] uppercase tracking-[0.18em] text-charcoal-muted font-medium">
            Feedback
          </span>
          <div className="flex items-center gap-1">
            {prPrompt && (
              <button
                onClick={async () => {
                  const ok = await copyToClipboard(prPrompt);
                  setPrCopied(ok);
                  if (ok) setTimeout(() => setPrCopied(false), 1600);
                }}
                className="text-[11px] text-green-hover hover:text-green px-2 py-1 transition-colors"
                title="Copy the PR prompt to your clipboard"
              >
                {prCopied ? '✓ Copied' : 'Copy PR prompt'}
              </button>
            )}
            <button
              onClick={newChat}
              className="text-[11px] text-charcoal-muted hover:text-charcoal px-2 py-1 transition-colors"
              title="Start a new feedback session"
            >
              New chat
            </button>
            <button
              onClick={() => setFullscreen((v) => !v)}
              className="text-charcoal-muted hover:text-charcoal w-7 h-7 flex items-center justify-center transition-colors"
              title={fullscreen ? 'Restore (⌘⇧/ · Esc)' : 'Fullscreen (⌘⇧/)'}
              aria-label={fullscreen ? 'Restore' : 'Fullscreen'}
            >
              {fullscreen ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M5 1 L5 5 L1 5 M9 5 L13 5 L13 1 M13 9 L9 9 L9 13 M5 13 L5 9 L1 9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M5 1 L1 1 L1 5 M9 1 L13 1 L13 5 M13 9 L13 13 L9 13 M5 13 L1 13 L1 9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-charcoal-muted hover:text-charcoal w-7 h-7 flex items-center justify-center transition-colors"
              title="Minimize"
              aria-label="Minimize"
            >
              <svg width="14" height="14" viewBox="0 0 14 14">
                <path
                  d="M3 3 L11 11 M11 3 L3 11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Success toast — shown briefly after filing */}
        {filedNotice && (
          <a
            href={filedNotice.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block animate-fade-up px-4 py-2.5 bg-green-light border-b border-green/30 text-[13px] text-green-hover hover:bg-green-faint transition-colors"
          >
            <span className="font-semibold">
              {filedNotice.kind === 'issue' ? '✓ Filed' : '✓ Delivered'}
            </span>{' '}
            <span className="text-charcoal-secondary">
              #{filedNotice.number} — click to view on GitHub
            </span>
          </a>
        )}

        {/* Transcript */}
        <div
          ref={scrollRef}
          data-feedback-scroll
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-4"
        >
          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === 'user'
                  ? 'bg-cream-raised px-3.5 py-2.5 rounded-lg ml-6 animate-fade-up'
                  : 'animate-fade-up'
              }
            >
              {m.role === 'user' ? (
                <p className="text-[15px] text-charcoal whitespace-pre-wrap leading-[1.55]">
                  {m.content}
                </p>
              ) : (
                <FeedbackMarkdown>{m.content}</FeedbackMarkdown>
              )}
            </div>
          ))}
          {streamingText && (
            <div className="animate-fade-up">
              <FeedbackMarkdown>{streamingText}</FeedbackMarkdown>
            </div>
          )}
          {loading && !streamingText && <Dots />}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-cream-border px-3 py-2.5 bg-cream-raised/60">
          <TextareaAutosize
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="A bug, a wish, a weird feeling — anything."
            minRows={1}
            maxRows={6}
            className="w-full bg-transparent text-[15px] text-charcoal leading-[1.55] resize-none focus:outline-none placeholder:text-charcoal-muted/50 py-1.5"
          />
          <p className="text-[10px] text-charcoal-muted/60 mt-1.5 px-1">
            ↵ to send &middot; shift+↵ for newline
          </p>
        </div>
      </div>

      {/* Draft floating window (issue / comment) */}
      {draft && (
        <DraftWindow
          draft={draft}
          filing={filing}
          onTitleChange={(title) => setDraft((d) => (d ? { ...d, title } : d))}
          onBodyChange={(body) => setDraft((d) => (d ? { ...d, body } : d))}
          onClose={() => setDraft(null)}
          onSubmit={draft.file === 'issue.md' ? fileIssue : postComment}
        />
      )}
    </>
  );
}

interface DraftState {
  file: 'issue.md' | 'comment.md';
  title: string;
  body: string;
  loading: boolean;
  error: string | null;
}

function DraftWindow({
  draft,
  filing,
  onTitleChange,
  onBodyChange,
  onClose,
  onSubmit,
}: {
  draft: DraftState;
  filing: boolean;
  onTitleChange: (t: string) => void;
  onBodyChange: (b: string) => void;
  onClose: () => void;
  onSubmit?: () => void;
}) {
  const isIssue = draft.file === 'issue.md';
  const label = isIssue ? 'Issue draft' : 'Comment draft';
  const action = isIssue ? 'File it' : 'Deliver feedback';

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 pointer-events-none">
      {/* Soft dim — clicks are swallowed so the user can't accidentally dismiss */}
      <div className="absolute inset-0 bg-charcoal/10 backdrop-blur-[1px] pointer-events-auto" />
      <div
        className="relative pointer-events-auto w-full max-w-2xl bg-cream border border-cream-border rounded-lg flex flex-col overflow-hidden"
        style={{
          maxHeight: 'calc(100vh - 3rem)',
          boxShadow:
            '0 30px 80px rgba(0,0,0,0.25), 0 10px 24px rgba(0,0,0,0.1)',
        }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-cream-border bg-cream-raised">
          <span className="text-[11px] uppercase tracking-[0.18em] text-charcoal-muted font-medium">
            {label}
          </span>
          <button
            onClick={onClose}
            className="text-charcoal-muted hover:text-charcoal w-7 h-7 flex items-center justify-center transition-colors"
            title="Close"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14">
              <path
                d="M3 3 L11 11 M11 3 L3 11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {draft.loading ? (
            <div className="py-8 flex justify-center">
              <Dots />
            </div>
          ) : draft.error ? (
            <p className="text-[14px] text-danger">{draft.error}</p>
          ) : (
            <>
              {isIssue && (
                <div>
                  <label className="text-[10px] uppercase tracking-[0.18em] text-charcoal-muted font-medium block mb-1.5">
                    Title
                  </label>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => onTitleChange(e.target.value)}
                    className="w-full bg-cream-raised/50 border border-cream-border rounded px-3 py-2 text-[15px] text-charcoal focus:outline-none focus:border-charcoal-muted/60 transition-colors"
                    autoFocus
                  />
                </div>
              )}
              <div>
                <label className="text-[10px] uppercase tracking-[0.18em] text-charcoal-muted font-medium block mb-1.5">
                  Body
                </label>
                <textarea
                  value={draft.body}
                  onChange={(e) => onBodyChange(e.target.value)}
                  rows={isIssue ? 16 : 10}
                  className="w-full bg-cream-raised/50 border border-cream-border rounded px-3 py-2 text-[14px] text-charcoal leading-[1.55] font-mono resize-y focus:outline-none focus:border-charcoal-muted/60 transition-colors"
                />
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-cream-border bg-cream-raised/60 flex justify-end gap-2">
          {onSubmit && (
            <button
              onClick={onSubmit}
              disabled={
                filing ||
                draft.loading ||
                !draft.body.trim() ||
                (isIssue && !draft.title.trim())
              }
              className="px-4 py-1.5 bg-green text-white text-[13px] font-semibold rounded hover:bg-green-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {filing ? 'Filing…' : action}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
