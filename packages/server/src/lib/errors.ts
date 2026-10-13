/**
 * Generic auth failure, per docs/API_SPEC.md "Error handling conventions" —
 * identical shape whether username is missing, wrong, or hash mismatches.
 * Never leak which field failed.
 */
export const GENERIC_AUTH_ERROR = { error: 'invalid credentials' } as const;

export const GENERIC_SESSION_ERROR = { error: 'unauthorized' } as const;
