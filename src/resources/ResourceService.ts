import { GlpiError } from '../errors/index.js';
import type { IHttpClient } from '../http/types.js';
import { RouteRegistry } from './RouteRegistry.js';
import type {
  CreateOptions,
  CreateResult,
  DeleteOptions,
  IResourceService,
  ListParams,
  PaginatedResult,
  RequestOptions,
  UpdateOptions,
} from './types.js';

/**
 * Generic base service for GLPI REST resources implementing standard CRUD operations,
 * RSQL query filtering, pagination, and stateless session scoping headers.
 */
export class ResourceService<T = unknown> implements IResourceService<T> {
  protected http: IHttpClient;
  protected basePath: string;
  protected registry?: RouteRegistry;

  /**
   * Initializes a new ResourceService instance.
   *
   * @param http The HTTP client to use for network transport.
   * @param endpoint The route path or registered alias (e.g. 'Ticket', 'Assistance/Ticket').
   * @param registry Optional RouteRegistry for custom alias resolution.
   */
  constructor(http: IHttpClient, endpoint: string, registry?: RouteRegistry) {
    this.http = http;
    this.registry = registry;
    const reg = registry ?? new RouteRegistry();
    const resolved = reg.resolve(endpoint);
    const normalized = resolved.replace(/\/+$/, '');
    this.basePath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  }

  /**
   * Returns the normalized base path of this resource.
   */
  getBasePath(): string {
    return this.basePath;
  }

  /**
   * Returns the underlying HTTP client.
   */
  getHttpClient(): IHttpClient {
    return this.http;
  }

  /**
   * Builds the scoping and custom headers for a request.
   */
  protected buildHeaders(options?: RequestOptions): Record<string, string> | undefined {
    const headers: Record<string, string> = {};

    if (options?.entity !== undefined && options.entity !== null) {
      headers['GLPI-Entity'] = String(options.entity);
    }
    if (options?.profile !== undefined && options.profile !== null) {
      headers['GLPI-Profile'] = String(options.profile);
    }
    if (options?.recursive !== undefined && options.recursive !== null) {
      headers['GLPI-Entity-Recursive'] = String(options.recursive);
    }
    if (options?.language !== undefined && options.language !== null) {
      headers['Accept-Language'] = String(options.language);
    }
    if (options?.headers) {
      Object.assign(headers, options.headers);
    }

    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  /**
   * Lists entities matching the query parameters with pagination.
   */
  async list(params?: ListParams): Promise<PaginatedResult<T>> {
    const queryParams: Record<string, string | number | boolean> = {};

    if (params?.filter !== undefined && params.filter !== null) {
      queryParams.filter =
        typeof params.filter === 'string'
          ? params.filter
          : typeof (params.filter as any)?.build === 'function'
            ? (params.filter as { build(): string }).build()
            : String(params.filter);
    }
    if (params?.start !== undefined) {
      queryParams.start = params.start;
    }
    if (params?.limit !== undefined) {
      queryParams.limit = params.limit;
    }
    if (params?.sort !== undefined) {
      queryParams.sort = params.sort;
    }
    if (params?.order !== undefined) {
      queryParams.order = params.order;
    }
    if (params?.params) {
      for (const [key, value] of Object.entries(params.params)) {
        if (value !== undefined && value !== null) {
          queryParams[key] = value;
        }
      }
    }

    const headers = this.buildHeaders(params);

    const response = await this.http.request<T[]>({
      method: 'GET',
      path: this.basePath,
      headers,
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      signal: params?.signal,
    });

    const data: T[] = Array.isArray(response.data)
      ? response.data
      : response.data != null
        ? [response.data as unknown as T]
        : [];

    let total: number = data.length;
    if (response.headers) {
      let totalHeader: string | null | undefined;
      if (typeof (response.headers as Headers).get === 'function') {
        totalHeader = (response.headers as Headers).get('x-total-count');
      } else if (typeof response.headers === 'object') {
        const rec = response.headers as unknown as Record<string, string>;
        totalHeader = rec['x-total-count'] ?? rec['X-Total-Count'];
      }
      if (totalHeader != null && totalHeader !== '' && !Number.isNaN(Number(totalHeader))) {
        total = Number(totalHeader);
      }
    }

    const result: PaginatedResult<T> = {
      data,
      total,
      count: data.length,
    };

    if (params?.start !== undefined) {
      result.start = params.start;
    }
    if (params?.limit !== undefined) {
      result.limit = params.limit;
    }

    return result;
  }

  /**
   * Retrieves an entity by its identifier.
   */
  async get(id: number | string, options?: RequestOptions): Promise<T> {
    const headers = this.buildHeaders(options);
    const response = await this.http.request<T>({
      method: 'GET',
      path: `${this.basePath}/${encodeURIComponent(String(id))}`,
      headers,
      signal: options?.signal,
    });
    return response.data;
  }

  /**
   * Creates a new entity. If options.fetch is true, retrieves and returns the full entity.
   */
  create(data: Partial<T> | Record<string, unknown>, options: CreateOptions & { fetch: true }): Promise<T>;
  create(data: Partial<T> | Record<string, unknown>, options?: CreateOptions & { fetch?: false }): Promise<CreateResult>;
  create(data: Partial<T> | Record<string, unknown>, options?: CreateOptions): Promise<CreateResult | T>;
  async create(data: Partial<T> | Record<string, unknown>, options?: CreateOptions): Promise<CreateResult | T> {
    const headers = this.buildHeaders(options);
    const response = await this.http.request<CreateResult>({
      method: 'POST',
      path: this.basePath,
      body: data,
      headers,
      signal: options?.signal,
    });

    if (options?.fetch) {
      let createdId: number | string | undefined;
      const dataObj = response.data as unknown;
      if (typeof dataObj === 'object' && dataObj !== null) {
        if ('id' in dataObj) {
          createdId = (dataObj as { id: number | string }).id;
        } else if (Array.isArray(dataObj) && dataObj[0]?.id !== undefined) {
          createdId = (dataObj[0] as { id: number | string }).id;
        }
      }

      if (createdId !== undefined) {
        return this.get(createdId, options);
      }
      throw new GlpiError('Cannot fetch created entity: server response did not contain an id');
    }

    return response.data;
  }

  /**
   * Updates an existing entity by ID.
   */
  async update(id: number | string, data: Partial<T> | Record<string, unknown>, options?: UpdateOptions): Promise<T> {
    const method = options?.method ?? 'PATCH';
    const headers = this.buildHeaders(options);
    const response = await this.http.request<T>({
      method,
      path: `${this.basePath}/${encodeURIComponent(String(id))}`,
      body: data,
      headers,
      signal: options?.signal,
    });
    return response.data;
  }

  /**
   * Deletes an entity by ID with optional permanent purge/force flag.
   */
  async delete(id: number | string, options?: DeleteOptions): Promise<void> {
    const queryParams: Record<string, string | number | boolean> = {};

    if (options?.force !== undefined) {
      queryParams.force = options.force;
    }
    if (options?.purge !== undefined) {
      queryParams.purge = options.purge;
    }
    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined && value !== null) {
          queryParams[key] = value;
        }
      }
    }

    const headers = this.buildHeaders(options);

    await this.http.request<void>({
      method: 'DELETE',
      path: `${this.basePath}/${encodeURIComponent(String(id))}`,
      headers,
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      signal: options?.signal,
    });
  }
}
