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

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let res = 0;
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    res = ((res << 8) | n) >>> 0;
  }
  return res;
}

function ip6ToBigInt(ip: string): bigint | null {
  ip = ip.trim().replace(/^\[|\]$/g, '');
  if (!ip || ip.split('::').length > 2) return null;
  if (ip.includes(':::')) return null;

  // Handle IPv4-mapped / IPv4-compatible at end (e.g. ::ffff:192.168.1.1)
  const lastColon = ip.lastIndexOf(':');
  if (lastColon !== -1) {
    const lastPart = ip.slice(lastColon + 1);
    if (lastPart.includes('.')) {
      const v4Parts = lastPart.split('.');
      if (v4Parts.length !== 4) return null;
      let v4Int = 0;
      for (let i = 0; i < 4; i++) {
        const n = Number(v4Parts[i]);
        if (!Number.isInteger(n) || n < 0 || n > 255) return null;
        v4Int = ((v4Int << 8) | n) >>> 0;
      }
      const hi = ((v4Int >>> 16) & 0xffff).toString(16);
      const lo = (v4Int & 0xffff).toString(16);
      ip = ip.slice(0, lastColon + 1) + hi + ':' + lo;
    }
  }

  let groups: string[];
  if (ip.includes('::')) {
    const [leftStr, rightStr] = ip.split('::');
    const left = leftStr ? leftStr.split(':') : [];
    const right = rightStr ? rightStr.split(':') : [];
    if (left.length + right.length > 7) return null;
    const zeros = 8 - (left.length + right.length);
    groups = [...left, ...Array(zeros).fill('0'), ...right];
  } else {
    groups = ip.split(':');
    if (groups.length !== 8) return null;
  }

  if (groups.length !== 8) return null;
  let res = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    res = (res << 16n) | BigInt(parseInt(g, 16));
  }
  return res;
}

function matchCidr6(ip: string, cidr: string): boolean {
  const [netStr, bitsStr] = cidr.split('/');
  if (!netStr || !bitsStr) return false;
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 128) return false;
  const targetIp = ip6ToBigInt(ip);
  const netIp = ip6ToBigInt(netStr);
  if (targetIp === null || netIp === null) return false;
  if (bits === 0) return true;
  const totalBits = 128n;
  const mask =
    bits === 128
      ? (1n << totalBits) - 1n
      : ((1n << totalBits) - 1n) ^ ((1n << (totalBits - BigInt(bits))) - 1n);
  return (targetIp & mask) === (netIp & mask);
}

function matchCidr(ip: string, cidr: string): boolean {
  if (cidr.includes(':') || ip.includes(':')) {
    return matchCidr6(ip, cidr);
  }
  const [netStr, bitsStr] = cidr.split('/');
  if (!netStr || !bitsStr) return false;
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const targetIpInt = ipToInt(ip);
  const netIpInt = ipToInt(netStr);
  if (targetIpInt === null || netIpInt === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (targetIpInt & mask) === (netIpInt & mask);
}

function matchNoProxyRule(url: URL, rule: string): boolean {
  rule = rule.trim().toLowerCase();
  if (!rule) return false;
  if (rule === '*') return true;

  const rawHost = url.hostname.toLowerCase();
  const urlHost = rawHost.replace(/^\[|\]$/g, '');
  const urlPort =
    url.port ||
    (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '');

  let ruleHost = rule;
  let rulePort: string | undefined;

  if (rule.startsWith('[')) {
    const closingBracket = rule.indexOf(']');
    if (closingBracket !== -1) {
      ruleHost = rule.slice(1, closingBracket);
      if (rule[closingBracket + 1] === ':') {
        rulePort = rule.slice(closingBracket + 2);
      } else if (rule[closingBracket + 1] === '/') {
        ruleHost = rule.slice(1, closingBracket) + rule.slice(closingBracket + 1);
      }
    }
  } else if (rule.includes(':') && !rule.includes('/')) {
    const firstColon = rule.indexOf(':');
    const lastColon = rule.lastIndexOf(':');
    if (firstColon === lastColon) {
      const possiblePort = rule.slice(firstColon + 1);
      if (/^\d+$/.test(possiblePort)) {
        ruleHost = rule.slice(0, firstColon);
        rulePort = possiblePort;
      }
    }
  }

  ruleHost = ruleHost.replace(/^\[|\]$/g, '');

  if (rulePort !== undefined && rulePort !== urlPort) {
    return false;
  }

  if (ruleHost.includes('/')) {
    return matchCidr(urlHost, ruleHost);
  }

  if (ruleHost === urlHost) {
    return true;
  }

  if (ruleHost.includes(':') || urlHost.includes(':')) {
    const targetIp6 = ip6ToBigInt(urlHost);
    const ruleIp6 = ip6ToBigInt(ruleHost);
    if (targetIp6 !== null && ruleIp6 !== null && targetIp6 === ruleIp6) {
      return true;
    }
  }

  if (ruleHost.startsWith('*.')) {
    const suffix = ruleHost.slice(1);
    return urlHost.endsWith(suffix);
  }

  if (ruleHost.startsWith('.')) {
    return urlHost === ruleHost.slice(1) || urlHost.endsWith(ruleHost);
  }

  if (urlHost.endsWith('.' + ruleHost)) {
    return true;
  }

  return false;
}

const SENSITIVE_KEY_PATTERN =
  /^(authorization|password|client[-_]?secret|secret|token|access[-_]?token|refresh[-_]?token|code|user[-_]?token|app[-_]?token)$/i;

function redactSensitiveObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveObject(item));
  }

  // Handle plain objects
  if (obj.constructor === Object || !obj.constructor) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = redactSensitiveObject(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return obj;
}

