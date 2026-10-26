'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';

export type RFZAnimationPreset = 'holographic-reveal' | 'cinematic-depth' | 'futuristic-energy' | 'minimal-motion' | 'static';
export type RFZMotionSpeed = 'fast' | 'standard' | 'relaxed';

export type RFZCinematicSlide = {
  id: string;
  image: string;
  title?: string | null;
  body?: string | null;
  ctaText?: string | null;
  ctaHref?: string | null;
  animationPreset?: RFZAnimationPreset;
  motionSpeed?: RFZMotionSpeed;
  autoplay?: boolean;
};

const DISPLAY_MS: Record<RFZMotionSpeed, number> = { fast: 6200, standard: 7200, relaxed: 8400 };
const EXIT_MS = 780;

function normalizePreset(value: RFZAnimationPreset | undefined): RFZAnimationPreset {
  return value || 'holographic-reveal';
}

function SceneLayer({ slide, phase, token }: { slide: RFZCinematicSlide; phase: 'enter' | 'exit'; token: number }) {
  const preset = normalizePreset(slide.animationPreset);
  return (
    <div
      key={`${slide.id}-${phase}-${token}`}
      className={`rfz-cinematic-scene rfz-cinematic-scene--${preset} rfz-cinematic-scene--${phase}`}
      data-testid={phase === 'enter' ? 'rfz-cinematic-scene' : 'rfz-cinematic-exit-scene'}
      data-animation-preset={preset}
      aria-hidden={phase === 'exit'}
    >
      <img data-testid={phase === 'enter' ? 'rfz-cinematic-art' : undefined} className="rfz-cinematic-art" src={slide.image} alt={phase === 'enter' ? (slide.title || 'Featured RunFazone promotion') : ''} />
      <span className="rfz-cinematic-depth" />
      <span className="rfz-cinematic-energy" />
      <span className="rfz-cinematic-frame" />
    </div>
  );
}

export default function RFZCinematicHero({ slides }: { slides: RFZCinematicSlide[] }) {
  const safeSlides = useMemo(() => slides.filter((slide) => Boolean(slide.image)), [slides]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [outgoing, setOutgoing] = useState<RFZCinematicSlide | null>(null);
  const [transitionToken, setTransitionToken] = useState(0);
  const [paused, setPaused] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const swipeStart = useRef<number | null>(null);
  const exitTimer = useRef<number | null>(null);

  const activeSlide = safeSlides[activeIndex] || safeSlides[0];
  const motionDisabled = reducedMotion || tabHidden;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    const visibility = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      media.removeEventListener?.('change', update);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  useEffect(() => {
    if (activeIndex < safeSlides.length) return;
    setActiveIndex(0);
  }, [activeIndex, safeSlides.length]);

  useEffect(() => {
    const next = safeSlides[(activeIndex + 1) % safeSlides.length];
    if (!next || next === activeSlide) return;
    const image = new window.Image();
    image.src = next.image;
  }, [activeIndex, activeSlide, safeSlides]);

  useEffect(() => () => {
    if (exitTimer.current) window.clearTimeout(exitTimer.current);
  }, []);

  const changeTo = useCallback((nextIndex: number) => {
    if (!activeSlide || safeSlides.length < 2) return;
    const normalized = (nextIndex + safeSlides.length) % safeSlides.length;
    if (normalized === activeIndex) return;
    setOutgoing(activeSlide);
    setActiveIndex(normalized);
    setTransitionToken((token) => token + 1);
    if (exitTimer.current) window.clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(() => setOutgoing(null), reducedMotion ? 0 : EXIT_MS);
  }, [activeIndex, activeSlide, reducedMotion, safeSlides.length]);

  useEffect(() => {
    if (safeSlides.length < 2 || !activeSlide || paused || motionDisabled || activeSlide.autoplay === false) return;
    const timer = window.setTimeout(() => changeTo(activeIndex + 1), DISPLAY_MS[activeSlide.motionSpeed || 'standard']);
    return () => window.clearTimeout(timer);
  }, [activeIndex, activeSlide, changeTo, motionDisabled, paused, safeSlides.length]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); changeTo(activeIndex + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); changeTo(activeIndex - 1); }
    if (event.key === 'Home') { event.preventDefault(); changeTo(0); }
    if (event.key === 'End') { event.preventDefault(); changeTo(safeSlides.length - 1); }
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') swipeStart.current = event.clientX;
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (swipeStart.current === null) return;
    const distance = event.clientX - swipeStart.current;
    swipeStart.current = null;
    if (Math.abs(distance) > 44) changeTo(activeIndex + (distance < 0 ? 1 : -1));
  };

  if (!activeSlide) return null;
  const preset = normalizePreset(activeSlide.animationPreset);

  return (
    <section
      id="top"
      className="mx-auto max-w-[1180px] px-5 pt-7"
      aria-label="Featured RunFazone promotions"
      onKeyDown={onKeyDown}
    >
      <div
        className="rfz-cinematic-hero hero-glow relative overflow-hidden rounded-2xl border border-[var(--rfz-line)]"
        data-testid="rfz-cinematic-hero"
        data-scene-index={activeIndex}
        data-animation-preset={preset}
        data-reduced-motion={reducedMotion ? 'true' : 'false'}
        data-paused={paused || tabHidden ? 'true' : 'false'}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}
      >
        {outgoing && <SceneLayer key={`exit-${outgoing.id}-${transitionToken}`} slide={outgoing} phase="exit" token={transitionToken} />}
        <SceneLayer key={`enter-${activeSlide.id}-${transitionToken}`} slide={activeSlide} phase="enter" token={transitionToken} />
      </div>
      <div className="rfz-cinematic-control-strip" aria-label="Featured promotion controls">
        <div className="rfz-cinematic-controls">
          <button type="button" aria-label="Previous promotion" onClick={() => changeTo(activeIndex - 1)}><ChevronLeft size={17} aria-hidden="true" /></button>
          <button type="button" aria-label={paused ? 'Play banner animation' : 'Pause banner animation'} aria-pressed={paused} onClick={() => setPaused((value) => !value)}>
            {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          </button>
          <button type="button" aria-label="Next promotion" onClick={() => changeTo(activeIndex + 1)}><ChevronRight size={17} aria-hidden="true" /></button>
        </div>
        <div className="rfz-cinematic-indicators" role="tablist" aria-label="Featured promotions">
          {safeSlides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              role="tab"
              aria-label={`Show promotion ${index + 1}`}
              aria-selected={activeIndex === index}
              onClick={() => changeTo(index)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
