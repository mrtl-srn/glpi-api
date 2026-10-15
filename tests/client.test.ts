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
});

