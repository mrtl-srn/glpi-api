import { GlpiAuthenticationError, GlpiHttpError } from '../errors/index.js';
import type { IHttpClient } from '../http/types.js';
import { InMemoryTokenStorage } from './storage.js';
import { TokenManager } from './TokenManager.js';
import type {
  AuthCodeOptions,
  IAuthProvider,
  ITokenStorage,
  OAuthTokenResponse,
  TokenFetchResult,
} from './types.js';

/**
 * OAuth2 Authorization Code Grant provider with refresh token rotation support.
 *
 * Supports initial authorization code exchange as well as session restoration
 * via persisted refresh tokens.
 */
export class AuthorizationCodeAuthProvider implements IAuthProvider {
  private readonly httpClient: IHttpClient;
  private readonly tokenEndpoint: string;
  private readonly clientId: string;
  private readonly clientSecret?: string;
  private readonly redirectUri?: string;
  private readonly scope?: string;
  private readonly storage: ITokenStorage;
  private readonly tokenManager: TokenManager;
  private code?: string;
  private refreshToken?: string;

  constructor(options: AuthCodeOptions) {
    this.httpClient = options.httpClient;
    this.tokenEndpoint = options.tokenEndpoint ?? '/token';
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.code = options.code;
    this.redirectUri = options.redirectUri;
    this.refreshToken = options.refreshToken;
    this.scope = options.scope;

    this.storage = options.storage ?? new InMemoryTokenStorage();
    this.tokenManager = new TokenManager(
      this.storage,
      () => this.fetchToken(),
      { proactiveMarginSeconds: options.proactiveMarginSeconds ?? 30 }
    );
  }

  async getAccessToken(): Promise<string> {
    return this.tokenManager.getToken();
  }

  async invalidateToken(): Promise<void> {
    await this.tokenManager.invalidateToken();
  }

  async logout(): Promise<void> {
    this.code = undefined;
    this.refreshToken = undefined;
    await this.tokenManager.clearToken();
  }

  private async fetchToken(): Promise<TokenFetchResult> {
    const stored = await this.storage.getToken();
    const activeRefreshToken = stored?.refreshToken ?? this.refreshToken;

    if (activeRefreshToken) {
      return this.executeRefresh(activeRefreshToken);
    }

    if (this.code) {
      return this.executeCodeExchange();
    }

    throw new GlpiAuthenticationError(
      'NO_AUTH_MATERIAL',
      'No authorization code or refresh token available to authenticate'
    );
  }

  private async executeRefresh(refreshToken: string): Promise<TokenFetchResult> {
    const body: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId,
    };
    if (this.clientSecret) {
      body.client_secret = this.clientSecret;
    }
    if (this.scope) {
      body.scope = this.scope;
    }

    const data = await this.postToken(body);
    const accessToken = data.access_token ?? data.accessToken;
    if (!accessToken) {
      throw new GlpiAuthenticationError(
        data.error,
        data.error_description,
        'Token refresh failed: response missing access_token'
      );
    }

    const newRefreshToken = data.refresh_token ?? data.refreshToken ?? refreshToken;
    this.refreshToken = newRefreshToken;

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: data.expires_in ?? data.expiresIn,
      tokenType: data.token_type ?? data.tokenType,
      scope: data.scope,
    };
  }

  private async executeCodeExchange(): Promise<TokenFetchResult> {
    const code = this.code!;
    this.code = undefined; // Single-use consumption

    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      client_id: this.clientId,
    };
    if (this.clientSecret) {
      body.client_secret = this.clientSecret;
    }
    if (this.redirectUri) {
      body.redirect_uri = this.redirectUri;
    }
    if (this.scope) {
      body.scope = this.scope;
    }

    const data = await this.postToken(body);
    const accessToken = data.access_token ?? data.accessToken;
    if (!accessToken) {
      throw new GlpiAuthenticationError(
        data.error,
        data.error_description,
        'Authorization code exchange failed: response missing access_token'
      );
    }

    const receivedRefreshToken = data.refresh_token ?? data.refreshToken;
    if (receivedRefreshToken) {
      this.refreshToken = receivedRefreshToken;
    }

    return {
      accessToken,
      refreshToken: receivedRefreshToken,
      expiresIn: data.expires_in ?? data.expiresIn,
      tokenType: data.token_type ?? data.tokenType,
      scope: data.scope,
    };
  }

  private async postToken(body: Record<string, string>): Promise<OAuthTokenResponse> {
    try {
      const response = await this.httpClient.request<OAuthTokenResponse>({
        method: 'POST',
        path: this.tokenEndpoint,
        body,
      });

      return response.data;
    } catch (err) {
      if (err instanceof GlpiAuthenticationError) {
        throw err;
      }
      if (err instanceof GlpiHttpError) {
        const bodyObj = (err.body && typeof err.body === 'object'
          ? err.body
          : undefined) as Record<string, unknown> | undefined;
        const oauthError = typeof bodyObj?.error === 'string' ? bodyObj.error : undefined;
        const errorDesc =
          typeof bodyObj?.error_description === 'string'
            ? bodyObj.error_description
            : typeof bodyObj?.message === 'string'
              ? bodyObj.message
              : err.message;
        throw new GlpiAuthenticationError(oauthError, errorDesc, errorDesc);
      }
      throw err;
    }
  }
}
