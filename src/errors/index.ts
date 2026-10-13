/**
 * Base error class for all GLPI API client errors.
 */
export class GlpiError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GlpiError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when an HTTP request fails.
 */
export class GlpiHttpError extends GlpiError {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly body?: unknown;

  constructor(status: number, statusText: string, url: string, body?: unknown, message?: string) {
    const msg = message ?? `HTTP ${status} ${statusText}: ${url}`;
    super(msg);
    this.name = 'GlpiHttpError';
    this.status = status;
    this.statusText = statusText;
    this.url = url;
    this.body = body;
  }
}

/**
 * Error thrown when a requested GLPI resource is not found (HTTP 404).
 */
export class GlpiNotFoundError extends GlpiHttpError {
  constructor(url: string, body?: unknown, message?: string) {
    const msg = message ?? `Resource not found: ${url}`;
    super(404, 'Not Found', url, body, msg);
    this.name = 'GlpiNotFoundError';
  }
}

/**
 * Error thrown when validation fails on a request payload (HTTP 400 / 422).
 */
export class GlpiValidationError extends GlpiHttpError {
  readonly errors?: Record<string, string[]> | unknown;

  constructor(
    url: string,
    errors?: Record<string, string[]> | unknown,
    status = 422,
    statusText = 'Unprocessable Entity',
    body?: unknown,
    message?: string
  ) {
    const msg = message ?? `Validation failed: ${url}`;
    super(status, statusText, url, body ?? errors, msg);
    this.name = 'GlpiValidationError';
    this.errors = errors;
  }
}

/**
 * Error thrown when API rate limits are exceeded (HTTP 429).
 */
export class GlpiRateLimitError extends GlpiHttpError {
  readonly retryAfter?: number;

  constructor(
    url: string,
    retryAfter?: number,
    body?: unknown,
    message?: string
  ) {
    const msg =
      message ??
      (retryAfter !== undefined
        ? `Rate limit exceeded. Retry after ${retryAfter}s: ${url}`
        : `Rate limit exceeded: ${url}`);
    super(429, 'Too Many Requests', url, body, msg);
    this.name = 'GlpiRateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Error thrown when an authentication or authorization failure occurs (e.g. OAuth2).
 */
export class GlpiAuthenticationError extends GlpiError {
  readonly error?: string;
  readonly errorDescription?: string;

  constructor(error?: string, errorDescription?: string, message?: string) {
    const msg =
      message ??
      (error && errorDescription
        ? `${error}: ${errorDescription}`
        : errorDescription ?? error ?? 'Authentication failed');
    super(msg);
    this.name = 'GlpiAuthenticationError';
    this.error = error;
    this.errorDescription = errorDescription;
  }
}
