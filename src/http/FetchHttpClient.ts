import {
  GlpiHttpError,
  GlpiNotFoundError,
  GlpiRateLimitError,
  GlpiValidationError,
} from '../errors/index.js';
import { type ILogger, NoopLogger } from '../logger/index.js';
import type {
  HttpClientConfig,
  HttpRequestOptions,
  HttpResponse,
  IHttpClient,
  ProxyOptions,
  RequestInterceptor,
  ResponseInterceptor,
} from './types.js';

/**
 * Native fetch-based implementation of IHttpClient with proxy, interceptors, and error mapping.
 */
export class FetchHttpClient implements IHttpClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeout?: number;
  private readonly proxy?: string | ProxyOptions;
  private readonly useEnvProxy: boolean;
  private dispatcher?: unknown;
  private readonly logger: ILogger;
  private readonly defaultHeaders: Headers;
  private readonly requestInterceptors: RequestInterceptor[] = [];
  private readonly responseInterceptors: ResponseInterceptor[] = [];

  constructor(config: HttpClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? '';
    this.fetchFn =
      config.fetch ??
      (typeof globalThis.fetch === 'function'
        ? globalThis.fetch.bind(globalThis)
        : (fetch as typeof globalThis.fetch));
    this.timeout = config.timeout;
    this.proxy = config.proxy;
    this.useEnvProxy = config.useEnvProxy ?? false;
    this.dispatcher = config.dispatcher;
    this.logger = config.logger ?? new NoopLogger();
    this.defaultHeaders = new Headers();

    if (config.headers) {
      if (config.headers instanceof Headers) {
        config.headers.forEach((value, key) => {
          this.defaultHeaders.set(key, value);
        });
      } else if (Array.isArray(config.headers)) {
        for (const [key, value] of config.headers) {
          this.defaultHeaders.set(key, value);
        }
      } else {
        for (const [key, value] of Object.entries(config.headers)) {
          if (value !== undefined && value !== null) {
            this.defaultHeaders.set(key, String(value));
          }
        }
      }
    }
  }

  /**
   * Registers a request interceptor. Returns an unsubscribe function.
   */
  useRequestInterceptor(interceptor: RequestInterceptor): () => void {
    this.requestInterceptors.push(interceptor);
    return () => {
      const idx = this.requestInterceptors.indexOf(interceptor);
      if (idx !== -1) {
        this.requestInterceptors.splice(idx, 1);
      }
    };
  }

  /**
   * Registers a response interceptor. Returns an unsubscribe function.
   */
  useResponseInterceptor(interceptor: ResponseInterceptor): () => void {
    this.responseInterceptors.push(interceptor);
    return () => {
      const idx = this.responseInterceptors.indexOf(interceptor);
      if (idx !== -1) {
        this.responseInterceptors.splice(idx, 1);
      }
    };
  }

  /**
   * Sets a persistent header applied to all subsequent requests.
   */
  setHeader(name: string, value: string): void {
    this.defaultHeaders.set(name, value);
  }

  /**
   * Removes a persistent header.
   */
  removeHeader(name: string): void {
    this.defaultHeaders.delete(name);
  }

  /**
   * Retrieves the value of a persistent header.
   */
  getHeader(name: string): string | null {
    return this.defaultHeaders.get(name);
  }

  /**
   * Returns normalized proxy options if configured via proxy property or environment.
   */
  getProxyOptions(): ProxyOptions | undefined {
    if (typeof this.proxy === 'string') {
      return { url: this.proxy };
    }
    if (this.proxy && typeof this.proxy === 'object') {
      return this.proxy;
    }
    if (this.useEnvProxy && typeof process !== 'undefined' && process.env) {
      const envUrl =
        process.env.https_proxy ||
        process.env.HTTPS_PROXY ||
        process.env.http_proxy ||
        process.env.HTTP_PROXY ||
        process.env.all_proxy ||
        process.env.ALL_PROXY;
      if (envUrl) {
        return { url: envUrl };
      }
    }
    return undefined;
  }

  /**
   * Returns current dispatcher instance if configured.
   */
  getDispatcher(): unknown | undefined {
    return this.dispatcher;
  }

  /**
   * Sends an HTTP request through interceptor chain, proxy dispatcher, and error mapper.
   */
  async request<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>> {
    let currentOptions: HttpRequestOptions = { ...options };

    // Run request interceptors sequentially
    for (const interceptor of this.requestInterceptors) {
      if (typeof interceptor === 'function') {
        currentOptions = await interceptor(currentOptions);
      } else if (interceptor && typeof interceptor.onFulfilled === 'function') {
        currentOptions = await interceptor.onFulfilled(currentOptions);
      }
    }

    // Wrap execution and chain response interceptors
    let responsePromise: Promise<HttpResponse<T>> = this.executeRequest<T>(currentOptions);

    for (const interceptor of this.responseInterceptors) {
      const onFulfilled =
        typeof interceptor === 'function' ? interceptor : interceptor.onFulfilled;
      const onRejected =
        typeof interceptor === 'object' ? interceptor.onRejected : undefined;

      responsePromise = responsePromise.then(
        onFulfilled ? ((res) => onFulfilled(res)) as (value: HttpResponse<T>) => HttpResponse<T> | Promise<HttpResponse<T>> : undefined,
        onRejected ? ((err) => onRejected(err, currentOptions)) as (reason: unknown) => HttpResponse<T> | Promise<HttpResponse<T>> : undefined
      ) as Promise<HttpResponse<T>>;
    }

    return await responsePromise;
  }

  async get<T = unknown>(
    path: string,
    options?: Omit<HttpRequestOptions, 'method' | 'path'>
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'GET', path });
  }

  async post<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<HttpRequestOptions, 'method' | 'path' | 'body'>
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'POST', path, body });
  }

  async put<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<HttpRequestOptions, 'method' | 'path' | 'body'>
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'PUT', path, body });
  }

  async patch<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<HttpRequestOptions, 'method' | 'path' | 'body'>
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'PATCH', path, body });
  }

  async delete<T = unknown>(
    path: string,
    options?: Omit<HttpRequestOptions, 'method' | 'path'>
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, method: 'DELETE', path });
  }

  private async executeRequest<T>(options: HttpRequestOptions): Promise<HttpResponse<T>> {
    const finalUrl = this.buildUrl(options.path, options.params);
    const headers = this.buildHeaders(options.headers);

    let requestBody: BodyInit | undefined;
    const methodUpper = options.method.toUpperCase();
    if (
      options.body !== undefined &&
      options.body !== null &&
      methodUpper !== 'GET' &&
      methodUpper !== 'HEAD'
    ) {
      if (
        typeof options.body === 'string' ||
        (typeof FormData !== 'undefined' && options.body instanceof FormData) ||
        (typeof Blob !== 'undefined' && options.body instanceof Blob) ||
        (typeof URLSearchParams !== 'undefined' && options.body instanceof URLSearchParams) ||
        (typeof ArrayBuffer !== 'undefined' &&
          (options.body instanceof ArrayBuffer || ArrayBuffer.isView(options.body))) ||
        (typeof Buffer !== 'undefined' && Buffer.isBuffer(options.body))
      ) {
        requestBody = options.body as BodyInit;
      } else {
        requestBody = JSON.stringify(options.body);
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }
      }
    }

    if (!headers.has('accept') && !options.rawResponse) {
      headers.set('accept', 'application/json');
    }

    const timeoutMs = options.timeout ?? this.timeout;
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (timeoutMs !== undefined && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    const userSignal = options.signal;
    const abortListener = () => {
      if (userSignal) {
        controller.abort(userSignal.reason);
      }
    };

    if (userSignal) {
      if (userSignal.aborted) {
        controller.abort(userSignal.reason);
      } else {
        userSignal.addEventListener('abort', abortListener, { once: true });
      }
    }

    const requestInit: RequestInit & { dispatcher?: unknown } = {
      method: options.method,
      headers,
      body: requestBody,
      signal: controller.signal,
    };

    const dispatcher = await this.resolveDispatcher(options.dispatcher);
    if (dispatcher) {
      requestInit.dispatcher = dispatcher;
    }

    this.logger.debug(`Sending ${options.method} request to ${finalUrl}`);

    let response: Response;
    try {
      response = await this.fetchFn(finalUrl, requestInit);
    } catch (err) {
      this.logger.error(`Network error for ${options.method} ${finalUrl}:`, err);
      throw err;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      if (userSignal) {
        userSignal.removeEventListener('abort', abortListener);
      }
    }

    this.logger.debug(`Received response ${response.status} ${response.statusText} from ${finalUrl}`);

    if (!response.ok) {
      let errorBody: unknown;
      const contentType = response.headers.get('content-type') || '';
      try {
        const text = await response.text();
        const trimmed = text.trim();
        if (
          contentType.includes('json') ||
          (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
          errorBody = trimmed ? JSON.parse(trimmed) : undefined;
        } else {
          errorBody = trimmed || undefined;
        }
      } catch {
        errorBody = undefined;
      }

      let message: string | undefined;
      if (typeof errorBody === 'object' && errorBody !== null) {
        const candidate =
          (errorBody as Record<string, unknown>).message ??
          (errorBody as Record<string, unknown>).error;
        if (typeof candidate === 'string') {
          message = candidate;
        }
      } else if (typeof errorBody === 'string' && errorBody) {
        message = errorBody;
      }

      let errorToThrow: GlpiHttpError;
      if (response.status === 404) {
        errorToThrow = new GlpiNotFoundError(finalUrl, errorBody, message);
      } else if (response.status === 429) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterNum = retryAfterHeader !== null ? Number(retryAfterHeader) : undefined;
        const retryAfter =
          retryAfterNum !== undefined && Number.isFinite(retryAfterNum) ? retryAfterNum : undefined;
        errorToThrow = new GlpiRateLimitError(finalUrl, retryAfter, errorBody, message);
      } else if (response.status === 400 || response.status === 422) {
        let errors: Record<string, string[]> | unknown = undefined;
        if (typeof errorBody === 'object' && errorBody !== null) {
          const errObj = errorBody as Record<string, unknown>;
          errors = errObj.fields ?? errObj.errors ?? errorBody;
        }
        errorToThrow = new GlpiValidationError(
          finalUrl,
          errors,
          response.status,
          response.statusText,
          errorBody,
          message
        );
      } else {
        errorToThrow = new GlpiHttpError(response.status, response.statusText, finalUrl, errorBody, message);
      }

      (errorToThrow as any).options = options;
      throw errorToThrow;
    }

    let data: T;
    if (options.rawResponse) {
      data = response as unknown as T;
    } else if (response.status === 204 || response.status === 205) {
      data = null as unknown as T;
    } else {
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      const trimmed = text.trim();
      if (!trimmed) {
        data = null as unknown as T;
      } else if (
        contentType.includes('json') ||
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          data = JSON.parse(trimmed) as T;
        } catch {
          data = text as unknown as T;
        }
      } else {
        data = text as unknown as T;
      }
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data,
    };
  }

  private buildUrl(path: string, params?: HttpRequestOptions['params']): string {
    let urlString: string;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      urlString = path;
    } else {
      const cleanBase = this.baseUrl.replace(/\/+$/, '');
      const cleanPath = path.replace(/^\/+/, '');
      if (cleanBase && cleanPath) {
        urlString = `${cleanBase}/${cleanPath}`;
      } else if (cleanBase) {
        urlString = cleanBase;
      } else {
        urlString = cleanPath;
      }
    }

    const url = new URL(urlString);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private buildHeaders(optionsHeaders?: HttpRequestOptions['headers']): Headers {
    const headers = new Headers();
    this.defaultHeaders.forEach((value, key) => {
      headers.set(key, value);
    });

    if (optionsHeaders) {
      if (optionsHeaders instanceof Headers) {
        optionsHeaders.forEach((value, key) => {
          headers.set(key, value);
        });
      } else if (Array.isArray(optionsHeaders)) {
        for (const [key, value] of optionsHeaders) {
          headers.set(key, value);
        }
      } else {
        for (const [key, value] of Object.entries(optionsHeaders)) {
          if (value !== undefined && value !== null) {
            headers.set(key, String(value));
          }
        }
      }
    }

    return headers;
  }

  private async resolveDispatcher(optionsDispatcher?: unknown): Promise<unknown | undefined> {
    if (optionsDispatcher) {
      return optionsDispatcher;
    }
    if (this.dispatcher) {
      return this.dispatcher;
    }
    const proxyOpts = this.getProxyOptions();
    if (!proxyOpts) {
      return undefined;
    }
    try {
      const undiciMod = 'undici';
      const undici = await import(/* @vite-ignore */ undiciMod);
      if (undici && undici.ProxyAgent) {
        this.dispatcher = new undici.ProxyAgent(proxyOpts);
        return this.dispatcher;
      }
    } catch {
      // undici not available or running in non-Node environment
    }
    return undefined;
  }
}
