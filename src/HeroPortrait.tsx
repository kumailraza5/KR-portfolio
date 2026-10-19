'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Square, LoaderCircle } from 'lucide-react';
import { TransparentVideoRenderer } from './transparentVideo';
import { isIOS } from './isIOS';

type Phase = 'idle' | 'loading' | 'playing';

/**
 * Displays a static transparent portrait on iOS devices (iPhone, iPad, iPod),
 * preventing video transparency glitches, black rectangles, and unwanted downloads.
 *
 * On non-iOS devices, cross-fades to a transparent video introduction when the user
 * (or autoplay) triggers playback. The video is decoded by a hidden <video> element
 * (for audio + GPU decode) and a WebGL canvas reconstructs transparency.
 */
export default function HeroPortrait({ src }: { src?: string }) {
  // Synchronously detect iOS to ensure the video element is never rendered or preloaded on iOS
  const [isIOSDevice, setIsIOSDevice] = useState(() => isIOS());

  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const renderer   = useRef<TransparentVideoRenderer | null>(null);
  const reqId      = useRef(0);
  const initialAttempted = useRef(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');

  // Re-verify on client mount
  useEffect(() => {
    setIsIOSDevice(isIOS());
  }, []);

  // ── stop: pause video, halt renderer RAF, return to idle ──────────────────
  const stop = useCallback(() => {
    initialAttempted.current = true;
    reqId.current++;
    const vid = videoRef.current;
    if (vid) { vid.pause(); vid.muted = true; }
    renderer.current?.stop();
    setPhase('idle');
  }, []);

  // ── Intersection + visibility: stop when scrolled away / tab hidden ───────
  useEffect(() => {
    if (isIOSDevice) return;
    const vid = videoRef.current;
    if (!vid) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (!e.isIntersecting) stop(); },
      { threshold: 0.1 },
    );
    obs.observe(vid);
    const onHide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      obs.disconnect();
      document.removeEventListener('visibilitychange', onHide);
      reqId.current++;
      vid.pause();
    };
  }, [src, stop, isIOSDevice]);

  // ── One-time autoplay attempt after the page finishes loading ─────────────
  useEffect(() => {
    if (isIOSDevice) return;
    let frame = 0;
    const attempt = () => {
      frame = requestAnimationFrame(() => {
        if (!videoRef.current || initialAttempted.current || document.hidden) return;
        const b = videoRef.current.getBoundingClientRect();
        if (b.bottom <= 0 || b.top >= window.innerHeight) return;
        void startIntro(true);
      });
    };
    if (document.readyState === 'complete') attempt();
    else window.addEventListener('load', attempt, { once: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('load', attempt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, isIOSDevice]);

  // ── WebGL context-loss recovery ───────────────────────────────────────────
  useEffect(() => {
    if (isIOSDevice) return;
    const cnv = canvasRef.current;
    if (!cnv) return;
    const onLoss = () => {
      renderer.current = null; // context is gone; recreate on next play
      stop();
    };
    cnv.addEventListener('webglcontextlost', onLoss, { passive: true });
    return () => cnv.removeEventListener('webglcontextlost', onLoss);
  }, [stop, isIOSDevice]);

  // ── Destroy renderer on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => { renderer.current?.destroy(); };
  }, []);

  // ── Play (non-iOS only) ───────────────────────────────────────────────────
  async function startIntro(automatic = false) {
    if (isIOSDevice) return;
    initialAttempted.current = true;
    const vid = videoRef.current;
    const cnv = canvasRef.current;
    if (!vid || !cnv) return;

    const id = ++reqId.current;
    setError('');
    setPhase('loading');

    if (vid.error) vid.load();
    vid.currentTime = 0;
    vid.muted = false;
    vid.volume = 1;

    // Initialise (or reuse) the WebGL renderer.
    if (!renderer.current) {
      try {
        renderer.current = new TransparentVideoRenderer(cnv, vid);
      } catch {
        if (id !== reqId.current) return;
        stop();
        setError('Video not supported on this device.');
        return;
      }
    }

    try {
      await vid.play();
      if (id !== reqId.current) return;
      renderer.current.start();
      setPhase('playing');
    } catch (reason) {
      if (id !== reqId.current) return;
      stop();
      const blocked =
        reason instanceof DOMException && reason.name === 'NotAllowedError';
      if (!automatic || !blocked)
        setError('Could not play the intro. Tap to try again.');
    }
  }

  function toggleIntro() {
    if (isIOSDevice) return;
    if (phase !== 'idle') { stop(); return; }
    void startIntro();
  }

  const handleEnded = () => { renderer.current?.stop(); stop(); };
  const handleError = () => {
    renderer.current?.stop();
    stop();
    setError('Could not load the intro. Tap to retry.');
  };

  // On iOS devices: completely disable intro video, video element, and play button.
  // Display only the clean static transparent portrait.
  if (isIOSDevice) {
    return (
      <div className="portrait-depth">
        <img
          src="/portrait.png"
          alt="Kumail Raza seated in a chair"
          fetchPriority="high"
          className="portrait-poster"
        />
      </div>
    );
  }

  return (
    <>
      <div className="portrait-depth">
        {/* Static portrait — shown when idle, hidden during playback */}
        <img
          src="/portrait.png"
          alt="Kumail Raza seated in a chair"
          fetchPriority="high"
          className={`portrait-poster${phase === 'playing' ? ' hidden' : ''}`}
        />

        {src && (
          <>
            {/*
              Hidden decoder video:
              - playsInline prevents iOS fullscreen takeover
              - preload="none" avoids loading until play() is called
              - Sized to 1 x 1 px, opacity 0 — never directly visible
              - Must stay in the DOM (not display:none) so the GPU can decode
            */}
            <video
              ref={videoRef}
              src={src}
              className="portrait-video-hidden"
              playsInline
              preload="none"
              aria-hidden="true"
              tabIndex={-1}
              onEnded={handleEnded}
              onError={handleError}
            />

            {/*
              WebGL canvas — renders the transparent composite.
              Invisible (opacity:0) until a valid frame is ready (.ready class).
            */}
            <canvas
              ref={canvasRef}
              className={`portrait-canvas${phase === 'playing' ? ' ready' : ''}`}
              aria-label="Kumail Raza's spoken introduction"
            />
          </>
        )}
      </div>

      {src && (
        <div className="intro-controls">
          <button
            className="intro-play"
            onClick={toggleIntro}
            aria-label={
              phase === 'idle'    ? 'Play introduction with voice'   :
              phase === 'loading' ? 'Cancel loading introduction'    :
                                   'Stop introduction'
            }
            title={phase === 'idle' ? 'Play my introduction' : 'Stop introduction'}
            aria-pressed={phase !== 'idle'}
          >
            {phase === 'loading' ? (
              <LoaderCircle className="intro-loading" size={22} />
            ) : phase === 'playing' ? (
              <Square size={18} />
            ) : (
              <Play size={22} />
            )}
          </button>
          <span className="intro-error" role="status">{error}</span>
        </div>
      )}
    </>
  );
}
