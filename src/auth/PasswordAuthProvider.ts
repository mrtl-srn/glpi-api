import { GlpiAuthenticationError } from '../errors/index.js';
import type { IHttpClient } from '../http/types.js';
import { InMemoryTokenStorage } from './storage.js';
import { TokenManager } from './TokenManager.js';
import { mapOAuthHttpError } from './utils.js';
import type {
  IAuthProvider,
  ITokenStorage,
  OAuthTokenResponse,
  PasswordAuthOptions,
  TokenFetchResult,
} from './types.js';

/**
 * OAuth2 Resource Owner Password Credentials Grant provider for GLPI v2.
 *
 * GLPI's password grant returns access_token and expires_in but does not issue
 * a refresh_token. This provider retains credentials in memory and automatically
 * re-authenticates when the token expires or is invalidated.
 */
export class PasswordAuthProvider implements IAuthProvider {
  private readonly httpClient: IHttpClient;
  private readonly tokenEndpoint: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly username: string;
  private readonly password: string;
  private readonly scope?: string;
  private readonly tokenManager: TokenManager;

  constructor(options: PasswordAuthOptions) {
    this.httpClient = options.httpClient;
    this.tokenEndpoint = options.tokenEndpoint ?? '/token';
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.username = options.username;
    this.password = options.password;
    this.scope = options.scope;

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
      grant_type: 'password',
      username: this.username,
      password: this.password,
    };
    if (this.clientId) {
      body.client_id = this.clientId;
    }
    if (this.clientSecret) {
      body.client_secret = this.clientSecret;
    }
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
          'Password authentication failed: response missing access_token'
        );
      }

      return {
        accessToken,
        expiresIn: data.expires_in ?? data.expiresIn,
        tokenType: data.token_type ?? data.tokenType,
        scope: data.scope,
      };
    } catch (err) {
      mapOAuthHttpError(err, 'Password authentication failed');
    }
  }
}
