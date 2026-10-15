import { GlpiError } from '../errors/index.js';

/**
 * Location of a GraphQL error in the source document.
 */
export interface GraphqlErrorLocation {
  line: number;
  column: number;
}

/**
 * Standard GraphQL error structure according to GraphQL specification.
 */
export interface GraphqlError {
  message: string;
  locations?: GraphqlErrorLocation[];
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
}

/**
 * GraphQL execution result payload.
 */
export interface GraphqlResponse<T = unknown> {
  data?: T;
  errors?: GraphqlError[];
}

/**
 * Options for GraphQL query execution.
 */
export interface GraphqlRequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  operationName?: string;
}

/**
 * Error thrown when a GraphQL response contains errors.
 */
export class GlpiGraphqlError extends GlpiError {
  readonly errors: GraphqlError[];

  constructor(message: string, errors: GraphqlError[] = [], options?: ErrorOptions) {
    super(message, options);
    this.name = 'GlpiGraphqlError';
    this.errors = errors;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Interface contract for GraphQL client.
 */
export interface IGraphqlClient {
  query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
    options?: GraphqlRequestOptions
  ): Promise<T>;
}
