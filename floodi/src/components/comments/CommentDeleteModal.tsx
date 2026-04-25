import React, { useMemo, useState } from 'react';
import { IonAlert } from '@ionic/react';
import { useUserPermissions } from 'src/hooks/useUserPermissions';

export interface CommentDeleteModalProps {
  isOpen: boolean;
  comment: any;
  onDismiss: () => void;
  onConfirm: (opts: { permanent?: boolean; reason?: string }) => Promise<void> | void;
}

/**
 * CommentDeleteModal
 *
 * Confirmation dialog for deleting comments with role-based messaging
 * and options (e.g., permanent delete for admins).
 */
export const CommentDeleteModal: React.FC<CommentDeleteModalProps> = ({
  isOpen,
  comment,
  onDismiss,
  onConfirm,
}) => {
  const perms = useUserPermissions?.() ?? { role: 'user' };

  const header = useMemo(() => {
    if (perms.role === 'admin') return 'Delete this comment? (admin)';
    if (perms.role === 'moderator') return 'Delete this comment? (moderator action)';
    return 'Delete your comment?';
  }, [perms.role]);

  return (
    <IonAlert
      isOpen={isOpen}
      header={header}
      message={
        comment?.content
          ? `Are you sure you want to delete this comment: “${stripHtml(comment.content).slice(0, 120)}”`
          : 'Are you sure you want to delete this comment?'
      }
      inputs={[
        ...(perms.role !== 'user'
          ? [{ name: 'reason', type: 'text', placeholder: 'Reason (optional)' } as const]
          : []),
        ...(perms.role === 'admin'
          ? [{ name: 'permanent', type: 'checkbox', label: 'Delete permanently', checked: false } as const]
          : []),
      ]}
      buttons={[
        {
          text: 'Cancel',
          role: 'cancel',
          handler: () => onDismiss(),
        },
        {
          text: 'Delete Comment',
          role: 'destructive',
          handler: async (data: any) => {
            await onConfirm({ permanent: !!data?.permanent, reason: data?.reason });
          },
        },
      ]}
      onDidDismiss={onDismiss}
    />
  );
};

function stripHtml(html: string): string {
  if (!html) return '';
  const tmp = globalThis?.document?.createElement?.('DIV');
  if (!tmp) return html;
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

export default CommentDeleteModal;
