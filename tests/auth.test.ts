import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PasswordAuthProvider,
  AuthorizationCodeAuthProvider,
  ClientCredentialsAuthProvider,
  InMemoryTokenStorage,
  TokenManager,
} from '../src/auth/index.js';
import { IHttpClient, HttpResponse } from '../src/http/types.js';
import { GlpiAuthenticationError, GlpiHttpError } from '../src/errors/index.js';

describe('Auth Layer', () => {
  let mockHttp: IHttpClient;

  beforeEach(() => {
    mockHttp = {
      request: vi.fn(),
      useRequestInterceptor: vi.fn(),
      useResponseInterceptor: vi.fn(),
      setHeader: vi.fn(),
      removeHeader: vi.fn(),
    };
  });

  it('PasswordAuthProvider_authenticates_and_returns_token', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: {
        access_token: 'glpi-access-token-123',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    } as HttpResponse<any>);

    const provider = new PasswordAuthProvider({
      httpClient: mockHttp,
      tokenEndpoint: '/token',
      clientId: 'my-client',
      clientSecret: 'my-secret',
      username: 'glpi-user',
      password: 'glpi-password',
    });

    const token = await provider.getAccessToken();
    expect(token).toBe('glpi-access-token-123');
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/token',
        body: expect.objectContaining({
          grant_type: 'password',
          username: 'glpi-user',
          password: 'glpi-password',
        }),
      })
    );
  });

  it('PasswordAuthProvider_auto_refreshes_using_credentials', async () => {
    // Review Focus #1: GLPI password grant doesn't issue refresh_token.
    // Provider must silently re-auth using credentials when expired.
    let callCount = 0;
    (mockHttp.request as any).mockImplementation(async () => {
      callCount++;
      return {
        status: 200,
        data: {
          access_token: `token-${callCount}`,
          expires_in: 0, // Immediately expired
          token_type: 'Bearer',
        },
      };
    });

    const provider = new PasswordAuthProvider({
      httpClient: mockHttp,
      clientId: 'my-client',
      clientSecret: 'my-secret',
      username: 'glpi-user',
      password: 'glpi-password',
    });

    const token1 = await provider.getAccessToken();
    expect(token1).toBe('token-1');

    // Second call: token is expired, provider should re-authenticate with password
    const token2 = await provider.getAccessToken();
    expect(token2).toBe('token-2');
    expect(callCount).toBe(2);
  });

  it('TokenManager_deduplicates_concurrent_refresh_calls', async () => {
    // Review Focus #2: Thundering herd prevention
    let refreshCalls = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      refreshCalls++;
      await new Promise((r) => setTimeout(r, 50));
      return {
        accessToken: 'shared-new-token',
        expiresIn: 3600,
      };
    });

    const manager = new TokenManager(new InMemoryTokenStorage(), fetchFn);

    // Run 5 parallel calls
    const tokens = await Promise.all([
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
      manager.getToken(),
    ]);

    expect(tokens.every((t) => t === 'shared-new-token')).toBe(true);
    expect(refreshCalls).toBe(1);
  });

  it('AuthorizationCodeAuthProvider_exchanges_code_and_uses_refresh_token', async () => {
    (mockHttp.request as any)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'auth-code-access-1',
          refresh_token: 'auth-code-refresh-1',
          expires_in: 0,
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'auth-code-access-2',
          refresh_token: 'auth-code-refresh-2',
          expires_in: 3600,
        },
      });

    const provider = new AuthorizationCodeAuthProvider({
      httpClient: mockHttp,
      clientId: 'app',
      clientSecret: 'secret',
      code: 'initial-auth-code',
      redirectUri: 'https://app.test/callback',
    });

    const token1 = await provider.getAccessToken();
    expect(token1).toBe('auth-code-access-1');

    // Next call should use refresh_token grant
    const token2 = await provider.getAccessToken();
    expect(token2).toBe('auth-code-access-2');
    expect((mockHttp.request as any).mock.calls[1][0].body).toEqual(
      expect.objectContaining({
        grant_type: 'refresh_token',
        refresh_token: 'auth-code-refresh-1',
      })
    );
  });

  it('ClientCredentialsAuthProvider_requests_token_with_inventory_scope', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: {
        access_token: 'client-cred-token',
        expires_in: 3600,
      },
    });

    const provider = new ClientCredentialsAuthProvider({
      httpClient: mockHttp,
      clientId: 'inventory-agent',
      clientSecret: 'agent-secret',
      scope: 'inventory',
    });

    const token = await provider.getAccessToken();
    expect(token).toBe('client-cred-token');
    expect((mockHttp.request as any).mock.calls[0][0].body).toEqual(
      expect.objectContaining({
        grant_type: 'client_credentials',
        scope: 'inventory',
      })
    );
  });

  describe('InMemoryTokenStorage', () => {
    it('stores, retrieves, and clears token data', async () => {
      const storage = new InMemoryTokenStorage();
      expect(await storage.getToken()).toBeNull();

      await storage.setToken({
        accessToken: 'abc',
        expiresIn: 3600,
        refreshToken: 'ref',
      });

      const token = await storage.getToken();
      expect(token).toEqual({
        accessToken: 'abc',
        expiresIn: 3600,
        refreshToken: 'ref',
      });

      await storage.clearToken();
      expect(await storage.getToken()).toBeNull();
    });
  });

  describe('TokenManager lifecycle and edge cases', () => {
    it('proactively refreshes when within the 30s margin', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          accessToken: `token-${callCount}`,
          expiresIn: 25, // Within default 30s proactive margin
        };
      });

      const manager = new TokenManager(new InMemoryTokenStorage(), fetchFn);
      const token1 = await manager.getToken();
      expect(token1).toBe('token-1');

      // Next call should immediately refresh because 25s < 30s proactive margin
      const token2 = await manager.getToken();
      expect(token2).toBe('token-2');
      expect(callCount).toBe(2);
    });

    it('returns cached token when well within validity', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          accessToken: 'stable-token',
          expiresIn: 3600,
        };
      });

      const manager = new TokenManager(new InMemoryTokenStorage(), fetchFn);
      const token1 = await manager.getToken();
      const token2 = await manager.getToken();
      expect(token1).toBe('stable-token');
      expect(token2).toBe('stable-token');
      expect(callCount).toBe(1);
    });

    it('resets in-flight promise when fetchFn fails so retry is possible', async () => {
      let fail = true;
      const fetchFn = vi.fn().mockImplementation(async () => {
        if (fail) {
          throw new GlpiAuthenticationError('invalid_grant', 'Bad credentials');
        }
        return { accessToken: 'recovered-token', expiresIn: 3600 };
      });

      const manager = new TokenManager(new InMemoryTokenStorage(), fetchFn);
      await expect(manager.getToken()).rejects.toThrow(GlpiAuthenticationError);

      fail = false;
      const token = await manager.getToken();
      expect(token).toBe('recovered-token');
    });

    it('invalidateToken forces re-fetch on next getToken', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(async () => {
        callCount++;
        return { accessToken: `tok-${callCount}`, expiresIn: 3600 };
      });

      const manager = new TokenManager(new InMemoryTokenStorage(), fetchFn);
      expect(await manager.getToken()).toBe('tok-1');

      await manager.invalidateToken();
      expect(await manager.getToken()).toBe('tok-2');
      expect(callCount).toBe(2);
    });
  });

  describe('AuthorizationCodeAuthProvider edge cases', () => {
    it('throws GlpiAuthenticationError when neither code nor refreshToken is available', async () => {
      const provider = new AuthorizationCodeAuthProvider({
        httpClient: mockHttp,
        clientId: 'app',
      });

      await expect(provider.getAccessToken()).rejects.toThrow(GlpiAuthenticationError);
    });

    it('initializes directly from persisted refreshToken in options', async () => {
      (mockHttp.request as any).mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'recovered-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        },
      });

      const provider = new AuthorizationCodeAuthProvider({
        httpClient: mockHttp,
        clientId: 'app',
        refreshToken: 'persisted-refresh-token',
      });

      const token = await provider.getAccessToken();
      expect(token).toBe('recovered-access-token');
      expect((mockHttp.request as any).mock.calls[0][0].body).toEqual(
        expect.objectContaining({
          grant_type: 'refresh_token',
          refresh_token: 'persisted-refresh-token',
        })
      );
    });

    it('logout clears tokens and authorization material', async () => {
      (mockHttp.request as any).mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'auth-code-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        },
      });

      const provider = new AuthorizationCodeAuthProvider({
        httpClient: mockHttp,
        clientId: 'app',
        code: 'one-time-code',
      });

      await provider.getAccessToken();
      await provider.logout();

      // Subsequent call has no code (already used) and no refresh token (cleared by logout)
      await expect(provider.getAccessToken()).rejects.toThrow(GlpiAuthenticationError);
    });
  });

  describe('PasswordAuthProvider error handling', () => {
    it('throws GlpiAuthenticationError when token response is missing access_token', async () => {
      (mockHttp.request as any).mockResolvedValueOnce({
        status: 200,
        data: {
          error: 'invalid_client',
          error_description: 'Client authentication failed',
        },
      });

      const provider = new PasswordAuthProvider({
        httpClient: mockHttp,
        clientId: 'bad-client',
        username: 'user',
        password: 'pwd',
      });

      await expect(provider.getAccessToken()).rejects.toThrow(GlpiAuthenticationError);
    });

    it('translates GlpiHttpError 400 with oauth payload to GlpiAuthenticationError', async () => {
      (mockHttp.request as any).mockRejectedValueOnce(
        new GlpiHttpError(400, 'Bad Request', '/token', {
          error: 'invalid_grant',
          error_description: 'Bad credentials',
        })
      );

      const provider = new PasswordAuthProvider({
        httpClient: mockHttp,
        username: 'user',
        password: 'wrong-password',
      });

      await expect(provider.getAccessToken()).rejects.toThrow(GlpiAuthenticationError);
      try {
        (mockHttp.request as any).mockRejectedValueOnce(
          new GlpiHttpError(400, 'Bad Request', '/token', {
            error: 'invalid_grant',
            error_description: 'Bad credentials',
          })
        );
        await provider.getAccessToken();
      } catch (err) {
        expect(err).toBeInstanceOf(GlpiAuthenticationError);
        const authErr = err as GlpiAuthenticationError;
        expect(authErr.error).toBe('invalid_grant');
        expect(authErr.errorDescription).toBe('Bad credentials');
      }
    });

    it('logout clears stored token', async () => {
      (mockHttp.request as any)
        .mockResolvedValueOnce({
          status: 200,
          data: { access_token: 'tok-1', expires_in: 3600 },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: { access_token: 'tok-2', expires_in: 3600 },
        });

      const provider = new PasswordAuthProvider({
        httpClient: mockHttp,
        username: 'user',
        password: 'pwd',
      });

      expect(await provider.getAccessToken()).toBe('tok-1');
      await provider.logout();
      // After logout, token must be re-fetched with credentials
      expect(await provider.getAccessToken()).toBe('tok-2');
    });

    it('TokenManager getStoredToken returns a cloned object to prevent cache mutation', async () => {
      const storage = new InMemoryTokenStorage();
      const manager = new TokenManager(storage, async () => ({
        accessToken: 'orig-token',
        expiresIn: 3600,
      }));

      await manager.getToken();
      const stored = await manager.getStoredToken();
      expect(stored?.accessToken).toBe('orig-token');

      // Mutate returned object
      if (stored) {
        stored.accessToken = 'mutated';
      }

      const storedAgain = await manager.getStoredToken();
      expect(storedAgain?.accessToken).toBe('orig-token');
    });
  });
});
