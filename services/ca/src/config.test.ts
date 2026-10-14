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

  it('rejects a hex-looking PORT instead of silently binding the wrong port', () => {
    process.env.PORT = '0x10';
    expect(() => config.port).toThrow();
  });

  it('rejects an exponential-notation PORT', () => {
    process.env.PORT = '1e2';
    expect(() => config.port).toThrow();
  });

  it('rejects a negative PORT', () => {
    process.env.PORT = '-1';
    expect(() => config.port).toThrow();
  });

  it('rejects a PORT of 0', () => {
    process.env.PORT = '0';
    expect(() => config.port).toThrow();
  });

  it('rejects a PORT above 65535', () => {
    process.env.PORT = '65536';
    expect(() => config.port).toThrow();
  });

  it('accepts the boundary values 1 and 65535', () => {
    process.env.PORT = '1';
    expect(config.port).toBe(1);
    process.env.PORT = '65535';
    expect(config.port).toBe(65535);
  });
});
