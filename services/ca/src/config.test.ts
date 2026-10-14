import { describe, it, expect, afterEach } from 'vitest';
import { config } from './config.js';

afterEach(() => {
  delete process.env.PORT;
});

describe('config.port', () => {
  it('defaults to 4433 when PORT is unset', () => {
    delete process.env.PORT;
    expect(config.port).toBe(4433);
  });

  it('defaults to 4433 when PORT is an empty string, instead of binding an ephemeral port', () => {
    process.env.PORT = '';
    expect(config.port).toBe(4433);
  });

  it('uses PORT when it is a valid integer', () => {
    process.env.PORT = '9000';
    expect(config.port).toBe(9000);
  });

  it('throws on a non-numeric PORT instead of silently falling back', () => {
    process.env.PORT = 'not-a-number';
    expect(() => config.port).toThrow();
  });
});