function sanitizeHeaders(headers?: HttpRequestOptions['headers']): Record<string, string> | undefined {
  if (!headers) return undefined;

  const result: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : value;
    }
  } else if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : String(value);
    }
  }
  return result;
}

function sanitizeBody(body: unknown): unknown {
  if (!body) return body;

  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(redactSensitiveObject(parsed));
      } catch {
        // Fall through if not valid JSON
      }
    }

    if (
      trimmed.includes('=') &&
      (trimmed.includes('&') || SENSITIVE_KEY_PATTERN.test(trimmed.split('=')[0]))
    ) {
      try {
        const params = new URLSearchParams(trimmed);
        let mutated = false;
        for (const key of Array.from(params.keys())) {
          if (SENSITIVE_KEY_PATTERN.test(key)) {
            params.set(key, '[REDACTED]');
            mutated = true;
          }
        }
        if (mutated) {
          return params.toString();
        }
      } catch {
        // Fall through
      }
    }
    return body;
  }

  if (body instanceof URLSearchParams) {
    const copy = new URLSearchParams(body);
    for (const key of Array.from(copy.keys())) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        copy.set(key, '[REDACTED]');
      }
    }
    return copy;
  }

  if (typeof body === 'object') {
    return redactSensitiveObject(body);
  }

  return body;
}

/**
 * Sanitizes request options by redacting sensitive headers and body fields
 * before attaching options to thrown errors or logs.
 */
export function sanitizeRequestOptions(options: HttpRequestOptions): HttpRequestOptions {
  return {
    ...options,
    headers: sanitizeHeaders(options.headers),
    body: sanitizeBody(options.body),
  };
}

/**
 * Native fetch-based implementation of IHttpClient with proxy, interceptors, and error mapping.
 */
export class FetchHttpClient implements IHttpClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeout?: number;
  private readonly proxy?: string | ProxyOptions;
  private readonly useEnvProxy: boolean;
  private readonly noProxy?: string | string[];
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
    this.noProxy = config.noProxy;
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
   * Retrieves all active NO_PROXY bypass rules from configuration or environment.
   */
  getNoProxyRules(): string[] {
    const rules: string[] = [];
    if (this.noProxy !== undefined) {
      if (Array.isArray(this.noProxy)) {
        for (const item of this.noProxy) {
          rules.push(...item.split(/[,;\s]+/));
        }
      } else if (typeof this.noProxy === 'string') {
        rules.push(...this.noProxy.split(/[,;\s]+/));
      }
    } else if (this.proxy && typeof this.proxy === 'object' && this.proxy.noProxy !== undefined) {
      if (Array.isArray(this.proxy.noProxy)) {
        for (const item of this.proxy.noProxy) {
          rules.push(...item.split(/[,;\s]+/));
        }
      } else if (typeof this.proxy.noProxy === 'string') {
        rules.push(...this.proxy.noProxy.split(/[,;\s]+/));
      }
    } else if (typeof process !== 'undefined' && process.env) {
      const envNoProxy = process.env.NO_PROXY || process.env.no_proxy;
      if (envNoProxy) {
        rules.push(...envNoProxy.split(/[,;\s]+/));
      }
    }
    return rules.map((r) => r.trim()).filter(Boolean);
  }

  /**
   * Checks whether a target URL should bypass the configured proxy.
   */
  shouldBypassProxy(urlInput: string | URL): boolean {
    const rules = this.getNoProxyRules();
    if (rules.length === 0) {
      return false;
    }
    let parsedUrl: URL;
    try {
      if (urlInput instanceof URL) {
        parsedUrl = urlInput;
      } else if (urlInput.startsWith('http://') || urlInput.startsWith('https://')) {
        parsedUrl = new URL(urlInput);
      } else {
        parsedUrl = new URL(urlInput, this.baseUrl || 'http://localhost');
      }
    } catch {
      return false;
    }
    return rules.some((rule) => matchNoProxyRule(parsedUrl, rule));
  }

  /**
   * Returns normalized proxy options if configured via proxy property or environment.
   * If targetUrl is provided and matches NO_PROXY bypass rules, returns undefined.
   */
  getProxyOptions(targetUrl?: string): ProxyOptions | undefined {
    if (targetUrl && this.shouldBypassProxy(targetUrl)) {
      return undefined;
    }
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
   * Returns base URL configured for this client instance.
   */
  getBaseUrl(): string {
    return this.baseUrl;
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

    const dispatcher = await this.resolveDispatcher(options.dispatcher, finalUrl);
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

      (errorToThrow as any).options = sanitizeRequestOptions(options);
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

  private async resolveDispatcher(
    optionsDispatcher?: unknown,
    targetUrl?: string
  ): Promise<unknown | undefined> {
    if (targetUrl && this.shouldBypassProxy(targetUrl)) {
      this.logger.debug(`Bypassing proxy for ${targetUrl} due to NO_PROXY rules`);
      return undefined;
    }
    if (optionsDispatcher) {
      return optionsDispatcher;
    }
    if (this.dispatcher) {
      return this.dispatcher;
    }
    const proxyOpts = this.getProxyOptions(targetUrl);
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
