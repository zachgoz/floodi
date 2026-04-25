import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUserPermissions } from 'src/hooks/useUserPermissions';
import { UserRole } from 'src/types/user';

vi.mock('src/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));
import { useAuth } from 'src/contexts/AuthContext';

const mockUseAuth = (role: UserRole | 'anonymous' | 'none') => {
  const user = role === 'none' ? null : ({ uid: 'u1', isAnonymous: role === 'anonymous' } as unknown as import('firebase/auth').User);
  const userProfile = role === 'none' || role === 'anonymous' ? null : ({ role } as any);
  const userPermissions = null; // allow hook to derive from role
  vi.mocked(useAuth).mockReturnValue({ user, userProfile, userPermissions } as any);
};

describe('useUserPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns anonymous permissions when user is anonymous', () => {
    mockUseAuth('anonymous');
    const { result } = renderHook(() => useUserPermissions());
    expect(result.current.isAnonymous()).toBe(true);
    expect(result.current.canCreateComments()).toBe(false);
  });

  it('returns user permissions for registered user', () => {
    mockUseAuth(UserRole.User);
    const { result } = renderHook(() => useUserPermissions());
    expect(result.current.isAdmin()).toBe(false);
    expect(result.current.canCreateComments()).toBe(true);
  });

  it('returns moderator/admin distinctions', () => {
    mockUseAuth(UserRole.Moderator);
    const { result: mod } = renderHook(() => useUserPermissions());
    expect(mod.current.isModerator()).toBe(true);
    expect(mod.current.canManageUsers()).toBe(false);

    mockUseAuth(UserRole.Admin);
    const { result: admin } = renderHook(() => useUserPermissions());
    expect(admin.current.isAdmin()).toBe(true);
    expect(admin.current.canManageUsers()).toBe(true);
  });

  it('exposes edit/delete checks based on author', () => {
    mockUseAuth(UserRole.User);
    const { result } = renderHook(() => useUserPermissions());
    expect(result.current.canEditComment('u1')).toBe(true);
    expect(result.current.canDeleteComment('other')).toBe(false);
  });
});
