import { GlpiAuthenticationError, GlpiError, GlpiHttpError } from './errors/index.js';
import { FetchHttpClient } from './http/FetchHttpClient.js';
import type { HttpRequestOptions, IHttpClient, ProxyOptions } from './http/types.js';
import type { ILogger } from './logger/index.js';
import {
  PasswordAuthProvider,
  AuthorizationCodeAuthProvider,
  ClientCredentialsAuthProvider,
} from './auth/index.js';
import type {
  IAuthProvider,
  ITokenStorage,
} from './auth/types.js';
import { RouteRegistry } from './resources/RouteRegistry.js';
import { ResourceService } from './resources/ResourceService.js';
import { TicketResource } from './resources/domain/TicketResource.js';
import { ComputerResource } from './resources/domain/ComputerResource.js';
import { UserResource } from './resources/domain/UserResource.js';
import { DocumentResource } from './resources/domain/DocumentResource.js';
import { GraphqlClient } from './graphql/GraphqlClient.js';

/**
 * Authentication configuration options for GlpiClient.
 */
export type GlpiAuthOption =
  | IAuthProvider
  | {
      type: 'password';
      username: string;
      password: string;
      clientId?: string;
      clientSecret?: string;
      scope?: string;
      storage?: ITokenStorage;
      tokenEndpoint?: string;
      proactiveMarginSeconds?: number;
    }
  | {
      type: 'authorization_code';
      clientId: string;
      clientSecret?: string;
      code?: string;
      redirectUri?: string;
      refreshToken?: string;
      scope?: string;
      storage?: ITokenStorage;
      tokenEndpoint?: string;
      proactiveMarginSeconds?: number;
    }
  | {
      type: 'client_credentials';
      clientId: string;
      clientSecret: string;
      scope?: string;
      storage?: ITokenStorage;
      tokenEndpoint?: string;
      proactiveMarginSeconds?: number;
    };

/**
 * Configuration options for GlpiClient initialization.
 */
export interface GlpiClientOptions {
  apiUrl: string;
  auth?: GlpiAuthOption;
  proxy?: string | ProxyOptions;
  useEnvProxy?: boolean;
  noProxy?: string | string[];
  dispatcher?: unknown;
  fetch?: typeof fetch;
  timeout?: number;
  logger?: ILogger;
  restPath?: string;
  graphqlPath?: string;
  routes?: Record<string, string>;
  headers?: Record<string, string> | Headers | [string, string][];
}

/**
 * Session entity scoping configuration.
 */
export interface EntityScope {
  entityId: number | string;
  recursive: boolean;
}

function isSameOrigin(targetPath: string, baseOriginOrUrl?: string): boolean {
  if (typeof targetPath !== 'string') return true;
  if (!targetPath.startsWith('http://') && !targetPath.startsWith('https://')) {
    return true;
  }
  if (!baseOriginOrUrl) return false;
  try {
    const targetOrigin = new URL(targetPath).origin.toLowerCase();
    const expectedOrigin = new URL(baseOriginOrUrl).origin.toLowerCase();
    return targetOrigin === expectedOrigin;
  } catch {
    return false;
  }
}

/**
 * Main GLPI API client facade providing unified access to REST resources,
 * GraphQL querying, authentication management, and session scoping.
 */
export class GlpiClient {
  public readonly authProvider?: IAuthProvider;
  public readonly tickets: TicketResource;
  public readonly computers: ComputerResource;
  public readonly users: UserResource;
  public readonly documents: DocumentResource;
  public readonly graphql: GraphqlClient;

  private readonly rootHttpClient: FetchHttpClient;
  private readonly restHttpClient: FetchHttpClient;
  private readonly registry: RouteRegistry;

  private entityScope?: EntityScope;
  private profileScope?: number | string;
  private languageScope?: string;

