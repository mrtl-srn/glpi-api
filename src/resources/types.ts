import type { RsqlBuilder } from '../rsql/index.js';

/**
 * Common request options for scoping and HTTP controls.
 */
export interface RequestOptions {
  /**
   * Target GLPI entity ID (sets GLPI-Entity header).
   */
  entity?: number | string;

  /**
   * Target GLPI profile ID (sets GLPI-Profile header).
   */
  profile?: number | string;

  /**
   * Whether to include child entities recursively (sets GLPI-Entity-Recursive header).
   */
  recursive?: boolean;

  /**
   * Response language code, e.g. 'en_GB' or 'fr_FR' (sets Accept-Language header).
   */
  language?: string;

  /**
   * Additional custom HTTP headers to pass with the request.
   */
  headers?: Record<string, string>;

  /**
   * AbortSignal to cancel the request.
   */
  signal?: AbortSignal;
}

/**
 * Parameters for paginated collection listing.
 */
export interface ListParams extends RequestOptions {
  /**
   * RSQL query filter string or fluent RsqlBuilder instance.
   */
  filter?: string | RsqlBuilder;

  /**
   * Zero-based offset for pagination (default: 0).
   */
  start?: number;

  /**
   * Maximum number of items to return (default: 100).
   */
  limit?: number;

  /**
   * Sort field or expression (e.g. 'id' or 'id:desc').
   */
  sort?: string;

  /**
   * Sort direction ('ASC' or 'DESC').
   */
  order?: 'ASC' | 'DESC' | (string & {});

  /**
   * Arbitrary query parameters.
   */
  params?: Record<string, string | number | boolean | undefined | null>;

  [key: string]: unknown;
}

/**
 * Standardized paginated result wrapper.
 */
export interface PaginatedResult<T> {
  /**
   * Array of items returned in the current page.
   */
  data: T[];

  /**
   * Total count of items matching the query across all pages (from x-total-count header).
   */
  total: number;

  /**
   * Number of items in this page (data.length).
   */
  count: number;

  /**
   * The start offset used for this page, if specified.
   */
  start?: number;

  /**
   * The page limit used for this query, if specified.
   */
  limit?: number;
}

/**
 * Options for resource creation.
 */
export interface CreateOptions extends RequestOptions {
  /**
   * If true, performs an immediate follow-up get() by id to retrieve and return the full entity.
   */
  fetch?: boolean;
}

/**
 * Standard GLPI 2.x creation response payload.
 */
export interface CreateResult {
  id: number | string;
  href: string;
  [key: string]: unknown;
}

/**
 * Options for resource updates.
 */
export interface UpdateOptions extends RequestOptions {
  /**
   * HTTP method to use for updates (default: 'PATCH').
   */
  method?: 'PATCH' | 'PUT';
}

/**
 * Options for resource deletion.
 */
export interface DeleteOptions extends RequestOptions {
  /**
   * If true, permanently purges the item instead of moving it to the trash bin.
   */
  force?: boolean;

  /**
   * Alias for permanent deletion in legacy or custom endpoints.
   */
  purge?: boolean;

  /**
   * Additional query parameters for deletion.
   */
  params?: Record<string, string | number | boolean | undefined | null>;
}

/**
 * Generic contract for CRUD resource services.
 */
export interface IResourceService<T> {
  /**
   * Lists entities with optional filtering, sorting, and pagination.
   */
  list(params?: ListParams): Promise<PaginatedResult<T>>;

  /**
   * Retrieves a single entity by its identifier.
   */
  get(id: number | string, options?: RequestOptions): Promise<T>;

  /**
   * Creates a new entity. If options.fetch is true, returns the fully populated entity T.
   */
  create(data: Partial<T>, options?: CreateOptions): Promise<CreateResult | T>;

  /**
   * Updates an existing entity by ID.
   */
  update(id: number | string, data: Partial<T>, options?: UpdateOptions): Promise<T>;

  /**
   * Deletes an entity by ID with optional purge/force flags.
   */
  delete(id: number | string, options?: DeleteOptions): Promise<void>;
}
