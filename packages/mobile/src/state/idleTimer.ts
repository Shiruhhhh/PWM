/**
 * Pure idle-timeout logic per SCREENS_UX.md "App lifecycle" #3/#4 and
 * decision #6 (configurable auto-relock after inactivity). Separated from
 * any actual timer/AppState wiring so it's unit-testable without faking
 * React Native's AppState or real timers beyond simple Date math.
 */

export const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 min, per decision #6

/** Returns true once `now` is at least `timeoutMs` past `backgroundedAt`. */
export function hasIdleTimeoutElapsed(
  backgroundedAt: number,
  now: number,
  timeoutMs: number,
): boolean {
  if (timeoutMs <= 0) {
    return true;
  }
  return now - backgroundedAt >= timeoutMs;
}

/** Validates a user-configured idle timeout value (settingsStore input). */
export function isValidIdleTimeoutMs(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
