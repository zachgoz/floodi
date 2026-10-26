import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IonIcon } from '@ionic/react';
import {
  analyticsOutline,
  calendarOutline,
  cameraOutline,
  chevronBackOutline,
  chevronForwardOutline,
  closeOutline,
  mapOutline,
  optionsOutline,
  speedometerOutline,
  waterOutline,
} from 'ionicons/icons';
import './IntroTourOverlay.css';

export const INTRO_STORAGE_KEY = 'floodcast_intro_seen';

type TourStep = {
  icon: string;
  label: string;
  targetId: string;
  title: string;
  summary: string;
};

const tourSteps: TourStep[] = [
  {
    icon: waterOutline,
    label: 'Live Readout',
    targetId: 'live-readout',
    title: 'Start with the current flood signal',
    summary: 'Check the observed water level and flood status. The timestamp shows when the sensor last reported.',
  },
  {
    icon: analyticsOutline,
    label: 'Hydrograph',
    targetId: 'hydrograph',
    title: 'Use the chart as the time control',
    summary: 'Compare observed water levels, NOAA tides and the FloodCast forecast. Pan or zoom either chart to move both through time.',
  },
  {
    icon: calendarOutline,
    label: 'Events',
    targetId: 'events',
    title: 'Jump to the next flooding windows',
    summary: 'See expected flooding windows and peak water levels. Longer-range events are marked as planning outlooks.',
  },
  {
    icon: cameraOutline,
    label: 'Webcams',
    targetId: 'webcam',
    title: 'Verify conditions visually',
    summary: 'Compare available camera images with the selected time. Check the capture time: an image can be older than the chart.',
  },
  {
    icon: mapOutline,
    label: 'Map',
    targetId: 'map',
    title: 'Explore estimated local impacts',
    summary: 'The map estimates how water levels may affect nearby streets. It does not confirm road conditions or safe routes.',
  },
  {
    icon: speedometerOutline,
    label: 'Simulator',
    targetId: 'simulator',
    title: 'Test different water levels',
    summary: 'Use the simulator to drag the water level up or down and see how the map and risk context change for what-if planning.',
  },
  {
    icon: optionsOutline,
    label: 'Controls',
    targetId: 'settings',
    title: 'Tune FloodCast for your view',
    summary: 'Choose your theme and chart preferences. Analysis controls customize this device’s charts and do not change flood alert criteria.',
  },
];

const SPOTLIGHT_MARGIN = 8;
const TOP_SCROLL_OFFSET = 12;

type TargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type IonContentElement = HTMLElement & {
  getScrollElement?: () => Promise<HTMLElement>;
  scrollToPoint?: (x: number, y: number, duration?: number) => Promise<void>;
};

interface IntroTourOverlayProps {
  onFinish: () => void;
  targetRoot?: React.RefObject<HTMLElement | null>;
}

function isVisibleTourTarget(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const hiddenPage = element.closest('ion-page.ion-page-hidden');

  return rect.width > 0
    && rect.height > 0
    && style.display !== 'none'
    && style.visibility !== 'hidden'
    && !hiddenPage;
}

