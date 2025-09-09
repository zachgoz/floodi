import React, { useMemo, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonModal,
  IonTextarea,
  IonTitle,
  IonToolbar,
  IonNote,
  IonSpinner,
  IonCheckbox,
  IonSelect,
  IonSelectOption,
} from '@ionic/react';
import { TimeRangePicker, TimeRange } from 'src/components/comments/TimeRangePicker';
import * as commentValidation from 'src/utils/commentValidation';
import 'src/components/comments/styles/Comments.css';

export interface CommentEditModalProps {
  isOpen: boolean;
  comment: any; // Using any to avoid tight coupling to app types
  onDismiss: () => void;
  onSave: (updated: { content: string; range?: TimeRange; reason?: string; eventType?: any; dataContext?: { observed?: boolean; predicted?: boolean; adjusted?: boolean } }) => Promise<void> | void;
  canEditMetadata?: boolean;
}

/**
 * CommentEditModal
 *
 * Modal for editing comment content and optionally metadata for privileged users.
 */
export const CommentEditModal: React.FC<CommentEditModalProps> = ({
  isOpen,
  comment,
  onDismiss,
  onSave,
  canEditMetadata = false,
}) => {
  const [content, setContent] = useState<string>(comment?.content ?? '');
  const [range, setRange] = useState<TimeRange | undefined>(comment?.meta?.range);
  const [reason, setReason] = useState<string>('');
  const [eventType, setEventType] = useState<any>(comment?.meta?.eventType ?? 'normal-tide');
  const [dataContext, setDataContext] = useState<{ observed?: boolean; predicted?: boolean; adjusted?: boolean }>(
    comment?.meta?.dataContext ?? { observed: true }
  );
  const [error, setError] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  const characterCount = content.length;
  const characterLimit = 2000;

  const canSave = useMemo(() => {
    if (saving) return false;
    if (characterCount === 0 || characterCount > characterLimit) return false;
    return true;
  }, [saving, characterCount]);

  const validate = () => {
    try {
      if (commentValidation?.validateCommentContent) {
        const res = (commentValidation as any).validateCommentContent(content);
        if (res && typeof res === 'object' && res.valid === false) return res.message ?? 'Invalid content.';
      }
    } catch {}
    if (characterCount === 0) return 'Please enter content.';
    if (characterCount > characterLimit) return 'Content is too long (max 2000 characters).';
    return '';
  };

  const handleSave = async () => {
    const msg = validate();
    setError(msg);
    if (msg) return;
    setSaving(true);
    try {
      await onSave({ content, range, reason: reason || undefined, eventType, dataContext });
      onDismiss();
    } catch (e: any) {
      setError(e?.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDismiss} aria-label="Edit Comment">
      <IonHeader>
        <IonToolbar>
          <IonTitle>Edit Comment</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onDismiss}>Close</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonItem>
          <IonLabel position="stacked">Content</IonLabel>
          <IonTextarea
            value={content}
            onIonInput={(e) => setContent((e.detail.value as string) ?? '')}
            autoGrow
            aria-label="Comment content"
          />
          <IonNote slot="helper">{characterCount}/{characterLimit}</IonNote>
        </IonItem>

        {canEditMetadata ? (
          <TimeRangePicker
            initialRange={comment?.meta?.range}
            chartDomain={undefined}
            onChange={({ range: r }) => setRange(r)}
          />
        ) : (
          comment?.meta?.range && (
            <IonItem>
              <IonLabel>Time Range</IonLabel>
              <IonNote slot="end">
                {new Date(comment.meta.range.start).toLocaleString()} – {new Date(comment.meta.range.end).toLocaleString()}
              </IonNote>
            </IonItem>
          )
        )}

        <IonItem>
          <IonLabel position="stacked">Edit Reason (optional)</IonLabel>
          <IonInput
            value={reason}
            onIonInput={(e) => setReason((e.detail.value as string) ?? '')}
            placeholder="Why are you editing?"
            aria-label="Edit reason"
          />
        </IonItem>

        {canEditMetadata && (
          <>
            <IonItem>
              <IonLabel position="stacked">Event Type</IonLabel>
              <IonSelect value={eventType} onIonChange={(e) => setEventType(e.detail.value)} aria-label="Event type">
                <IonSelectOption value="threshold-crossing">Threshold crossing</IonSelectOption>
                <IonSelectOption value="surge-event">Surge event</IonSelectOption>
                <IonSelectOption value="normal-tide">Normal tide</IonSelectOption>
              </IonSelect>
            </IonItem>

            <IonItem lines="none">
              <IonLabel>Observed</IonLabel>
              <IonCheckbox
                checked={!!dataContext.observed}
                onIonChange={(e) => setDataContext((d) => ({ ...d, observed: !!e.detail.checked }))}
                aria-label="Observed data context"
              />
            </IonItem>
            <IonItem lines="none">
              <IonLabel>Predicted</IonLabel>
              <IonCheckbox
                checked={!!dataContext.predicted}
                onIonChange={(e) => setDataContext((d) => ({ ...d, predicted: !!e.detail.checked }))}
                aria-label="Predicted data context"
              />
            </IonItem>
            <IonItem lines="none">
              <IonLabel>Adjusted</IonLabel>
              <IonCheckbox
                checked={!!dataContext.adjusted}
                onIonChange={(e) => setDataContext((d) => ({ ...d, adjusted: !!e.detail.checked }))}
                aria-label="Adjusted data context"
              />
            </IonItem>
          </>
        )}

        {!!error && (
          <IonNote color="danger" role="alert">
            {error}
          </IonNote>
        )}
      </IonContent>
      <IonFooter>
        <IonToolbar>
          <IonButtons slot="end">
            <IonButton onClick={onDismiss} disabled={saving} fill="outline">
              Cancel
            </IonButton>
            <IonButton onClick={handleSave} disabled={!canSave} color="primary">
              {saving ? <IonSpinner name="dots" /> : 'Save Changes'}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonFooter>
    </IonModal>
  );
};

export default CommentEditModal;
