import { hasIdleTimeoutElapsed, isValidIdleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS } from './idleTimer';

describe('hasIdleTimeoutElapsed', () => {
  it('is false before the timeout has elapsed', () => {
    expect(
      hasIdleTimeoutElapsed(1000, 1000 + DEFAULT_IDLE_TIMEOUT_MS - 1, DEFAULT_IDLE_TIMEOUT_MS),
    ).toBe(false);
  });

  it('is true exactly at the timeout boundary', () => {
    expect(
      hasIdleTimeoutElapsed(1000, 1000 + DEFAULT_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS),
    ).toBe(true);
  });

  it('is true well past the timeout', () => {
    expect(hasIdleTimeoutElapsed(0, DEFAULT_IDLE_TIMEOUT_MS * 10, DEFAULT_IDLE_TIMEOUT_MS)).toBe(
      true,
    );
  });

  it('treats a zero or negative timeout as "always elapsed" rather than dividing by zero or similar', () => {
    expect(hasIdleTimeoutElapsed(1000, 1000, 0)).toBe(true);
    expect(hasIdleTimeoutElapsed(1000, 1000, -5)).toBe(true);
  });
});

describe('isValidIdleTimeoutMs', () => {
  it('accepts positive finite numbers', () => {
    expect(isValidIdleTimeoutMs(1)).toBe(true);
    expect(isValidIdleTimeoutMs(DEFAULT_IDLE_TIMEOUT_MS)).toBe(true);
  });

  it('rejects zero, negative, NaN, and Infinity', () => {
    expect(isValidIdleTimeoutMs(0)).toBe(false);
    expect(isValidIdleTimeoutMs(-1)).toBe(false);
    expect(isValidIdleTimeoutMs(NaN)).toBe(false);
    expect(isValidIdleTimeoutMs(Infinity)).toBe(false);
  });
});