function getTourTarget(targetId: string, root?: HTMLElement | null): HTMLElement | null {
  const searchRoot: ParentNode = root ?? document;
  const targets = Array.from(searchRoot.querySelectorAll<HTMLElement>(`[data-tour-id="${targetId}"]`));
  return targets.find(isVisibleTourTarget) ?? null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getScrollParent(element: HTMLElement): HTMLElement | Window {
  let parent = element.parentElement;

  while (parent) {
    const style = window.getComputedStyle(parent);
    const canScroll = /(auto|scroll)/.test(`${style.overflowY}${style.overflow}`);
    if (canScroll && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }

    parent = parent.parentElement;
  }

  return window;
}

async function scrollTargetToTop(target: HTMLElement) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ionContent = target.closest('ion-content') as IonContentElement | null;
  if (ionContent?.getScrollElement && ionContent.scrollToPoint) {
    const scrollElement = await ionContent.getScrollElement();
    const targetRect = target.getBoundingClientRect();
    const contentRect = ionContent.getBoundingClientRect();
    const targetTop = scrollElement.scrollTop + targetRect.top - contentRect.top - TOP_SCROLL_OFFSET;

    await ionContent.scrollToPoint(0, Math.max(0, targetTop), reducedMotion ? 0 : 320);
    return;
  }

  const scrollParent = getScrollParent(target);
  const targetRect = target.getBoundingClientRect();

  if (scrollParent === window) {
    window.scrollTo({
      top: window.scrollY + targetRect.top - TOP_SCROLL_OFFSET,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
    return;
  }

  const parent = scrollParent as HTMLElement;
  const parentRect = parent.getBoundingClientRect();
  parent.scrollTo({
    top: parent.scrollTop + targetRect.top - parentRect.top - TOP_SCROLL_OFFSET,
    behavior: reducedMotion ? 'auto' : 'smooth',
  });
}

export const IntroTourOverlay: React.FC<IntroTourOverlayProps> = ({ onFinish, targetRoot }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [closed, setClosed] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const activeStep = tourSteps[activeIndex];
  const isLastStep = activeIndex === tourSteps.length - 1;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const finishRef = useRef(onFinish);
  useEffect(() => { finishRef.current = onFinish; }, [onFinish]);
  const handleFinish = useCallback(() => {
    try { localStorage.setItem(INTRO_STORAGE_KEY, '1'); } catch { /* Storage is optional. */ }
    setClosed(true);
    finishRef.current();
  }, []);

  useEffect(() => {
    if (closed || pageHidden || dialogRef.current?.closest('.ion-page-hidden')) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const trapFocus = (event: KeyboardEvent) => {
      if (dialogRef.current?.closest('.ion-page-hidden')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); handleFinish(); return; }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
      const first = buttons[0], last = buttons.at(-1);
      if (!first || !last) return;
      const outside = !dialogRef.current?.contains(document.activeElement);
      if (outside || event.shiftKey && document.activeElement === first) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (dialogRef.current?.closest('.ion-page-hidden')) return;
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) closeRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', trapFocus, true);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus, true);
      document.removeEventListener('focusin', containFocus);
      if (previousFocus?.isConnected && !previousFocus.closest('.ion-page-hidden')) previousFocus.focus({ preventScroll: true });
    };
  }, [closed, pageHidden, handleFinish]);

  // Ionic may retain a hidden route rather than unmounting it. A replay must
  // reopen the tour, while a hidden cached page must never trap focus.
  useEffect(() => {
    const page = targetRoot?.current;
    if (!page) return;
    let wasHidden = page.classList.contains('ion-page-hidden');
    setPageHidden(wasHidden);
    const observer = new MutationObserver(() => {
      const hidden = page.classList.contains('ion-page-hidden');
      setPageHidden(hidden);
      if (wasHidden && !hidden) {
        setActiveIndex(0);
        setTargetRect(null);
        setClosed(false);
        closeRef.current?.focus({ preventScroll: true });
      }
      wasHidden = hidden;
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [targetRoot]);

  const updateTargetRect = useCallback(() => {
    const target = getTourTarget(activeStep.targetId, targetRoot?.current);
    if (!target) {
      setTargetRect(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    setTargetRect({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
  }, [activeStep.targetId, targetRoot]);

  useEffect(() => {
    if (closed || pageHidden) return;
    const target = getTourTarget(activeStep.targetId, targetRoot?.current);
    if (target) {
      void scrollTargetToTop(target).then(updateTargetRect);
    }

    const frame = window.requestAnimationFrame(updateTargetRect);
    const settleTimer = window.setTimeout(updateTargetRect, 320);
    const retryTimer = window.setInterval(updateTargetRect, 250);
    const observer = new MutationObserver(updateTargetRect);
    observer.observe(targetRoot?.current ?? document.body, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.clearInterval(retryTimer);
      observer.disconnect();
    };
  }, [activeStep.targetId, closed, pageHidden, targetRoot, updateTargetRect]);

  useEffect(() => {
    if (closed || pageHidden) return;
    window.addEventListener('resize', updateTargetRect);
    document.addEventListener('scroll', updateTargetRect, true);

    return () => {
      window.removeEventListener('resize', updateTargetRect);
      document.removeEventListener('scroll', updateTargetRect, true);
    };
  }, [closed, pageHidden, updateTargetRect]);

  const spotlightStyle = useMemo<React.CSSProperties>(() => {
    if (!targetRect) return {};

    return {
      top: `${Math.max(8, targetRect.top - SPOTLIGHT_MARGIN)}px`,
      left: `${Math.max(8, targetRect.left - SPOTLIGHT_MARGIN)}px`,
      width: `${targetRect.width + SPOTLIGHT_MARGIN * 2}px`,
      height: `${targetRect.height + SPOTLIGHT_MARGIN * 2}px`,
    };
  }, [targetRect]);

  const maskStyles = useMemo<Record<'top' | 'right' | 'bottom' | 'left', React.CSSProperties> | null>(() => {
    if (!targetRect) return null;

    const top = Math.max(0, targetRect.top - SPOTLIGHT_MARGIN);
    const left = Math.max(0, targetRect.left - SPOTLIGHT_MARGIN);
    const right = Math.min(window.innerWidth, targetRect.left + targetRect.width + SPOTLIGHT_MARGIN);
    const bottom = Math.min(window.innerHeight, targetRect.top + targetRect.height + SPOTLIGHT_MARGIN);

    return {
      top: {
        top: 0,
        left: 0,
        width: '100vw',
        height: `${top}px`,
      },
      right: {
        top: `${top}px`,
        left: `${right}px`,
        width: `${Math.max(0, window.innerWidth - right)}px`,
        height: `${Math.max(0, bottom - top)}px`,
      },
      bottom: {
        top: `${bottom}px`,
        left: 0,
        width: '100vw',
        height: `${Math.max(0, window.innerHeight - bottom)}px`,
      },
      left: {
        top: `${top}px`,
        left: 0,
        width: `${left}px`,
        height: `${Math.max(0, bottom - top)}px`,
      },
    };
  }, [targetRect]);

  const cardStyle = useMemo<React.CSSProperties>(() => {
    if (!targetRect) return { width: 'min(390px, calc(100vw - 28px))', bottom: '18px', left: 'max(14px, calc(50vw - 195px))' };

    const cardWidth = Math.min(390, window.innerWidth - 28);
    const cardHeightEstimate = window.innerWidth < 680 ? 356 : 340;
    const gap = 16;
    const rightSpace = window.innerWidth - (targetRect.left + targetRect.width) - gap;
    const leftSpace = targetRect.left - gap;
    const sideTop = `${clamp(targetRect.top, TOP_SCROLL_OFFSET, window.innerHeight - cardHeightEstimate - gap)}px`;
    const centeredLeft = `${clamp(targetRect.left + targetRect.width / 2 - cardWidth / 2, 14, window.innerWidth - cardWidth - 14)}px`;
    const targetIsLow = targetRect.top + targetRect.height > window.innerHeight * 0.62;
    const hasAboveSpace = targetRect.top > cardHeightEstimate + gap;

    if (targetIsLow && hasAboveSpace) {
      return {
        width: `${cardWidth}px`,
        top: `${clamp(targetRect.top - cardHeightEstimate - gap, 14, window.innerHeight - cardHeightEstimate - gap)}px`,
        left: centeredLeft,
      };
    }

    if (window.innerWidth >= 900 && rightSpace >= cardWidth) {
      return {
        width: `${cardWidth}px`,
        top: sideTop,
        left: `${targetRect.left + targetRect.width + gap}px`,
      };
    }

    if (window.innerWidth >= 900 && leftSpace >= cardWidth) {
      return {
        width: `${cardWidth}px`,
        top: sideTop,
        left: `${targetRect.left - cardWidth - gap}px`,
      };
    }

    return {
      width: `${cardWidth}px`,
      bottom: window.innerWidth < 680 ? '18px' : '16px',
      left: centeredLeft,
    };
  }, [targetRect]);

  const handleNext = () => {
    if (isLastStep) {
      handleFinish();
      return;
    }

    setActiveIndex(index => Math.min(index + 1, tourSteps.length - 1));
  };

  const handleBack = () => {
    setActiveIndex(index => Math.max(index - 1, 0));
  };

  if (closed || pageHidden) return null;

  return (
    <div ref={dialogRef} className="intro-tour-overlay" role="dialog" aria-modal="true" aria-labelledby="intro-tour-title" aria-describedby="intro-tour-summary">
      {maskStyles ? <>
        <div className="intro-tour-mask" style={maskStyles.top} aria-hidden="true" />
        <div className="intro-tour-mask" style={maskStyles.right} aria-hidden="true" />
        <div className="intro-tour-mask" style={maskStyles.bottom} aria-hidden="true" />
        <div className="intro-tour-mask" style={maskStyles.left} aria-hidden="true" />
        <div className="intro-tour-spotlight" style={spotlightStyle} aria-hidden="true" />
      </> : <div className="intro-tour-mask intro-tour-mask-full" aria-hidden="true" />}

      <section className="intro-tour-card" style={cardStyle}>
        <div className="intro-tour-card-header">
          <div className="intro-tour-step-icon">
            <IonIcon icon={activeStep.icon} aria-hidden="true" />
          </div>
          <button ref={closeRef} type="button" className="intro-tour-close" onClick={handleFinish} aria-label="Close intro">
            <IonIcon icon={closeOutline} aria-hidden="true" />
          </button>
        </div>

        <div aria-live="polite" aria-atomic="true">
          <p className="intro-tour-eyebrow">Step {activeIndex + 1} of {tourSteps.length}</p>
          <h2 id="intro-tour-title">{activeStep.title}</h2>
          <p id="intro-tour-summary">{activeStep.summary}</p>
        </div>

        <nav className="intro-tour-step-list" aria-label="Intro sections">
          {tourSteps.map((step, index) => (
            <button
              key={step.label}
              type="button"
              className={`intro-tour-dot ${index === activeIndex ? 'active' : ''}`}
              onClick={() => setActiveIndex(index)}
              aria-label={`Go to ${step.label}`}
              aria-current={index === activeIndex ? 'step' : undefined}
            />
          ))}
        </nav>

        <div className="intro-tour-actions">
          <button
            type="button"
            onClick={handleBack}
            disabled={activeIndex === 0}
            className="intro-tour-back"
          >
            <IonIcon icon={chevronBackOutline} aria-hidden="true" />
            Back
          </button>
          <button type="button" onClick={handleNext} className="intro-tour-next">
            {isLastStep ? 'Start using FloodCast' : 'Next'}
            <IonIcon icon={chevronForwardOutline} aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
};

export default IntroTourOverlay;
