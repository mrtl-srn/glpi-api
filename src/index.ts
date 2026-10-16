export const VERSION = '2.0.1';

// Main Client
export { GlpiClient } from './client.js';
export type {
  GlpiClientOptions,
  GlpiAuthOption,
  EntityScope,
} from './client.js';

// Errors
export {
  GlpiError,
  GlpiHttpError,
  GlpiNotFoundError,
  GlpiValidationError,
  GlpiRateLimitError,
  GlpiAuthenticationError,
} from './errors/index.js';
export { GlpiGraphqlError } from './graphql/types.js';

// Logging
export { ConsoleLogger, NoopLogger } from './logger/index.js';
export type { ILogger } from './logger/index.js';

// HTTP Transport
export { FetchHttpClient } from './http/index.js';
export type {
  IHttpClient,
  HttpMethod,
  HttpRequestOptions,
  HttpResponse,
  RequestInterceptor,
  RequestInterceptorFn,
  RequestInterceptorObj,
  ResponseInterceptor,
  ResponseInterceptorFn,
  ResponseInterceptorObj,
  ProxyOptions,
  HttpClientConfig,
} from './http/index.js';

// Authentication
export {
  PasswordAuthProvider,
  AuthorizationCodeAuthProvider,
  ClientCredentialsAuthProvider,
  InMemoryTokenStorage,
  TokenManager,
} from './auth/index.js';
export type {
  IAuthProvider,
  ITokenStorage,
  TokenData,
  TokenFetchResult,
  TokenFetchFn,
  TokenManagerOptions,
  PasswordAuthOptions,
  AuthCodeOptions,
  ClientCredentialsOptions,
  OAuthTokenResponse,
} from './auth/index.js';

// RSQL Query Builder
export { rsql, RsqlBuilder, escapeValue } from './rsql/index.js';
export type { RsqlNested } from './rsql/index.js';

// REST Resources & Route Registry
export {
  RouteRegistry,
  DEFAULT_CORE_ROUTES,
  ResourceService,
  TicketResource,
  ComputerResource,
  UserResource,
  DocumentResource,
} from './resources/index.js';
export type {
  IResourceService,
  RequestOptions,
  ListParams,
  PaginatedResult,
  CreateOptions,
  CreateResult,
  UpdateOptions,
  DeleteOptions,
} from './resources/index.js';

// GraphQL Client
export { GraphqlClient } from './graphql/index.js';
export type {
  IGraphqlClient,
  GraphqlRequestOptions,
  GraphqlResponse,
  GraphqlErrorLocation,
  GraphqlError,
} from './graphql/index.js';

// Domain Models & Types
export {
  TicketStatus,
  TicketType,
} from './types/index.js';
export type {
  GlpiUser,
  GlpiTicket,
  GlpiComputer,
  GlpiDocument,
  GlpiSessionInfo,
  TicketStatusInfo,
  GlpiItemReference,
  GlpiEntityReference,
  TicketActorType,
  TicketActorRole,
  PriorityLevel,
  TicketTimelineItem,
  DocumentUploadFile,
  DocumentMetadata,
  DocumentDownloadResult,
} from './types/index.js';