  /**
   * Initializes a new GlpiClient instance.
   *
   * @param options Configuration options for GLPI connection, authentication, and HTTP transport.
   */
  constructor(options: GlpiClientOptions) {
    if (!options?.apiUrl || typeof options.apiUrl !== 'string' || options.apiUrl.trim() === '') {
      throw new GlpiError('GlpiClient requires a non-empty "apiUrl" option');
    }

    const rawApiUrl = options.apiUrl.trim().replace(/\/+$/, '');
    const restPath = options.restPath ?? '/v2';
    const normalizedRestPath = restPath.startsWith('/') ? restPath : `/${restPath}`;

    let rootBaseUrl: string;
    let restBaseUrl: string;

    if (rawApiUrl.endsWith(normalizedRestPath)) {
      restBaseUrl = rawApiUrl;
      rootBaseUrl = rawApiUrl.slice(0, -normalizedRestPath.length);
    } else {
      rootBaseUrl = rawApiUrl;
      restBaseUrl = `${rawApiUrl}${normalizedRestPath}`;
    }

    const commonHttpConfig = {
      proxy: options.proxy,
      useEnvProxy: options.useEnvProxy,
      noProxy: options.noProxy,
      dispatcher: options.dispatcher,
      fetch: options.fetch,
      timeout: options.timeout,
      logger: options.logger,
      headers: options.headers,
    };

    this.rootHttpClient = new FetchHttpClient({
      ...commonHttpConfig,
      baseUrl: rootBaseUrl,
    });

    this.restHttpClient = new FetchHttpClient({
      ...commonHttpConfig,
      baseUrl: restBaseUrl,
    });

    this.registry = new RouteRegistry(options.routes);

    // Initialize Auth Provider
    if (options.auth) {
      if ('getAccessToken' in options.auth && typeof options.auth.getAccessToken === 'function') {
        this.authProvider = options.auth;
      } else if (typeof options.auth === 'object' && 'type' in options.auth) {
        switch (options.auth.type) {
          case 'password':
            this.authProvider = new PasswordAuthProvider({
              ...options.auth,
              httpClient: this.rootHttpClient,
            });
            break;
          case 'authorization_code':
            this.authProvider = new AuthorizationCodeAuthProvider({
              ...options.auth,
              httpClient: this.rootHttpClient,
            });
            break;
          case 'client_credentials':
            this.authProvider = new ClientCredentialsAuthProvider({
              ...options.auth,
              httpClient: this.rootHttpClient,
            });
            break;
          default:
            throw new GlpiError(
              `Unsupported auth type: ${(options.auth as { type: unknown }).type}`
            );
        }
      }
    }

    // Configure auth injection and transparent 401 retry interceptors
    this.setupInterceptors(this.rootHttpClient);
    this.setupInterceptors(this.restHttpClient);

    // Instantiate domain resources and GraphQL client
    this.tickets = new TicketResource(this.restHttpClient, undefined, this.registry);
    this.computers = new ComputerResource(this.restHttpClient, undefined, this.registry);
    this.users = new UserResource(this.restHttpClient, undefined, this.registry);
    this.documents = new DocumentResource(this.restHttpClient, undefined, this.registry);
    this.graphql = new GraphqlClient(this.rootHttpClient, options.graphqlPath ?? '/GraphQL');
  }

  /**
   * Retrieves the configured authentication provider.
   */
  public get auth(): IAuthProvider | undefined {
    return this.authProvider;
  }

  /**
   * Retrieves the underlying REST HTTP client.
   */
  public get http(): IHttpClient {
    return this.restHttpClient;
  }

  /**
   * Retrieves the underlying REST HTTP client.
   */
  public getHttpClient(): IHttpClient {
    return this.restHttpClient;
  }

  /**
   * Retrieves the underlying root HTTP client (for /token and /GraphQL).
   */
  public getRootHttpClient(): IHttpClient {
    return this.rootHttpClient;
  }

  /**
   * Retrieves the route registry instance.
   */
  public getRegistry(): RouteRegistry {
    return this.registry;
  }

  /**
   * Retrieves the underlying root HTTP client.
   */
  public get rootHttp(): FetchHttpClient {
    return this.rootHttpClient;
  }

  /**
   * Retrieves the underlying REST HTTP client.
   */
  public get restHttp(): FetchHttpClient {
    return this.restHttpClient;
  }

  /**
   * Authenticates against the GLPI API and returns the active access token.
   *
   * @throws {GlpiAuthenticationError} When no authentication provider is configured or authentication fails.
   */
  public async login(): Promise<string> {
    if (!this.authProvider) {
      throw new GlpiAuthenticationError(
        'missing_auth_provider',
        'No authentication provider configured for this client'
      );
    }
    return await this.authProvider.getAccessToken();
  }

  /**
   * Logs out from the current GLPI session, destroying server-side session and clearing cached credentials.
   */
  public async logout(): Promise<void> {
    try {
      await this.restHttpClient.delete('/session');
    } catch {
      // Best-effort session invalidation on server
    } finally {
      if (this.authProvider) {
        await this.authProvider.logout();
      }
    }
  }

  /**
   * Obtains a generic resource service instance for the given resource name or alias.
   *
   * @typeParam T - Type representing the resource entity.
   * @param name - Resource alias (e.g. 'Ticket', 'Rack') or endpoint path.
   * @returns A new ResourceService instance configured with the client REST transport.
   */
  public resource<T = unknown>(name: string): ResourceService<T> {
    return new ResourceService<T>(this.restHttpClient, name, this.registry);
  }

  /**
   * Registers a new resource route alias or overrides an existing one.
   *
   * @param alias - Resource alias name (e.g. 'Rack', 'NetworkSwitch').
   * @param path - GLPI REST API route path (e.g. 'Assets/Rack').
   */
  public registerResource(alias: string, path: string): void {
    this.registry.register(alias, path);
  }

