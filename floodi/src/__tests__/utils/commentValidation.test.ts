import { describe, it, expect } from 'vitest';
import {
  sanitizeCommentContent,
  validateCommentContent,
  validateTimeRange,
  validateStationId,
  validateCommentMetadata,
  isValidEditReason,
  validateCommentPermissions,
} from 'src/utils/commentValidation';
import { UserRole } from 'src/types/user';

describe('commentValidation', () => {
  it('sanitizes dangerous HTML', () => {
    const raw = '<p>Hello<script>alert(1)</script><img src=x onerror=1> <a href="javascript:evil()">x</a></p>';
    const safe = sanitizeCommentContent(raw);
    expect(safe).not.toMatch(/script/);
    expect(safe).not.toMatch(/onerror/);
    expect(safe).toMatch(/<p>/);
    expect(safe).toMatch(/<a/);
  });

  it('validates content length', () => {
    expect(validateCommentContent('').ok).toBe(false);
    const long = 'a'.repeat(2001);
    expect(validateCommentContent(long).ok).toBe(false);
    expect(validateCommentContent('ok').ok).toBe(true);
  });

  it('validates time ranges', () => {
    const now = Date.now();
    const start = new Date(now - 1000).toISOString();
    const end = new Date(now + 1000).toISOString();
    expect(validateTimeRange({ startTime: start, endTime: end }).ok).toBe(true);
    expect(validateTimeRange({ startTime: end, endTime: start }).ok).toBe(false);
  });

  it('validates station ids', () => {
    expect(validateStationId('8720218')).toBe(true);
    expect(validateStationId('abc')).toBe(false);
  });

  it('validates metadata', () => {
    const meta = {
      station: { id: '8720218', name: 'Key West' },
      timeRange: { startTime: new Date(Date.now() - 1000).toISOString(), endTime: new Date(Date.now() + 1000).toISOString() },
      dataContext: ['observed', 'predicted'] as const,
    };
    expect(validateCommentMetadata(meta).ok).toBe(true);
  });

  it('checks edit reason', () => {
    expect(isValidEditReason(undefined)).toBe(true);
    expect(isValidEditReason('Fix')).toBe(true);
    expect(isValidEditReason('').toString()).toBe('false');
  });

  it('evaluates permissions', () => {
    // create
    expect(validateCommentPermissions({ action: 'create', role: UserRole.User, currentUserUid: 'u1' })).toBe(true);
    // edit own
    expect(validateCommentPermissions({ action: 'edit', role: UserRole.User, currentUserUid: 'u1', comment: { authorUid: 'u1', isDeleted: false } })).toBe(true);
    // edit others denied for user
    expect(validateCommentPermissions({ action: 'edit', role: UserRole.User, currentUserUid: 'u1', comment: { authorUid: 'u2', isDeleted: false } })).toBe(false);
    // moderator can edit others
    expect(validateCommentPermissions({ action: 'edit', role: UserRole.Moderator, currentUserUid: 'u1', comment: { authorUid: 'u2', isDeleted: false } })).toBe(true);
  });
});

