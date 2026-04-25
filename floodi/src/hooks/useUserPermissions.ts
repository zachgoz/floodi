import { useMemo, useState } from 'react';
import { useAuth } from 'src/contexts/AuthContext';
import {
  canCreateComments as canCreate,
  canDeleteComment as canDelete,
  canEditComment as canEdit,
  canManageUsers as canManage,
  getRolePermissions,
} from 'src/utils/permissions';
import { UserRole, type UserPermissions } from 'src/types/user';

/**
 * Hook to expose current user's role and convenience permission checks.
 * Includes simple loading state while AuthContext is resolving profile.
 */
export const useUserPermissions = () => {
  const { user, userProfile, userPermissions } = useAuth();
  const [error] = useState<string | null>(null);

  const role = userProfile?.role ?? (user?.isAnonymous ? UserRole.Anonymous : UserRole.User);

  const perms: UserPermissions = useMemo(() => {
    return userPermissions ?? getRolePermissions(role);
  }, [userPermissions, role]);

  const loading = !user || (!userProfile && !user?.isAnonymous);

  const value = useMemo(
    () => ({
      role,
      permissions: perms,
      loading,
      error,
      hasPermission: (key: keyof UserPermissions) => !!perms[key],
      canCreateComments: () => canCreate(role),
      canEditComment: (commentAuthorUid: string) => (user?.uid ? canEdit(role, commentAuthorUid, user.uid) : false),
      canDeleteComment: (commentAuthorUid: string) => (user?.uid ? canDelete(role, commentAuthorUid, user.uid) : false),
      canManageUsers: () => canManage(role),
      isAdmin: () => role === UserRole.Admin,
      isModerator: () => role === UserRole.Moderator,
      isAnonymous: () => role === UserRole.Anonymous,
    }),
    [perms, role, loading, error, user?.uid]
  );

  return value;
};

export type UseUserPermissionsReturn = ReturnType<typeof useUserPermissions>;

