'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCapture: (dataUrl: string) => void;
}

export default function WebcamCapture({ open, onCancel, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    setReady(false);
  }, []);

  const snap = useCallback(() => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    stop();
    onCapture(dataUrl);
  }, [onCapture, stop]);

  useEffect(() => {
    if (!open) {
      stop();
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    setReady(false);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setReady(true);
        }
      } catch (err) {
        console.error('[webcam] getUserMedia failed', err);
        setError(err instanceof Error ? err.message : 'Camera unavailable');
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, stop]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        snap();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onCancel, snap]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-charcoal/80 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="relative bg-cream border border-cream-border shadow-2xl max-w-[92vw] max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-6">
          <p className="text-[12px] uppercase tracking-[0.22em] text-charcoal-muted font-medium">
            Show your work
          </p>
          <p className="text-[11px] text-charcoal-muted/80 tabular-nums">
            <span className="text-charcoal-secondary">Esc</span> to cancel
          </p>
        </div>
        <div className="relative bg-black" style={{ width: 'min(80vw, 1100px)' }}>
          {error ? (
            <div className="p-8 text-center text-cream">
              <p className="text-sm mb-2">Camera unavailable</p>
              <p className="text-[11px] text-cream/60">{error}</p>
            </div>
          ) : (
            <video
              ref={videoRef}
              muted
              playsInline
              className="block w-full h-auto max-h-[75vh] object-contain"
            />
          )}
          {!error && !ready && (
            <div className="absolute inset-0 flex items-center justify-center text-cream/70 text-[12px]">
              Starting camera…
            </div>
          )}
        </div>
        <div className="px-5 py-3 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="text-[13px] text-charcoal-muted hover:text-charcoal transition-colors px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={snap}
            disabled={!ready || !!error}
            className="flex items-center gap-2 px-5 py-2 text-[13px] font-semibold bg-green text-white hover:bg-green-hover transition-all active:scale-[0.98] shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>Snap &amp; submit</span>
            <span className="text-[11px] text-white/70 tabular-nums">Space</span>
          </button>
        </div>
      </div>
    </div>
  );
}
