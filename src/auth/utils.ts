import { GlpiAuthenticationError, GlpiHttpError } from '../errors/index.js';

/**
 * Translates HTTP errors or upstream errors from OAuth token endpoints into GlpiAuthenticationError.
 */
export function mapOAuthHttpError(err: unknown, defaultMessage = 'OAuth token request failed'): never {
  if (err instanceof GlpiAuthenticationError) {
    throw err;
  }
  if (err instanceof GlpiHttpError) {
    const bodyObj = (err.body && typeof err.body === 'object'
      ? err.body
      : undefined) as Record<string, unknown> | undefined;
    const oauthError = typeof bodyObj?.error === 'string' ? bodyObj.error : undefined;
    const errorDesc =
      typeof bodyObj?.error_description === 'string'
        ? bodyObj.error_description
        : typeof bodyObj?.message === 'string'
          ? bodyObj.message
          : err.message || defaultMessage;
    throw new GlpiAuthenticationError(oauthError, errorDesc, errorDesc);
  }
  throw err;
}
