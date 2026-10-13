import { describe, it, expect } from 'vitest';
import {
  GlpiError,
  GlpiHttpError,
  GlpiAuthenticationError,
  GlpiNotFoundError,
  GlpiValidationError,
  GlpiRateLimitError,
} from '../src/errors/index.js';

describe('Error Hierarchy', () => {
  it('GlpiError should be base error', () => {
    const err = new GlpiError('Base error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GlpiError);
    expect(err.name).toBe('GlpiError');
    expect(err.message).toBe('Base error');
  });

  it('GlpiHttpError should contain status, statusText, url, body', () => {
    const err = new GlpiHttpError(500, 'Internal Server Error', 'https://glpi.test/api', { message: 'DB down' });
    expect(err).toBeInstanceOf(GlpiError);
    expect(err.status).toBe(500);
    expect(err.statusText).toBe('Internal Server Error');
    expect(err.url).toBe('https://glpi.test/api');
    expect(err.body).toEqual({ message: 'DB down' });
  });

  it('GlpiNotFoundError should inherit from GlpiHttpError with status 404', () => {
    const err = new GlpiNotFoundError('https://glpi.test/api/Ticket/999');
    expect(err).toBeInstanceOf(GlpiHttpError);
    expect(err).toBeInstanceOf(GlpiError);
    expect(err.status).toBe(404);
    expect(err.statusText).toBe('Not Found');
    expect(err.url).toBe('https://glpi.test/api/Ticket/999');
    expect(err.name).toBe('GlpiNotFoundError');
  });

  it('GlpiValidationError should parse field error details', () => {
    const err = new GlpiValidationError('https://glpi.test/api/Ticket', { name: ['Required'] });
    expect(err).toBeInstanceOf(GlpiHttpError);
    expect(err).toBeInstanceOf(GlpiError);
    expect(err.status).toBe(422);
    expect(err.errors).toEqual({ name: ['Required'] });
    expect(err.name).toBe('GlpiValidationError');
  });

  it('GlpiRateLimitError should store retryAfter seconds', () => {
    const err = new GlpiRateLimitError('https://glpi.test/api', 60);
    expect(err).toBeInstanceOf(GlpiHttpError);
    expect(err).toBeInstanceOf(GlpiError);
    expect(err.status).toBe(429);
    expect(err.statusText).toBe('Too Many Requests');
    expect(err.retryAfter).toBe(60);
    expect(err.name).toBe('GlpiRateLimitError');
  });

  it('GlpiAuthenticationError should capture OAuth2 error fields', () => {
    const err = new GlpiAuthenticationError('invalid_grant', 'Invalid credentials');
    expect(err).toBeInstanceOf(GlpiError);
    expect(err.error).toBe('invalid_grant');
    expect(err.errorDescription).toBe('Invalid credentials');
    expect(err.name).toBe('GlpiAuthenticationError');
  });

  it('preserves custom message when provided', () => {
    const customErr = new GlpiHttpError(400, 'Bad Request', 'https://glpi.test/api', null, 'Custom failure message');
    expect(customErr.message).toBe('Custom failure message');
  });
});
