// Maps database / network errors to translation keys. Messages raised by our SQL functions are short
// machine codes (e.g. "not_a_member"); unknown errors fall back to a generic message.
const KNOWN = new Set([
  'not_authenticated', 'not_a_member', 'admin_required', 'last_admin', 'invalid_timezone', 'duplicate_item',
  'assignee_not_active_member', 'already_paid', 'invitation_invalid', 'invitation_revoked', 'invitation_expired',
  'invitation_used', 'invitation_email_mismatch', 'use_leave_household', 'too_many_households', 'task_archived',
  'not_found', 'cross_list_merge', 'attachment_entity_mismatch', 'invalid_target', 'file_type', 'file_size',
]);

export interface AppErrorInfo {
  key: string;
  values?: Record<string, string>;
}

export function errorKey(err: unknown): AppErrorInfo {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { key: 'errors.offline' };
  const e = err as { message?: string; code?: string; status?: number; name?: string } | null;
  const msg = e?.message ?? '';
  if (KNOWN.has(msg)) return { key: `errors.${msg}` };
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) return { key: 'errors.network' };
  if (/Invalid login credentials/i.test(msg)) return { key: 'errors.invalid_credentials' };
  if (/already registered|already been registered/i.test(msg)) return { key: 'errors.email_taken' };
  if (/Email not confirmed/i.test(msg)) return { key: 'errors.email_not_confirmed' };
  if (/Password should be/i.test(msg)) return { key: 'errors.weak_password' };
  if (/rate limit/i.test(msg)) return { key: 'errors.rate_limited' };
  if (/JWT expired|session/i.test(msg) && e?.status === 401) return { key: 'errors.session_expired' };
  switch (e?.code) {
    case '23505': return { key: 'errors.duplicate' };
    case '23503': return { key: 'errors.reference' };
    case '23514': return { key: 'errors.invalid_value' };
    case '22P02':
    case '22007':
    case '22008': return { key: 'errors.invalid_value' };
    case '42501': return { key: 'errors.forbidden' };
    case 'PGRST116': return { key: 'errors.not_found' };
  }
  return { key: 'errors.generic' };
}
