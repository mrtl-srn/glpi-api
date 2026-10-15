import { GlpiAuthenticationError } from '../errors/index.js';
import { InMemoryTokenStorage } from './storage.js';
import type { ITokenStorage, TokenData, TokenFetchFn, TokenManagerOptions } from './types.js';

/**
 * Manages token lifetime, proactive expiry buffers, and single-flight
 * deduplication of concurrent token refresh calls.
 */
export class TokenManager {
  private readonly storage: ITokenStorage;
  private fetchFn?: TokenFetchFn;
  private readonly proactiveMarginSeconds: number;
  private refreshPromise: Promise<string> | null = null;
  private cachedToken: TokenData | null = null;

  constructor(
    storage: ITokenStorage = new InMemoryTokenStorage(),
    fetchFn?: TokenFetchFn,
    options?: TokenManagerOptions
  ) {
    this.storage = storage;
    this.fetchFn = fetchFn;
    this.proactiveMarginSeconds = options?.proactiveMarginSeconds ?? 30;
  }

  /**
   * Sets or updates the token fetch/refresh function.
   */
  setFetchFn(fetchFn: TokenFetchFn): void {
    this.fetchFn = fetchFn;
  }

  /**
   * Checks whether a token is expired or within the proactive refresh margin.
   */
  isExpired(token: TokenData): boolean {
    if (!token.accessToken) {
      return true;
    }
    if (token.expiresAt === undefined) {
      return false;
    }
    const marginMs = this.proactiveMarginSeconds * 1000;
    return Date.now() + marginMs >= token.expiresAt;
  }

  /**
   * Retrieves an active access token, executing a single deduplicated refresh if expired.
   */
  async getToken(): Promise<string> {
    // 1. If a refresh is currently running, await it to prevent thundering herds
    if (this.refreshPromise) {
      return await this.refreshPromise;
    }

    // 2. Check cached in-memory token
    if (this.cachedToken && !this.isExpired(this.cachedToken)) {
      return this.cachedToken.accessToken;
    }

    // 3. Initiate single-flight refresh lock synchronously before any awaits
    this.refreshPromise = this.executeRefresh();
    return await this.refreshPromise;
  }

  private async executeRefresh(): Promise<string> {
    try {
      // Check underlying storage in case token was refreshed elsewhere or loaded on startup
      const stored = await this.storage.getToken();
      if (stored && !this.isExpired(stored)) {
        this.cachedToken = stored;
        return stored.accessToken;
      }

      if (!this.fetchFn) {
        throw new GlpiAuthenticationError(
          'NO_FETCH_FN',
          'No token fetch function provided to TokenManager'
        );
      }

      const result = await this.fetchFn();
      if (!result || !result.accessToken) {
        throw new GlpiAuthenticationError(
          'INVALID_TOKEN_RESPONSE',
          'Token fetch function did not return an access token'
        );
      }

      const now = Date.now();
      const tokenData: TokenData = {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        expiresAt:
          result.expiresIn !== undefined ? now + result.expiresIn * 1000 : undefined,
        tokenType: result.tokenType,
        scope: result.scope,
      };

      await this.storage.setToken(tokenData);
      this.cachedToken = tokenData;
      return tokenData.accessToken;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Explicitly sets token data in both memory cache and storage.
   */
  async setToken(token: TokenData): Promise<void> {
    this.cachedToken = { ...token };
    await this.storage.setToken(token);
  }

  /**
   * Retrieves the currently stored token payload.
   */
  async getStoredToken(): Promise<TokenData | null> {
    if (this.cachedToken) {
      return { ...this.cachedToken };
    }
    const stored = await this.storage.getToken();
    if (stored) {
      this.cachedToken = stored;
      return { ...stored };
    }
    return null;
  }

  /**
   * Marks the current token as expired, forcing a refresh on the next getToken call
   * while preserving metadata (such as refreshToken).
   */
  async invalidateToken(): Promise<void> {
    const current = this.cachedToken ?? (await this.storage.getToken());
    if (current) {
      const expired: TokenData = {
        ...current,
        expiresAt: 0,
        expiresIn: 0,
      };
      this.cachedToken = expired;
      await this.storage.setToken(expired);
    } else {
      this.cachedToken = null;
      await this.storage.clearToken();
    }
  }

  /**
   * Completely clears all token data.
   */
  async clearToken(): Promise<void> {
    this.cachedToken = null;
    await this.storage.clearToken();
  }
}
