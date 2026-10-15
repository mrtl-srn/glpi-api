// tests/smoke.test.ts
import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('Smoke test', () => {
  it('should export version 2.0.0', () => {
    expect(VERSION).toBe('2.0.0');
  });
});
