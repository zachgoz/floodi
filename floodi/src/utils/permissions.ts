import { UserRole, type RolePermissions, type UserPermissions, type PermissionKey } from 'src/types/user';

/**
 * Role-based permission matrix.
 * - anonymous: read-only
 * - user: create and manage own comments
 * - moderator: moderate any comments
 * - admin: full access
 */
export const ROLE_PERMISSIONS: RolePermissions = {
  [UserRole.Anonymous]: {
    canCreateComments: false,
    canEditOwnComments: false,
    canDeleteOwnComments: false,
    canEditAnyComments: false,
    canDeleteAnyComments: false,
    canManageUsers: false,
    canViewAnalytics: false,
  },
  [UserRole.User]: {
    canCreateComments: true,
    canEditOwnComments: true,
    canDeleteOwnComments: true,
    canEditAnyComments: false,
    canDeleteAnyComments: false,
    canManageUsers: false,
    canViewAnalytics: false,
  },
  [UserRole.Moderator]: {
    canCreateComments: true,
    canEditOwnComments: true,
    canDeleteOwnComments: true,
    canEditAnyComments: true,
    canDeleteAnyComments: true,
    canManageUsers: false,
    canViewAnalytics: true,
  },
  [UserRole.Admin]: {
    canCreateComments: true,
    canEditOwnComments: true,
    canDeleteOwnComments: true,
    canEditAnyComments: true,
    canDeleteAnyComments: true,
    canManageUsers: true,
    canViewAnalytics: true,
  },
};

/** Return the permission set for a given role. */
export const getRolePermissions = (role: UserRole): UserPermissions => ROLE_PERMISSIONS[role];

/** True if the role grants the specific permission key. */
export const hasPermission = (userRole: UserRole, permission: PermissionKey): boolean =>
  !!ROLE_PERMISSIONS[userRole]?.[permission];

/** Map a business action to a permission key. */
export type Action =
  | 'create-comment'
  | 'edit-comment-own'
  | 'delete-comment-own'
  | 'edit-comment-any'
  | 'delete-comment-any'
  | 'manage-users'
  | 'view-analytics';

/** Resolve whether a role can perform a given action. */
export const canUserPerformAction = (userRole: UserRole, action: Action): boolean => {
  switch (action) {
    case 'create-comment':
      return hasPermission(userRole, 'canCreateComments');
    case 'edit-comment-own':
      return hasPermission(userRole, 'canEditOwnComments');
    case 'delete-comment-own':
      return hasPermission(userRole, 'canDeleteOwnComments');
    case 'edit-comment-any':
      return hasPermission(userRole, 'canEditAnyComments');
    case 'delete-comment-any':
      return hasPermission(userRole, 'canDeleteAnyComments');
    case 'manage-users':
      return hasPermission(userRole, 'canManageUsers');
    case 'view-analytics':
      return hasPermission(userRole, 'canViewAnalytics');
    default:
      return false;
  }
};

/** Role hierarchy for comparisons. Higher index means higher privilege. */
const ROLE_ORDER: UserRole[] = [
  UserRole.Anonymous,
  UserRole.User,
  UserRole.Moderator,
  UserRole.Admin,
];

export const isRoleHigherThan = (role1: UserRole, role2: UserRole): boolean =>
  ROLE_ORDER.indexOf(role1) > ROLE_ORDER.indexOf(role2);

/** Default role assignment helper for current auth state. */
export const getDefaultRoleForUser = (isAnonymous: boolean): UserRole =>
  isAnonymous ? UserRole.Anonymous : UserRole.User;

/** Action-specific helpers */
export const canCreateComments = (role: UserRole): boolean => hasPermission(role, 'canCreateComments');

export const canEditComment = (
  userRole: UserRole,
  commentAuthorUid: string,
  currentUserUid: string
): boolean => {
  if (commentAuthorUid === currentUserUid) return hasPermission(userRole, 'canEditOwnComments');
  return hasPermission(userRole, 'canEditAnyComments');
};

export const canDeleteComment = (
  userRole: UserRole,
  commentAuthorUid: string,
  currentUserUid: string
): boolean => {
  if (commentAuthorUid === currentUserUid) return hasPermission(userRole, 'canDeleteOwnComments');
  return hasPermission(userRole, 'canDeleteAnyComments');
};

export const canManageUsers = (role: UserRole): boolean => hasPermission(role, 'canManageUsers');

