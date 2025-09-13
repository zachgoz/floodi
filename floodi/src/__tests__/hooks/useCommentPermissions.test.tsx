/**
 * useCommentPermissions tests
 */
import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useCommentPermissions } from 'src/hooks/useComments';
import { UserRole } from 'src/types/user';
import { useAuth } from 'src/contexts/AuthContext';
import { useUserPermissions } from 'src/hooks/useUserPermissions';

vi.mock('src/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'u@e.com' },
    isAnonymous: false,
  }),
}));

vi.mock('src/hooks/useUserPermissions', () => ({
  useUserPermissions: () => ({
    role: UserRole.User,
    permissions: {
      canCreateComments: true,
      canEditOwnComments: true,
      canDeleteOwnComments: true,
      canEditAnyComments: false,
      canDeleteAnyComments: false,
      canManageUsers: false,
      canViewAnalytics: false,
    },
    loading: false,
    error: null,
    hasPermission: vi.fn(),
    canCreateComments: () => true,
    canEditComment: () => true,
    canDeleteComment: () => true,
    canManageUsers: () => false,
    isAdmin: () => false,
    isModerator: () => false,
    isAnonymous: () => false,
  }),
}));

describe('useCommentPermissions', () => {
  it('returns permission functions for authenticated user', () => {
    const { result } = renderHook(() => useCommentPermissions());

    expect(typeof result.current.canCreate).toBe('function');
    expect(typeof result.current.canEdit).toBe('function');
    expect(typeof result.current.canDelete).toBe('function');

    expect(result.current.canCreate()).toBe(true);
  });

  it('handles admin role correctly', () => {
    vi.mocked(useUserPermissions).mockReturnValue({
      role: UserRole.Admin,
      permissions: {
        canCreateComments: true,
        canEditOwnComments: true,
        canDeleteOwnComments: true,
        canEditAnyComments: true,
        canDeleteAnyComments: true,
        canManageUsers: true,
        canViewAnalytics: true,
      },
      loading: false,
      error: null,
      hasPermission: vi.fn(),
      canCreateComments: () => true,
      canEditComment: () => true,
      canDeleteComment: () => true,
      canManageUsers: () => true,
      isAdmin: () => true,
      isModerator: () => false,
      isAnonymous: () => false,
    });

    const { result } = renderHook(() => useCommentPermissions());

    expect(result.current.canCreate()).toBe(true);
  });

  it('handles anonymous user correctly', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAnonymous: true,
    });

    vi.mocked(useUserPermissions).mockReturnValue({
      role: UserRole.Anonymous,
      permissions: {
        canCreateComments: false,
        canEditOwnComments: false,
        canDeleteOwnComments: false,
        canEditAnyComments: false,
        canDeleteAnyComments: false,
        canManageUsers: false,
        canViewAnalytics: false,
      },
      loading: false,
      error: null,
      hasPermission: vi.fn(),
      canCreateComments: () => false,
      canEditComment: () => false,
      canDeleteComment: () => false,
      canManageUsers: () => false,
      isAdmin: () => false,
      isModerator: () => false,
      isAnonymous: () => true,
    });

    const { result } = renderHook(() => useCommentPermissions());

    expect(result.current.canCreate()).toBe(false);
  });
});