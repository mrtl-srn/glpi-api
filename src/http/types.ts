import type { ILogger } from '../logger/index.js';

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | (string & {});

/**
 * Options for individual HTTP requests.
 */
export interface HttpRequestOptions {
  method: HttpMethod;
  path: string;
  headers?: Record<string, string> | Headers | [string, string][];
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
  rawResponse?: boolean;
  dispatcher?: unknown;
}

/**
 * Standardized HTTP response wrapper.
 */
export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Headers;
  data: T;
}

/**
 * Request interceptor function or object.
 */
export type RequestInterceptorFn = (
  options: HttpRequestOptions
) => HttpRequestOptions | Promise<HttpRequestOptions>;

export interface RequestInterceptorObj {
  onFulfilled?: RequestInterceptorFn;
  onRejected?: (error: unknown) => unknown | Promise<unknown>;
}

export type RequestInterceptor = RequestInterceptorFn | RequestInterceptorObj;

/**
 * Response interceptor function or object.
 */
export type ResponseInterceptorFn<T = any> = (
  response: HttpResponse<T>
) => HttpResponse<T> | Promise<HttpResponse<T>>;

export interface ResponseInterceptorObj<T = any> {
  onFulfilled?: ResponseInterceptorFn<T>;
  onRejected?: (error: unknown) => unknown | Promise<unknown>;
}

export type ResponseInterceptor<T = any> = ResponseInterceptorFn<T> | ResponseInterceptorObj<T>;

/**
 * Configuration options for HTTP proxy routing.
 */
export interface ProxyOptions {
  url: string;
  auth?: string | { username?: string; password?: string };
  headers?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Configuration passed to FetchHttpClient initialization.
 */
export interface HttpClientConfig {
  baseUrl?: string;
  headers?: Record<string, string> | Headers | [string, string][];
  timeout?: number;
  fetch?: typeof fetch;
  proxy?: string | ProxyOptions;
  useEnvProxy?: boolean;
  dispatcher?: unknown;
  logger?: ILogger;
}

/**
 * Abstract HTTP client contract.
 */
export interface IHttpClient {
  request<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>>;
  useRequestInterceptor(interceptor: RequestInterceptor): () => void;
  useResponseInterceptor(interceptor: ResponseInterceptor): () => void;
  setHeader(name: string, value: string): void;
  removeHeader(name: string): void;
}
