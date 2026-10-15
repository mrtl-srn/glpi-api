import type { ITokenStorage, TokenData } from './types.js';

/**
 * In-memory implementation of ITokenStorage.
 */
export class InMemoryTokenStorage implements ITokenStorage {
  private token: TokenData | null;

  constructor(initialToken?: TokenData | null) {
    this.token = initialToken ? { ...initialToken } : null;
  }

  async getToken(): Promise<TokenData | null> {
    return this.token ? { ...this.token } : null;
  }

  async setToken(token: TokenData): Promise<void> {
    this.token = { ...token };
  }

  async clearToken(): Promise<void> {
    this.token = null;
  }
}