  /**
   * Scopes subsequent REST API requests to an entity and optional sub-entities.
   *
   * @param entityId - GLPI entity identifier, or undefined to clear entity scoping.
   * @param recursive - Whether to include sub-entities (defaults to false).
   */
  public setEntity(entityId?: number | string, recursive: boolean = false): this {
    if (entityId !== undefined && entityId !== null) {
      this.entityScope = { entityId, recursive };
      this.restHttpClient.setHeader('GLPI-Entity', String(entityId));
      this.restHttpClient.setHeader('GLPI-Entity-Recursive', String(recursive));
      this.rootHttpClient.setHeader('GLPI-Entity', String(entityId));
      this.rootHttpClient.setHeader('GLPI-Entity-Recursive', String(recursive));
    } else {
      this.entityScope = undefined;
      this.restHttpClient.removeHeader('GLPI-Entity');
      this.restHttpClient.removeHeader('GLPI-Entity-Recursive');
      this.rootHttpClient.removeHeader('GLPI-Entity');
      this.rootHttpClient.removeHeader('GLPI-Entity-Recursive');
    }
    return this;
  }

  /**
   * Returns current entity scoping settings, if active.
   */
  public getEntity(): EntityScope | undefined {
    return this.entityScope;
  }

  /**
   * Scopes subsequent REST API requests to a specific profile.
   *
   * @param profileId - GLPI profile identifier, or undefined to clear profile scoping.
   */
  public setProfile(profileId?: number | string): this {
    if (profileId !== undefined && profileId !== null) {
      this.profileScope = profileId;
      this.restHttpClient.setHeader('GLPI-Profile', String(profileId));
      this.rootHttpClient.setHeader('GLPI-Profile', String(profileId));
    } else {
      this.profileScope = undefined;
      this.restHttpClient.removeHeader('GLPI-Profile');
      this.rootHttpClient.removeHeader('GLPI-Profile');
    }
    return this;
  }

  /**
   * Returns current profile scoping setting, if active.
   */
  public getProfile(): number | string | undefined {
    return this.profileScope;
  }

  /**
   * Sets preferred language header (Accept-Language) for subsequent REST API requests.
   *
   * @param language - Language tag (e.g. 'en_US', 'fr_FR'), or undefined to clear.
   */
  public setLanguage(language?: string): this {
    if (language !== undefined && language !== null) {
      this.languageScope = language;
      this.restHttpClient.setHeader('Accept-Language', language);
      this.rootHttpClient.setHeader('Accept-Language', language);
    } else {
      this.languageScope = undefined;
      this.restHttpClient.removeHeader('Accept-Language');
      this.rootHttpClient.removeHeader('Accept-Language');
    }
    return this;
  }

  /**
   * Returns current language preference, if set.
   */
  public getLanguage(): string | undefined {
    return this.languageScope;
  }

  /**
   * Configures bearer token injection and 401 transparent retry interceptors on an HTTP client.
   */
  private setupInterceptors(httpClient: FetchHttpClient): void {
    httpClient.useRequestInterceptor(async (requestOpts) => {
      if (this.authProvider) {
        const isTokenPath =
          typeof requestOpts.path === 'string' && requestOpts.path.includes('/token');
        const sameOrigin = isSameOrigin(requestOpts.path, httpClient.getBaseUrl());
        if (!isTokenPath && sameOrigin) {
          const token = await this.authProvider.getAccessToken();
          if (token) {
            if (!requestOpts.headers) {
              requestOpts.headers = { Authorization: `Bearer ${token}` };
            } else if (requestOpts.headers instanceof Headers) {
              requestOpts.headers.set('Authorization', `Bearer ${token}`);
            } else if (Array.isArray(requestOpts.headers)) {
              const filtered = requestOpts.headers.filter(
                ([k]) => k.toLowerCase() !== 'authorization'
              );
              filtered.push(['Authorization', `Bearer ${token}`]);
              requestOpts.headers = filtered;
            } else {
              delete (requestOpts.headers as Record<string, string>)['authorization'];
              (requestOpts.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
            }
          }
        }
      }
      return requestOpts;
    });

    httpClient.useResponseInterceptor({
      onRejected: async (err: unknown, requestOpts?: HttpRequestOptions) => {
        const opts = requestOpts ?? (err as any)?.options;
        const isTokenPath = typeof opts?.path === 'string' && opts.path.includes('/token');
        const sameOrigin = opts ? isSameOrigin(opts.path, httpClient.getBaseUrl()) : false;

        if (
          err instanceof GlpiHttpError &&
          err.status === 401 &&
          opts &&
          !(opts as any)._retried &&
          !isTokenPath &&
          sameOrigin &&
          this.authProvider
        ) {
          (opts as any)._retried = true;
          await this.authProvider.invalidateToken();
          return await httpClient.request(opts);
        }

        throw err;
      },
    });
  }
}
