import { generateUuid } from './uuid';

describe('generateUuid', () => {
  it('matches the RFC 4122 v4 UUID format', () => {
    const uuid = generateUuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('generates distinct values across calls', () => {
    const uuids = new Set(Array.from({ length: 100 }, () => generateUuid()));
    expect(uuids.size).toBe(100);
  });
});
