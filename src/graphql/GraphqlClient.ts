import type { IHttpClient } from '../http/types.js';
import { GlpiError } from '../errors/index.js';
import {
  type IGraphqlClient,
  type GraphqlRequestOptions,
  type GraphqlResponse,
  GlpiGraphqlError,
} from './types.js';

/**
 * Client for interacting with the GLPI GraphQL API endpoint.
 */
export class GraphqlClient implements IGraphqlClient {
  readonly path: string;
  private readonly http: IHttpClient;

  /**
   * Initializes a new GraphqlClient.
   *
   * @param http - The HTTP client instance to use for network requests.
   * @param path - The GraphQL endpoint path (defaults to '/GraphQL').
   */
  constructor(http: IHttpClient, path: string = '/GraphQL') {
    this.http = http;
    this.path = path;
  }

  /**
   * Executes a GraphQL query or mutation against the GLPI GraphQL endpoint.
   *
   * @typeParam T - The expected shape of the returned `data` object.
   * @param query - The GraphQL query or mutation document string.
   * @param variables - Optional variables to pass with the GraphQL operation.
   * @param options - Optional request options such as headers, abort signal, and operationName.
   * @returns The unwrapped `data` field of the GraphQL execution result.
   * @throws {GlpiGraphqlError} When the GraphQL server returns execution errors.
   * @throws {GlpiError} When the response structure is invalid or missing required data.
   */
  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
    options?: GraphqlRequestOptions
  ): Promise<T> {
    const body: {
      query: string;
      variables?: Record<string, unknown>;
      operationName?: string;
    } = {
      query,
      variables,
    };

    if (options?.operationName !== undefined) {
      body.operationName = options.operationName;
    }

    const response = await this.http.request<GraphqlResponse<T>>({
      method: 'POST',
      path: this.path,
      body,
      headers: options?.headers,
      signal: options?.signal,
    });

    const payload = response?.data;
    if (payload == null || typeof payload !== 'object') {
      throw new GlpiError('Invalid GraphQL response: payload is not an object');
    }

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const messages = payload.errors
        .map((e) => (e && typeof e.message === 'string' && e.message.trim().length > 0 ? e.message : 'Unknown GraphQL error'))
        .join('; ');

      throw new GlpiGraphqlError(
        messages || 'GraphQL operation failed',
        payload.errors
      );
    }

    if (payload.data === undefined) {
      throw new GlpiError('Invalid GraphQL response: missing "data" field');
    }

    return payload.data as T;
  }
}
