import React, { useCallback, useMemo, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonCheckbox,
  IonCol,
  IonGrid,
  IonInput,
  IonItem,
  IonLabel,
  IonNote,
  IonRow,
  IonSpinner,
  IonTextarea,
} from '@ionic/react';
import { TimeRange, TimeRangePicker, CommentEventType } from 'src/components/comments/TimeRangePicker';
import { useAuth } from 'src/contexts/AuthContext';
import { useCommentPermissions } from 'src/hooks/useComments';
import * as commentValidation from 'src/utils/commentValidation';
import 'src/components/comments/styles/Comments.css';

/**
 * CommentForm
 *
 * Professional comment input form with integrated time range picker,
 * content textarea, data context selection, optional threshold value,
 * and robust validation and accessibility.
 */

export interface CommentFormValues {
  content: string;
  range?: TimeRange;
  eventType?: CommentEventType;
  dataContexts: Array<'observed' | 'predicted' | 'adjusted'>;
  threshold?: number;
}

export interface CommentFormProps {
  stationId?: string;
  chartDomain?: TimeRange;
  initialContent?: string;
  initialRange?: TimeRange;
  loading?: boolean;
  onSubmit: (values: CommentFormValues) => Promise<void> | void;
  onCancel?: () => void;
}

export const CommentForm: React.FC<CommentFormProps> = ({
  stationId,
  chartDomain,
  initialContent = '',
  initialRange,
  loading = false,
  onSubmit,
  onCancel,
}) => {
  const { user, isAnonymous } = useAuth?.() ?? { user: undefined, isAnonymous: true };
  const perms = useCommentPermissions?.(user) ?? { canCreate: false };

  const [content, setContent] = useState<string>(initialContent);
  const [range, setRange] = useState<TimeRange | undefined>(initialRange);
  const [eventType, setEventType] = useState<CommentEventType>('normal-tide');
  const [dataContexts, setDataContexts] = useState<Array<'observed' | 'predicted' | 'adjusted'>>([
    'observed',
  ]);
  const [threshold, setThreshold] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const characterCount = content.length;
  const characterLimit = 2000;

  const canSubmit = useMemo(() => {
    if (loading || submitting) return false;
    if (!perms?.canCreate) return false;
    if (!range) return false;
    if (characterCount === 0 || characterCount > characterLimit) return false;
    return true;
  }, [loading, submitting, perms?.canCreate, range, characterCount]);

  const toggleContext = (key: 'observed' | 'predicted' | 'adjusted') => {
    setDataContexts((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const validate = useCallback(() => {
    try {
      if (commentValidation?.validateCommentContent) {
        const res = (commentValidation as any).validateCommentContent(content);
        if (res && typeof res === 'object' && res.valid === false) return res.message ?? 'Invalid content.';
      }
    } catch {}
    if (characterCount === 0) return 'Please enter a comment.';
    if (characterCount > characterLimit) return 'Comment is too long (max 2000 characters).';
    if (!range) return 'Please select a time range.';
    if (threshold != null && Number.isNaN(threshold)) return 'Threshold must be a valid number.';
    return '';
  }, [content, characterCount, characterLimit, range, threshold]);

  const handleSubmit = async () => {
    const msg = validate();
    setError(msg);
    if (msg) return;
    setSubmitting(true);
    try {
      await onSubmit({ content, range, eventType, dataContexts, threshold });
      // clear form on success
      setContent('');
      setThreshold(undefined);
      setDataContexts(['observed']);
    } catch (e: any) {
      setError(e?.message || 'Failed to submit comment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <IonCard className="comments-card comments-form" aria-label="Create comment form">
      <IonCardHeader>
        <IonCardTitle>Create Comment</IonCardTitle>
      </IonCardHeader>
      <IonCardContent>
        {!perms?.canCreate && (
          <IonNote color="warning">
            You do not have permission to create comments.
          </IonNote>
        )}
        {isAnonymous && (
          <IonNote color="medium" className="comments-upgrade-note">
            Create an account to unlock comment history, editing, and notifications.
          </IonNote>
        )}

        <TimeRangePicker
          initialRange={initialRange}
          chartDomain={chartDomain}
          onChange={({ range: r, eventType: t }) => {
            setRange(r);
            setEventType(t);
          }}
        />

        <IonGrid>
          <IonRow>
            <IonCol size="12">
              <IonItem>
                <IonLabel position="stacked">Comment</IonLabel>
                <IonTextarea
                  value={content}
                  onIonInput={(e) => setContent((e.detail.value as string) ?? '')}
                  autoGrow
                  aria-label="Comment content"
                />
                <IonNote slot="helper">{characterCount}/{characterLimit}</IonNote>
              </IonItem>
            </IonCol>
          </IonRow>
          <IonRow>
            <IonCol size="12" sizeMd="8">
              <IonItem lines="none">
                <IonLabel>Observed</IonLabel>
                <IonCheckbox
                  checked={dataContexts.includes('observed')}
                  onIonChange={() => toggleContext('observed')}
                  aria-label="Observed data context"
                />
              </IonItem>
              <IonItem lines="none">
                <IonLabel>Predicted</IonLabel>
                <IonCheckbox
                  checked={dataContexts.includes('predicted')}
                  onIonChange={() => toggleContext('predicted')}
                  aria-label="Predicted data context"
                />
              </IonItem>
              <IonItem lines="none">
                <IonLabel>Adjusted</IonLabel>
                <IonCheckbox
                  checked={dataContexts.includes('adjusted')}
                  onIonChange={() => toggleContext('adjusted')}
                  aria-label="Adjusted data context"
                />
              </IonItem>
            </IonCol>
            <IonCol size="12" sizeMd="4">
              <IonItem>
                <IonLabel position="stacked">Threshold (optional)</IonLabel>
                <IonInput
                  type="number"
                  inputmode="decimal"
                  value={threshold as any}
                  onIonInput={(e) => {
                    const raw = (e.detail.value as string) ?? '';
                    if (raw.trim() === '') {
                      setThreshold(undefined);
                      return;
                    }
                    const parsed = Number(raw);
                    setThreshold(Number.isFinite(parsed) ? parsed : undefined);
                  }}
                  aria-label="Threshold value"
                />
              </IonItem>
            </IonCol>
          </IonRow>

          {!!error && (
            <IonRow>
              <IonCol size="12">
                <IonNote color="danger" role="alert">
                  {error}
                </IonNote>
              </IonCol>
            </IonRow>
          )}

          <IonRow className="comments-form-actions">
            <IonCol size="12">
              <IonButtons>
                {onCancel && (
                  <IonButton fill="outline" onClick={onCancel} disabled={loading || submitting}>
                    Cancel
                  </IonButton>
                )}
                <IonButton
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  color="primary"
                  aria-label="Submit comment"
                >
                  {loading || submitting ? <IonSpinner name="dots" /> : 'Submit Comment'}
                </IonButton>
              </IonButtons>
            </IonCol>
          </IonRow>
        </IonGrid>
      </IonCardContent>
    </IonCard>
  );
};

export default CommentForm;
