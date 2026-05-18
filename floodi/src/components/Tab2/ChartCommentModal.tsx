import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonTitle, IonToolbar } from '@ionic/react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard, type KeyboardInfo } from '@capacitor/keyboard';
import { closeOutline, shieldCheckmark } from 'ionicons/icons';
import { CommentForm, type CommentFormValues } from 'src/components/comments/CommentForm';
import type { Comment, CommentTimeRange } from 'src/types/comment';
import type { AppConfiguration } from './types';
import { formatTimeRangeForDisplay } from 'src/utils/timeRangeHelpers';
import { useComments } from 'src/hooks/useComments';
import { useAuth } from 'src/contexts/AuthContext';

export interface ChartCommentModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  /** Selected time range from chart */
  range: CommentTimeRange | null;
  /** Existing comments at this time/location */
  existingComments?: Comment[];
  /** Current app configuration for station/timezone */
  config: AppConfiguration;
  /** Optional water level at the selected time */
  waterLevel?: number | null;
}

export const ChartCommentModal: React.FC<ChartCommentModalProps> = ({ isOpen, onDismiss, range, existingComments = [], config, waterLevel }) => {
  const { create, loading } = useComments({ locationId: config?.locationId, realtime: false });
  const { user } = useAuth();
  const modalRef = useRef<HTMLIonModalElement>(null);
  const contentRef = useRef<HTMLIonContentElement>(null);
  const keyboardInsetRef = useRef(0);

  const rangeDisplay = useMemo(() => (range ? formatTimeRangeForDisplay(range, config?.display?.timezone || 'local') : null), [range, config?.display?.timezone]);
  const commentCount = existingComments.length;
  
  const levelSuffix = waterLevel !== undefined && waterLevel !== null ? ` (${waterLevel.toFixed(1)} ft)` : '';
  const title = commentCount > 1 
    ? `Comment Thread${rangeDisplay ? ` at ${rangeDisplay.label.split(' - ')[0]}` : ''}${levelSuffix}`
    : commentCount === 1
      ? `Comment Details${rangeDisplay ? ` at ${rangeDisplay.label.split(' - ')[0]}` : ''}${levelSuffix}`
      : `Comment${rangeDisplay ? ` at ${rangeDisplay.label.split(' - ')[0]}` : ''}${levelSuffix}`;

  const setKeyboardInset = useCallback((height: number) => {
    const inset = Math.max(0, Math.round(height));
    keyboardInsetRef.current = inset;
    contentRef.current?.style.setProperty('--keyboard-offset', `${inset}px`);
  }, []);

  const scrollEditorIntoView = useCallback((keyboardHeight = keyboardInsetRef.current) => {
    const scrollFocusedEditor = async () => {
      const content = contentRef.current;
      if (!content) return;

      const scrollElement = await content.getScrollElement();
      const editor = content.querySelector('.premium-textarea') as HTMLElement | null;
      if (!editor) return;

      const scrollRect = scrollElement.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();
      const edgePadding = 20;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const keyboardTop = keyboardHeight > 0 ? window.innerHeight - keyboardHeight : Number.POSITIVE_INFINITY;
      const visibleTop = Math.max(scrollRect.top, viewportTop) + edgePadding;
      const visibleBottom = Math.min(scrollRect.bottom, viewportBottom, keyboardTop) - edgePadding;
      const bottomOverflow = editorRect.bottom - visibleBottom;
      const topOverflow = visibleTop - editorRect.top;

      if (bottomOverflow > 0) {
        await content.scrollByPoint(0, bottomOverflow, 180);
      } else if (topOverflow > 0) {
        await content.scrollByPoint(0, -topOverflow, 180);
      }
    };

    window.setTimeout(() => {
      void scrollFocusedEditor();
    }, 120);
  }, []);

  const handleEditorFocus = useCallback(() => {
    const settleEditor = async () => {
      try {
        const currentBreakpoint = await modalRef.current?.getCurrentBreakpoint?.();
        if (typeof currentBreakpoint === 'number' && currentBreakpoint < 0.8) {
          await modalRef.current?.setCurrentBreakpoint?.(0.8);
        }
      } catch {
        // Breakpoint APIs are not available in every render environment.
      }
      scrollEditorIntoView();
    };

    void settleEditor();
  }, [scrollEditorIntoView]);

  useEffect(() => {
    if (!isOpen) return;

    let disposed = false;
    const handles: PluginListenerHandle[] = [];
    const storeKeyboardListener = async (listenerPromise: Promise<PluginListenerHandle>) => {
      const handle = await listenerPromise;
      if (disposed) {
        void handle.remove();
        return;
      }
      handles.push(handle);
    };

    if (Capacitor.isNativePlatform()) {
      const handleKeyboardShow = (info: KeyboardInfo) => {
        setKeyboardInset(info.keyboardHeight);
        scrollEditorIntoView(info.keyboardHeight);
      };
      const handleKeyboardHide = () => setKeyboardInset(0);

      void storeKeyboardListener(Keyboard.addListener('keyboardWillShow', handleKeyboardShow));
      void storeKeyboardListener(Keyboard.addListener('keyboardDidShow', handleKeyboardShow));
      void storeKeyboardListener(Keyboard.addListener('keyboardWillHide', handleKeyboardHide));
      void storeKeyboardListener(Keyboard.addListener('keyboardDidHide', handleKeyboardHide));
    }

    const viewport = window.visualViewport;
    const updateVisualViewportInset = () => {
      if (!viewport) return;
      const coveredHeight = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardInset(coveredHeight);
      if (coveredHeight > 0) scrollEditorIntoView(coveredHeight);
    };

    viewport?.addEventListener('resize', updateVisualViewportInset);
    viewport?.addEventListener('scroll', updateVisualViewportInset);

    return () => {
      disposed = true;
      setKeyboardInset(0);
      handles.forEach((handle) => void handle.remove());
      viewport?.removeEventListener('resize', updateVisualViewportInset);
      viewport?.removeEventListener('scroll', updateVisualViewportInset);
    };
  }, [isOpen, scrollEditorIntoView, setKeyboardInset]);

  const handleSubmit = async (values: CommentFormValues) => {
    if (!range || !user) return;
    await create({
      content: values.content,
      metadata: {
        locationId: config?.locationId || '',
        station: { 
          id: config?.station?.id || '', 
          name: config?.station?.name || '' 
        },
        timeRange: { ...range, eventType: values.eventType },
        dataContext: values.dataContexts,
        thresholdValue: values.threshold ?? null,
        waterLevel: waterLevel ?? null,
      },
    });
    onDismiss();
  };

  return (
    <>
      <style>
        {`
          /* The Atmospheric Sentinel Design System */
          .glass-modal {
            --comment-modal-backdrop-bg: rgba(247, 249, 251, 0.72);
            --comment-modal-content-bg: rgba(247, 249, 251, 0.78);
            --comment-modal-handle-bg: rgba(25, 28, 30, 0.18);
            --comment-modal-shadow: inset 1px 1px 0 rgba(255,255,255,0.2), 0 -8px 32px rgba(25, 28, 30, 0.15);
            --comment-modal-surface: rgba(255, 255, 255, 0.92);
            --comment-modal-surface-soft: rgba(255, 255, 255, 0.72);
            --comment-modal-border: rgba(255, 255, 255, 0.82);
            --comment-modal-title: #003358;
            --comment-modal-text: #191c1e;
            --comment-modal-muted: #515f74;
            --comment-modal-subtle: #8c97a5;
            --comment-modal-faint: #c1c7d0;
            --comment-modal-primary: #003358;
            --comment-modal-primary-hover: #004a7c;
            --comment-modal-primary-active: #002244;
            --comment-modal-button-text: #ffffff;
            --comment-modal-disabled-bg: #d8e0e7;
            --comment-modal-disabled-text: #667485;
            --comment-modal-official-bg: #eefbff;
            --comment-modal-official-text: #0076a8;
            --comment-modal-official-border: #cceeff;
            --comment-modal-pill-bg: rgba(0, 51, 88, 0.06);
            --comment-modal-pill-text: #003358;
            --background: var(--comment-modal-content-bg);
            --backdrop-opacity: 0.3;
          }
          .ion-palette-dark .glass-modal {
            --comment-modal-backdrop-bg: rgba(5, 12, 18, 0.72);
            --comment-modal-content-bg: rgba(14, 24, 33, 0.88);
            --comment-modal-handle-bg: rgba(226, 238, 246, 0.34);
            --comment-modal-shadow: inset 1px 1px 0 rgba(255,255,255,0.08), 0 -12px 38px rgba(0, 0, 0, 0.45);
            --comment-modal-surface: rgba(20, 32, 43, 0.94);
            --comment-modal-surface-soft: rgba(20, 32, 43, 0.76);
            --comment-modal-border: rgba(141, 173, 194, 0.24);
            --comment-modal-title: #e8f6ff;
            --comment-modal-text: #f1f7fb;
            --comment-modal-muted: #b7c8d6;
            --comment-modal-subtle: #8ea2b1;
            --comment-modal-faint: #6f8595;
            --comment-modal-primary: #67c5ff;
            --comment-modal-primary-hover: #48b6f3;
            --comment-modal-primary-active: #2f9fd7;
            --comment-modal-button-text: #06202f;
            --comment-modal-disabled-bg: rgba(83, 108, 126, 0.55);
            --comment-modal-disabled-text: #aabac6;
            --comment-modal-official-bg: rgba(72, 182, 243, 0.14);
            --comment-modal-official-text: #9fdeff;
            --comment-modal-official-border: rgba(72, 182, 243, 0.34);
            --comment-modal-pill-bg: rgba(103, 197, 255, 0.14);
            --comment-modal-pill-text: #bce8ff;
          }
          @media (prefers-color-scheme: dark) {
            html:not(.ion-palette-light) .glass-modal {
              --comment-modal-backdrop-bg: rgba(5, 12, 18, 0.72);
              --comment-modal-content-bg: rgba(14, 24, 33, 0.88);
              --comment-modal-handle-bg: rgba(226, 238, 246, 0.34);
              --comment-modal-shadow: inset 1px 1px 0 rgba(255,255,255,0.08), 0 -12px 38px rgba(0, 0, 0, 0.45);
              --comment-modal-surface: rgba(20, 32, 43, 0.94);
              --comment-modal-surface-soft: rgba(20, 32, 43, 0.76);
              --comment-modal-border: rgba(141, 173, 194, 0.24);
              --comment-modal-title: #e8f6ff;
              --comment-modal-text: #f1f7fb;
              --comment-modal-muted: #b7c8d6;
              --comment-modal-subtle: #8ea2b1;
              --comment-modal-faint: #6f8595;
              --comment-modal-primary: #67c5ff;
              --comment-modal-primary-hover: #48b6f3;
              --comment-modal-primary-active: #2f9fd7;
              --comment-modal-button-text: #06202f;
              --comment-modal-disabled-bg: rgba(83, 108, 126, 0.55);
              --comment-modal-disabled-text: #aabac6;
              --comment-modal-official-bg: rgba(72, 182, 243, 0.14);
              --comment-modal-official-text: #9fdeff;
              --comment-modal-official-border: rgba(72, 182, 243, 0.34);
              --comment-modal-pill-bg: rgba(103, 197, 255, 0.14);
              --comment-modal-pill-text: #bce8ff;
            }
          }
          .glass-modal::part(content) {
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
            background: var(--comment-modal-backdrop-bg);
            border-top-left-radius: 24px;
            border-top-right-radius: 24px;
            border: 1px solid var(--comment-modal-border);
            box-shadow: var(--comment-modal-shadow);
          }
          .glass-modal::part(handle) {
            background: var(--comment-modal-handle-bg);
            width: 48px;
            height: 5px;
            border-radius: 4px;
          }
          .glass-toolbar {
            --background: transparent;
            --border-width: 0;
            padding-top: 12px;
          }
          .glass-title {
            font-family: 'Inter', sans-serif;
            font-size: 1.125rem;
            font-weight: 600;
            letter-spacing: -0.01em;
            color: var(--comment-modal-title);
          }
          .modal-close-btn {
            --color: var(--comment-modal-muted);
            --color-hover: var(--comment-modal-title);
            --color-focused: var(--comment-modal-title);
            --color-activated: var(--comment-modal-title);
          }
          .premium-form-container {
            display: flex;
            flex-direction: column;
            gap: 20px;
            padding: 8px 16px 24px 16px;
          }
          .input-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
            background: var(--comment-modal-surface);
            border-radius: 12px;
            padding: 12px 16px;
            border: 1px solid var(--comment-modal-border);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
          }
          .premium-label {
            font-family: 'Inter', sans-serif;
            font-size: 0.875rem;
            color: var(--comment-modal-muted);
            font-weight: 500;
            margin-bottom: 4px;
          }
          .premium-textarea {
            --padding-start: 0;
            --padding-end: 0;
            --padding-top: 0;
            --padding-bottom: 0;
            --background: transparent;
            font-family: 'Inter', sans-serif;
            font-size: 1rem;
            color: var(--comment-modal-text);
            margin-top: 0;
          }
          .premium-textarea::part(native) {
            color: var(--comment-modal-text);
            caret-color: var(--comment-modal-primary);
          }
          .premium-textarea::part(native)::placeholder {
            color: var(--comment-modal-subtle);
            opacity: 0.9;
          }
          .char-count {
            display: flex;
            justify-content: flex-end;
            font-family: 'Inter', sans-serif;
            font-size: 0.75rem;
            color: var(--comment-modal-faint);
          }
          .form-actions {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-top: 8px;
          }
          .comment-auth-cta {
            gap: 16px;
          }
          .comment-auth-copy {
            display: flex;
            flex-direction: column;
            gap: 10px;
            background: var(--comment-modal-surface);
            border: 1px solid var(--comment-modal-border);
            border-radius: 12px;
            padding: 16px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
          }
          .comment-auth-copy p {
            margin: 0;
            color: var(--comment-modal-muted);
            font-family: 'Inter', sans-serif;
            font-size: 0.95rem;
            line-height: 1.4;
          }
          .ghost-btn {
            --color: var(--comment-modal-primary);
            font-family: 'Inter', sans-serif;
            font-weight: 600;
          }
          .gradient-btn {
            --background: linear-gradient(135deg, var(--comment-modal-primary-active), var(--comment-modal-primary-hover));
            --background-activated: var(--comment-modal-primary-active);
            --background-hover: var(--comment-modal-primary-hover);
            --color: var(--comment-modal-button-text);
            --border-radius: 24px;
            font-family: 'Inter', sans-serif;
            font-weight: 600;
            letter-spacing: 0.02em;
            margin: 0;
          }
          .gradient-btn.button-disabled {
            --background: var(--comment-modal-disabled-bg);
            --background-hover: var(--comment-modal-disabled-bg);
            --background-activated: var(--comment-modal-disabled-bg);
            --color: var(--comment-modal-disabled-text);
            opacity: 1;
          }
          .thread-container {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-bottom: 16px;
          }
          .thread-comment {
            background: var(--comment-modal-surface-soft);
            border-radius: 12px;
            padding: 14px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            border: 1px solid var(--comment-modal-border);
          }
          .thread-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
          }
          .author-wrapper {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .official-badge {
            display: flex;
            align-items: center;
            gap: 3px;
            background: var(--comment-modal-official-bg);
            color: var(--comment-modal-official-text);
            padding: 2px 8px;
            border-radius: 6px;
            font-size: 0.6rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            border: 1px solid var(--comment-modal-official-border);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
          }
          .badge-icon {
            font-size: 0.8rem;
          }
          .thread-author {
            font-family: 'Inter', sans-serif;
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--comment-modal-title);
          }
          .thread-time {
            font-family: 'Inter', sans-serif;
            font-size: 0.7rem;
            color: var(--comment-modal-subtle);
          }
          .thread-content-text {
            font-family: 'Inter', sans-serif;
            font-size: 0.95rem;
            line-height: 1.4;
            color: var(--comment-modal-text);
            margin: 0;
            white-space: pre-wrap;
          }
          .thread-pill {
            display: inline-block;
            padding: 1px 6px;
            background: var(--comment-modal-pill-bg);
            color: var(--comment-modal-pill-text);
            border-radius: 8px;
            font-size: 0.65rem;
            font-family: 'Inter', sans-serif;
            margin-top: 6px;
            margin-right: 4px;
            font-weight: 500;
          }
          .divider-label {
            font-family: 'Inter', sans-serif;
            font-size: 0.75rem;
            font-weight: 700;
            color: var(--comment-modal-title);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin: 8px 0 12px 0;
            opacity: 0.8;
          }
          .keyboard-aware-comment-content {
            --keyboard-offset: 0px;
            --padding-bottom: calc(24px + var(--keyboard-offset) + env(safe-area-inset-bottom));
          }
          .keyboard-aware-comment-content::part(scroll) {
            scroll-padding-bottom: calc(96px + var(--keyboard-offset));
          }
        `}
      </style>
      <IonModal 
        ref={modalRef}
        isOpen={isOpen} 
        onDidDismiss={onDismiss} 
        className="chart-comment-modal glass-modal" 
      aria-label="Comment Modal"
      initialBreakpoint={0.5}
      breakpoints={[0, 0.5, 0.8]}
    >
      <IonHeader className="ion-no-border">
        <IonToolbar className="glass-toolbar">
          <IonTitle className="glass-title">
            {title}
          </IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onDismiss} aria-label="Close" className="modal-close-btn">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent
        ref={contentRef}
        className="ion-padding keyboard-aware-comment-content"
      >
        {commentCount > 0 && (
          <div className="thread-container">
            {existingComments.map((c) => {
              if (!c) return null;
              return (
                <div key={c.id || Math.random()} className="thread-comment">
                  <div className="thread-header">
                    <div className="author-wrapper">
                      <span className="thread-author">{c.authorDisplayName || 'Anonymous User'}</span>
                      {c.isOfficial && (
                        <div className="official-badge">
                          <IonIcon icon={shieldCheckmark} className="badge-icon" />
                          <span>Official</span>
                        </div>
                      )}
                    </div>
                    <span className="thread-time">
                      {(c.createdAt?.toDate?.() || (c.createdAt?.seconds ? new Date(c.createdAt.seconds * 1000) : new Date())).toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="thread-content-text">{c.content}</p>
                  {(Array.isArray(c.metadata?.dataContext) ? c.metadata.dataContext : [c.metadata?.dataContext]).filter(Boolean).map((ctx, idx) => (
                    <span key={`${c.id}-ctx-${ctx}-${idx}`} className="thread-pill">{ctx}</span>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        
        {commentCount > 0 && <div className="divider-label">Reply or add observation</div>}
        
        <CommentForm
          locationId={config?.locationId}
          stationId={config?.station?.id}
          initialRange={range ? { start: new Date(range.startTime).toISOString(), end: new Date(range.endTime).toISOString() } : undefined}
          loading={loading}
          onSubmit={handleSubmit}
          onCancel={onDismiss}
          onEditorFocus={handleEditorFocus}
        />
      </IonContent>
    </IonModal>
    </>
  );
};

export default ChartCommentModal;
