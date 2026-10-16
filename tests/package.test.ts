import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import packageJson from '../package.json' assert { type: 'json' };

describe('Package constraints', () => {
  it('should have zero runtime dependencies', () => {
    expect(packageJson.dependencies || {}).toEqual({});
  });

  it('should have version 2.0.1', () => {
    expect(packageJson.version).toBe('2.0.1');
  });

  it('should configure dual ESM and CommonJS exports with TypeScript types', () => {
    expect(packageJson.main).toBe('./dist/index.cjs');
    expect(packageJson.module).toBe('./dist/index.mjs');
    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(packageJson.exports).toBeDefined();
    expect(packageJson.exports['.']).toEqual({
      import: {
        types: './dist/index.d.ts',
        default: './dist/index.mjs',
      },
      require: {
        types: './dist/index.d.cts',
        default: './dist/index.cjs',
      },
    });
  });

  it('should include dist directory in package files', () => {
    expect(packageJson.files).toContain('dist');
  });

  it('should have built bundle artifacts available in dist', () => {
    expect(existsSync(resolve(__dirname, '../dist/index.mjs'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../dist/index.cjs'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../dist/index.d.ts'))).toBe(true);
    expect(existsSync(resolve(__dirname, '../dist/index.d.cts'))).toBe(true);
  });
});
