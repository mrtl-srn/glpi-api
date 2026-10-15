import type { IHttpClient } from '../http/types.js';

/**
 * Standard contract for authentication providers in the GLPI API client.
 */
export interface IAuthProvider {
  /**
   * Retrieves an active OAuth2 access token, transparently refreshing if needed.
   */
  getAccessToken(): Promise<string>;

  /**
   * Invalidates the current access token, forcing a refresh on the next request.
   */
  invalidateToken(): Promise<void>;

  /**
   * Clears all session tokens and authentication state.
   */
  logout(): Promise<void>;
}

/**
 * Stored token payload.
 */
export interface TokenData {
  accessToken: string;
  expiresIn?: number;
  expiresAt?: number;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
}

/**
 * Result returned by a token fetch/refresh function.
 */
export interface TokenFetchResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  scope?: string;
  [key: string]: unknown;
}

/**
 * Function that executes token acquisition/refresh over HTTP.
 */
export type TokenFetchFn = () => Promise<TokenFetchResult>;

/**
 * Configuration options for TokenManager.
 */
export interface TokenManagerOptions {
  /**
   * Seconds before actual expiration at which a token is proactively considered expired.
   * Defaults to 30 seconds.
   */
  proactiveMarginSeconds?: number;
}

/**
 * Storage backend interface for persisting OAuth tokens.
 */
export interface ITokenStorage {
  getToken(): Promise<TokenData | null>;
  setToken(token: TokenData): Promise<void>;
  clearToken(): Promise<void>;
}

/**
 * Options for PasswordAuthProvider.
 */
export interface PasswordAuthOptions {
  httpClient: IHttpClient;
  clientId?: string;
  clientSecret?: string;
  username: string;
  password: string;
  tokenEndpoint?: string;
  scope?: string;
  storage?: ITokenStorage;
  proactiveMarginSeconds?: number;
}

/**
 * Options for AuthorizationCodeAuthProvider.
 */
export interface AuthCodeOptions {
  httpClient: IHttpClient;
  clientId: string;
  clientSecret?: string;
  code?: string;
  redirectUri?: string;
  refreshToken?: string;
  tokenEndpoint?: string;
  scope?: string;
  storage?: ITokenStorage;
  proactiveMarginSeconds?: number;
}

/**
 * Options for ClientCredentialsAuthProvider.
 */
export interface ClientCredentialsOptions {
  httpClient: IHttpClient;
  clientId: string;
  clientSecret: string;
  scope?: string;
  tokenEndpoint?: string;
  storage?: ITokenStorage;
  proactiveMarginSeconds?: number;
}

/**
 * Raw OAuth2 token endpoint response payload.
 */
export interface OAuthTokenResponse {
  access_token?: string;
  accessToken?: string;
  token_type?: string;
  tokenType?: string;
  expires_in?: number;
  expiresIn?: number;
  refresh_token?: string;
  refreshToken?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  [key: string]: unknown;
}
