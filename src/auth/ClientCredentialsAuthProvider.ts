import { GlpiAuthenticationError } from '../errors/index.js';
import type { IHttpClient } from '../http/types.js';
import { InMemoryTokenStorage } from './storage.js';
import { TokenManager } from './TokenManager.js';
import { mapOAuthHttpError } from './utils.js';
import type {
  ClientCredentialsOptions,
  IAuthProvider,
  ITokenStorage,
  OAuthTokenResponse,
  TokenFetchResult,
} from './types.js';

/**
 * OAuth2 Client Credentials Grant provider for GLPI v2 (e.g. inventory agent scope).
 */
export class ClientCredentialsAuthProvider implements IAuthProvider {
  private readonly httpClient: IHttpClient;
  private readonly tokenEndpoint: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly scope?: string;
  private readonly tokenManager: TokenManager;

  constructor(options: ClientCredentialsOptions) {
    this.httpClient = options.httpClient;
    this.tokenEndpoint = options.tokenEndpoint ?? '/token';
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.scope = options.scope === 'all' ? 'inventory' : options.scope;

    const storage: ITokenStorage = options.storage ?? new InMemoryTokenStorage();
    this.tokenManager = new TokenManager(
      storage,
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
    await this.tokenManager.clearToken();
  }

  private async fetchToken(): Promise<TokenFetchResult> {
    const body: Record<string, string> = {
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    };
    if (this.scope) {
      body.scope = this.scope;
    }

    try {
      const response = await this.httpClient.request<OAuthTokenResponse>({
        method: 'POST',
        path: this.tokenEndpoint,
        body,
      });

      const data = response.data;
      const accessToken = data?.access_token ?? data?.accessToken;
      if (!data || !accessToken) {
        throw new GlpiAuthenticationError(
          data?.error,
          data?.error_description,
          'Client credentials authentication failed: response missing access_token'
        );
      }

      return {
        accessToken,
        refreshToken: data.refresh_token ?? data.refreshToken,
        expiresIn: data.expires_in ?? data.expiresIn,
        tokenType: data.token_type ?? data.tokenType,
        scope: data.scope,
      };
    } catch (err) {
      mapOAuthHttpError(err, 'Client credentials authentication failed');
    }
  }
}
