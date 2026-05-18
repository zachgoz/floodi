import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IonButton, IonIcon } from '@ionic/react';
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
    summary: 'This readout combines the selected water level, surge, wind, rain, flood category, road depth, timing, and source details.',
  },
  {
    icon: analyticsOutline,
    label: 'Hydrograph',
    targetId: 'hydrograph',
    title: 'Use the chart as the time control',
    summary: 'The hydrograph shows observed, NOAA predicted, and FloodCast-adjusted water levels. Pan or tap the chart to move the whole dashboard through time.',
  },
  {
    icon: calendarOutline,
    label: 'Events',
    targetId: 'events',
    title: 'Jump to the next flooding windows',
    summary: 'Upcoming events summarize threshold crossings, peak timing, duration, and severity so you can inspect likely problem periods quickly.',
  },
  {
    icon: cameraOutline,
    label: 'Webcams',
    targetId: 'webcam',
    title: 'Verify conditions visually',
    summary: 'Webcam imagery stays synced to the selected time when imagery is available, helping compare the forecast to street-level evidence.',
  },
  {
    icon: mapOutline,
    label: 'Map',
    targetId: 'map',
    title: 'Connect water levels to roads',
    summary: 'The inundation map translates the selected water level into local road impact using road elevation and flood depth coloring.',
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
    summary: 'Settings control location, thresholds, offsets, time range, theme, chart mode, and whether comments appear on the chart.',
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
  return targets.find(isVisibleTourTarget) ?? targets[0] ?? null;
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
  const ionContent = target.closest('ion-content') as IonContentElement | null;
  if (ionContent?.getScrollElement && ionContent.scrollToPoint) {
    const scrollElement = await ionContent.getScrollElement();
    const targetRect = target.getBoundingClientRect();
    const contentRect = ionContent.getBoundingClientRect();
    const targetTop = scrollElement.scrollTop + targetRect.top - contentRect.top - TOP_SCROLL_OFFSET;

    await ionContent.scrollToPoint(0, Math.max(0, targetTop), 320);
    return;
  }

  const scrollParent = getScrollParent(target);
  const targetRect = target.getBoundingClientRect();

  if (scrollParent === window) {
    window.scrollTo({
      top: window.scrollY + targetRect.top - TOP_SCROLL_OFFSET,
      behavior: 'smooth',
    });
    return;
  }

  const parent = scrollParent as HTMLElement;
  const parentRect = parent.getBoundingClientRect();
  parent.scrollTo({
    top: parent.scrollTop + targetRect.top - parentRect.top - TOP_SCROLL_OFFSET,
    behavior: 'smooth',
  });
}

export const IntroTourOverlay: React.FC<IntroTourOverlayProps> = ({ onFinish, targetRoot }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const activeStep = tourSteps[activeIndex];
  const isLastStep = activeIndex === tourSteps.length - 1;

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
  }, [activeStep.targetId, targetRoot, updateTargetRect]);

  useEffect(() => {
    window.addEventListener('resize', updateTargetRect);
    document.addEventListener('scroll', updateTargetRect, true);

    return () => {
      window.removeEventListener('resize', updateTargetRect);
      document.removeEventListener('scroll', updateTargetRect, true);
    };
  }, [updateTargetRect]);

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
    if (!targetRect) return {};

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

  const handleFinish = () => {
    try {
      localStorage.setItem(INTRO_STORAGE_KEY, '1');
    } catch {
      // App remains usable if storage is unavailable.
    }

    onFinish();
  };

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

  if (!targetRect || !maskStyles) {
    return null;
  }

  return (
    <div className="intro-tour-overlay" role="dialog" aria-modal="true" aria-label="FloodCast dashboard intro">
      <div className="intro-tour-mask" style={maskStyles.top} />
      <div className="intro-tour-mask" style={maskStyles.right} />
      <div className="intro-tour-mask" style={maskStyles.bottom} />
      <div className="intro-tour-mask" style={maskStyles.left} />
      <div className="intro-tour-spotlight" style={spotlightStyle} />

      <section className="intro-tour-card" style={cardStyle} aria-live="polite">
        <div className="intro-tour-card-header">
          <div className="intro-tour-step-icon">
            <IonIcon icon={activeStep.icon} />
          </div>
          <button type="button" className="intro-tour-close" onClick={handleFinish} aria-label="Close intro">
            <IonIcon icon={closeOutline} />
          </button>
        </div>

        <p className="intro-tour-eyebrow">Component {activeIndex + 1} of {tourSteps.length}</p>
        <h2>{activeStep.title}</h2>
        <p>{activeStep.summary}</p>

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
          <IonButton
            fill="outline"
            size="small"
            onClick={handleBack}
            disabled={activeIndex === 0}
            className="intro-tour-back"
          >
            <IonIcon icon={chevronBackOutline} slot="start" />
            Back
          </IonButton>
          <IonButton size="small" onClick={handleNext} className="intro-tour-next">
            {isLastStep ? 'Start using FloodCast' : 'Next'}
            <IonIcon icon={chevronForwardOutline} slot="end" />
          </IonButton>
        </div>
      </section>
    </div>
  );
};

export default IntroTourOverlay;
