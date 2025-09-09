import { describe, it, expect } from 'vitest';
import {
  ROLE_PERMISSIONS,
  getRolePermissions,
  hasPermission,
  canUserPerformAction,
  isRoleHigherThan,
  canCreateComments,
  canEditComment,
  canDeleteComment,
  canManageUsers,
  getDefaultRoleForUser,
} from 'src/utils/permissions';
import { UserRole } from 'src/types/user';

describe('permissions utils', () => {
  it('exposes role permissions for each role', () => {
    expect(ROLE_PERMISSIONS[UserRole.Anonymous].canCreateComments).toBe(false);
    expect(ROLE_PERMISSIONS[UserRole.User].canCreateComments).toBe(true);
    expect(ROLE_PERMISSIONS[UserRole.Moderator].canEditAnyComments).toBe(true);
    expect(ROLE_PERMISSIONS[UserRole.Admin].canManageUsers).toBe(true);
  });

  it('getRolePermissions returns correct structure', () => {
    const perms = getRolePermissions(UserRole.User);
    expect(perms.canDeleteAnyComments).toBe(false);
  });

  it('hasPermission works for specific keys', () => {
    expect(hasPermission(UserRole.Admin, 'canManageUsers')).toBe(true);
    expect(hasPermission(UserRole.User, 'canManageUsers')).toBe(false);
  });

  it('canUserPerformAction maps actions properly', () => {
    expect(canUserPerformAction(UserRole.User, 'create-comment')).toBe(true);
    expect(canUserPerformAction(UserRole.User, 'delete-comment-any')).toBe(false);
    expect(canUserPerformAction(UserRole.Admin, 'manage-users')).toBe(true);
  });

  it('role hierarchy compares correctly', () => {
    expect(isRoleHigherThan(UserRole.Moderator, UserRole.User)).toBe(true);
    expect(isRoleHigherThan(UserRole.User, UserRole.Admin)).toBe(false);
  });

  it('action helpers consider own vs any', () => {
    const author = 'a';
    const current = 'a';
    expect(canEditComment(UserRole.User, author, current)).toBe(true);
    expect(canDeleteComment(UserRole.User, author, current)).toBe(true);
    expect(canEditComment(UserRole.User, 'other', current)).toBe(false);
    expect(canDeleteComment(UserRole.Moderator, 'other', current)).toBe(true);
  });

  it('default role assignment handles anonymous', () => {
    expect(getDefaultRoleForUser(true)).toBe(UserRole.Anonymous);
    expect(getDefaultRoleForUser(false)).toBe(UserRole.User);
  });

  it('canCreateComments and canManageUsers reflect role differences', () => {
    expect(canCreateComments(UserRole.Anonymous)).toBe(false);
    expect(canCreateComments(UserRole.User)).toBe(true);
    expect(canManageUsers(UserRole.Admin)).toBe(true);
    expect(canManageUsers(UserRole.Moderator)).toBe(false);
  });
});

