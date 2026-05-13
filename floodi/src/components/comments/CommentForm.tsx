import React, { useCallback, useMemo, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonCol,
  IonGrid,
  IonItem,
  IonLabel,
  IonNote,
  IonRow,
  IonSpinner,
  IonTextarea,
} from '@ionic/react';
import type { TimeRange, CommentEventType } from 'src/components/comments/TimeRangePicker';
import { useAuth } from 'src/contexts/AuthContext';
import { useCommentPermissions } from 'src/hooks/useComments';
import * as commentValidation from 'src/utils/commentValidation';
import 'src/components/comments/styles/Comments.css';

export interface CommentFormValues {
  content: string;
  range?: TimeRange;
  eventType?: CommentEventType;
  dataContexts: Array<'observed' | 'predicted' | 'adjusted'>;
  threshold?: number;
}

export interface CommentFormProps {
  locationId?: string;
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
  initialContent = '',
  initialRange,
  loading = false,
  onSubmit,
  onCancel,
}) => {
  const { user, isAnonymous, userProfile } = useAuth?.() ?? { user: undefined, isAnonymous: true, userProfile: null };
  const perms = useCommentPermissions();

  const [content, setContent] = useState<string>(initialContent);
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const characterCount = content.length;
  const characterLimit = 2000;

  const canSubmit = useMemo(() => {
    if (loading || submitting) return false;
    if (!perms?.canCreate()) return false;
    if (!initialRange) return false;
    if (characterCount === 0 || characterCount > characterLimit) return false;
    return true;
  }, [loading, submitting, perms?.canCreate, initialRange, characterCount]);

  const validate = useCallback(() => {
    try {
      if (commentValidation.validateCommentContent) {
        const res = commentValidation.validateCommentContent(content);
        if (res && typeof res === 'object' && !res.ok) return res.errors?.join(', ') ?? 'Invalid content.';
      }
    } catch { /* ignore */ }
    if (characterCount === 0) return 'Please enter a comment.';
    if (characterCount > characterLimit) return 'Comment is too long (max 2000 characters).';
    if (!initialRange) return 'A specific point on the chart must be selected.';
    return '';
  }, [content, characterCount, characterLimit, initialRange]);

  const handleSubmit = async () => {
    const msg = validate();
    setError(msg);
    if (msg) return;
    setSubmitting(true);
    try {
      // Data context defaults, since we removed the manual choices
      await onSubmit({ 
        content, 
        range: initialRange, 
        eventType: 'normal-tide', 
        dataContexts: ['observed'], 
        threshold: undefined 
      });
      setContent('');
    } catch (e: any) {
      setError(e?.message || 'Failed to submit comment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="premium-form-container" aria-label="Create comment form">
        {!perms?.canCreate() && (
          <IonNote color="warning">
            {!user || isAnonymous
              ? "Please sign in to drop a pin."
              : userProfile
                ? `Your account role (${userProfile.role}) does not allow dropping pins. Contact an administrator if you believe this is an error.`
                : "Loading user permissions... If this persists, please refresh the page."
            }
          </IonNote>
        )}
        {(!user || isAnonymous) && (
          <IonNote color="medium" className="comments-upgrade-note" style={{display: 'block', marginTop: '8px', marginBottom: '8px'}}>
            Create an account to drop pins natively onto the chart!
          </IonNote>
        )}

        <div className="input-group">
          <IonLabel position="stacked" className="premium-label">Add a note or observation...</IonLabel>
          <IonTextarea
            className="premium-textarea"
            value={content}
            onIonInput={(e) => setContent((e.detail.value as string) ?? '')}
            autoGrow
            aria-label="Comment content"
            placeholder="E.g. The water is cresting over the sidewalk here."
            rows={4}
          />
          <div className="char-count">
            <IonNote>{characterCount}/{characterLimit}</IonNote>
          </div>
        </div>

        {!!error && (
          <div className="error-alert" role="alert">
            <IonNote color="danger">{error}</IonNote>
          </div>
        )}

        <div className="form-actions">
          {onCancel && (
            <IonButton className="ghost-btn" fill="clear" onClick={onCancel} disabled={loading || submitting}>
              Cancel
            </IonButton>
          )}
          <IonButton
            className="gradient-btn"
            onClick={handleSubmit}
            disabled={!canSubmit}
            fill="solid"
            aria-label="Submit comment"
          >
            {loading || submitting ? <IonSpinner name="dots" /> : 'Drop Pin'}
          </IonButton>
        </div>
    </div>
  );
};

export default CommentForm;
