import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FetchHttpClient } from '../src/http/FetchHttpClient.js';
import {
  GlpiNotFoundError,
  GlpiRateLimitError,
  GlpiValidationError,
  GlpiHttpError,
} from '../src/errors/index.js';

describe('FetchHttpClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('normalizes_base_url_and_path_variations', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2/', fetch: mockFetch });
    await client.request({ method: 'GET', path: '/Assistance/Ticket' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://glpi.test/api.php/v2/Assistance/Ticket',
      expect.anything()
    );

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client2 = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    await client2.request({ method: 'GET', path: 'Assistance/Ticket' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://glpi.test/api.php/v2/Assistance/Ticket',
      expect.anything()
    );
  });

  it('handles absolute path URLs without prepending baseUrl', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    await client.request({ method: 'GET', path: 'https://other-auth.test/oauth/token' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://other-auth.test/oauth/token',
      expect.anything()
    );
  });

  it('appends query parameters correctly', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    await client.request({
      method: 'GET',
      path: '/Assistance/Ticket',
      params: { start: 0, limit: 10, sort: 'id:desc' },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://glpi.test/api.php/v2/Assistance/Ticket?start=0&limit=10&sort=id%3Adesc',
      expect.anything()
    );
  });

  it('ignores undefined and null query parameters', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    await client.request({
      method: 'GET',
      path: '/Assistance/Ticket',
      params: { start: 0, limit: undefined, filter: null, active: true },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://glpi.test/api.php/v2/Assistance/Ticket?start=0&active=true',
      expect.anything()
    );
  });

  it('merges default headers and per-request headers', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const client = new FetchHttpClient({
      baseUrl: 'https://glpi.test/api.php/v2',
      fetch: mockFetch,
      headers: { 'GLPI-Entity': '1' },
    });
    await client.request({
      method: 'GET',
      path: '/Assistance/Ticket',
      headers: { 'GLPI-Profile': '4' },
    });
    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders.get('glpi-entity')).toBe('1');
    expect(calledHeaders.get('glpi-profile')).toBe('4');
  });

  it('supports setHeader and removeHeader for default headers', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    client.setHeader('GLPI-Entity', '5');
    client.setHeader('Accept-Language', 'fr_FR');
    client.removeHeader('Accept-Language');

    await client.request({ method: 'GET', path: '/Assistance/Ticket' });
    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders.get('glpi-entity')).toBe('5');
    expect(calledHeaders.get('accept-language')).toBeNull();
  });

  it('serializes JSON body and sets application/json content-type', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    await client.request({
      method: 'POST',
      path: '/Assistance/Ticket',
      body: { name: 'New ticket', priority: 3 },
    });
    const call = mockFetch.mock.calls[0];
    expect(call[1].method).toBe('POST');
    expect(call[1].body).toBe(JSON.stringify({ name: 'New ticket', priority: 3 }));
    expect(call[1].headers.get('content-type')).toBe('application/json');
  });

  it('runs request and response interceptors', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: 'secret' }), { status: 200 }));
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });

    client.useRequestInterceptor(async (opts) => {
      opts.headers = { ...opts.headers, Authorization: 'Bearer token-123' };
      return opts;
    });

    const res = await client.request<{ data: string }>({ method: 'GET', path: '/test' });
    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders.get('authorization')).toBe('Bearer token-123');
    expect(res.data).toEqual({ data: 'secret' });
  });

  it('runs response interceptor onFulfilled to transform response data', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ count: 10 }), { status: 200 }));
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });

    client.useResponseInterceptor(async (res) => {
      return {
        ...res,
        data: { count: (res.data as { count: number }).count * 2 },
      };
    });

    const res = await client.request<{ count: number }>({ method: 'GET', path: '/count' });
    expect(res.data).toEqual({ count: 20 });
  });

  it('allows ejecting interceptors via returned unsubscribe function', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });

    const eject = client.useRequestInterceptor((opts) => {
      opts.headers = { ...opts.headers, 'X-Custom': 'added' };
      return opts;
    });

    await client.request({ method: 'GET', path: '/test1' });
    expect(mockFetch.mock.calls[0][1].headers.get('x-custom')).toBe('added');

    eject();

    await client.request({ method: 'GET', path: '/test2' });
    expect(mockFetch.mock.calls[1][1].headers.get('x-custom')).toBeNull();
  });

  it('allows response interceptor onRejected to recover from error', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }));
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ recovered: true }), { status: 200 }));

    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });

    client.useResponseInterceptor({
      onRejected: async (err) => {
        if (err instanceof GlpiHttpError && err.status === 401) {
          // Re-attempt request
          return client.request({ method: 'GET', path: '/recovered' });
        }
        throw err;
      },
    });

    const res = await client.request<{ recovered: boolean }>({ method: 'GET', path: '/original' });
    expect(res.data).toEqual({ recovered: true });
  });

  it('handles 204 No Content returning null data', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204, statusText: 'No Content' }));
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    const res = await client.request({ method: 'DELETE', path: '/session' });
    expect(res.status).toBe(204);
    expect(res.data).toBeNull();
  });

  it('supports rawResponse returning raw Response object in data', async () => {
    const rawMock = new Response('binary data stream', { status: 200 });
    mockFetch.mockResolvedValueOnce(rawMock);
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    const res = await client.request<Response>({ method: 'GET', path: '/download', rawResponse: true });
    expect(res.status).toBe(200);
    expect(res.data).toBe(rawMock);
  });

  it('maps 404 to GlpiNotFoundError', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404, statusText: 'Not Found' }));
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    await expect(client.request({ method: 'GET', path: '/Assistance/Ticket/999' }))
      .rejects.toThrow(GlpiNotFoundError);
  });

  it('maps 429 to GlpiRateLimitError with retryAfter', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Too Many Requests', {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'retry-after': '30' },
      })
    );
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    try {
      await client.request({ method: 'GET', path: '/Assistance/Ticket' });
      expect.unreachable('Should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GlpiRateLimitError);
      expect((err as GlpiRateLimitError).retryAfter).toBe(30);
    }
  });

  it('maps 400/422 to GlpiValidationError', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Validation failed', fields: { name: ['empty'] } }), {
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: { 'content-type': 'application/json' },
      })
    );
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    await expect(client.request({ method: 'POST', path: '/Assistance/Ticket', body: {} }))
      .rejects.toThrow(GlpiValidationError);
  });

  it('maps 500 to GlpiHttpError', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Internal Server Error' }), {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'application/json' },
      })
    );
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    try {
      await client.request({ method: 'GET', path: '/Assistance/Ticket' });
      expect.unreachable('Should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GlpiHttpError);
      expect((err as GlpiHttpError).status).toBe(500);
      expect((err as GlpiHttpError).statusText).toBe('Internal Server Error');
      expect((err as GlpiHttpError).body).toEqual({ message: 'Internal Server Error' });
    }
  });

  it('supports proxy options in Node undici dispatcher', async () => {
    const client = new FetchHttpClient({
      baseUrl: 'https://glpi.test/api.php/v2',
      proxy: 'http://corp-proxy:8080',
      fetch: mockFetch,
    });
    expect(client.getProxyOptions()).toEqual({ url: 'http://corp-proxy:8080' });
  });

  it('supports object proxy options', async () => {
    const client = new FetchHttpClient({
      baseUrl: 'https://glpi.test/api.php/v2',
      proxy: { url: 'http://corp-proxy:8080', auth: 'user:pass' },
      fetch: mockFetch,
    });
    expect(client.getProxyOptions()).toEqual({ url: 'http://corp-proxy:8080', auth: 'user:pass' });
  });

  it('resolves proxy from environment variables when useEnvProxy is true', async () => {
    const origHttps = process.env.HTTPS_PROXY;
    const orighttps = process.env.https_proxy;
    const origHttp = process.env.HTTP_PROXY;
    const orighttp = process.env.http_proxy;
    const origAll = process.env.ALL_PROXY;
    const origall = process.env.all_proxy;

    try {
      delete process.env.https_proxy;
      delete process.env.HTTP_PROXY;
      delete process.env.http_proxy;
      delete process.env.ALL_PROXY;
      delete process.env.all_proxy;
      process.env.HTTPS_PROXY = 'http://env-proxy.local:3128';

      const client = new FetchHttpClient({
        baseUrl: 'https://glpi.test/api.php/v2',
        useEnvProxy: true,
        fetch: mockFetch,
      });
      expect(client.getProxyOptions()).toEqual({ url: 'http://env-proxy.local:3128' });
    } finally {
      if (origHttps !== undefined) process.env.HTTPS_PROXY = origHttps; else delete process.env.HTTPS_PROXY;
      if (orighttps !== undefined) process.env.https_proxy = orighttps; else delete process.env.https_proxy;
      if (origHttp !== undefined) process.env.HTTP_PROXY = origHttp; else delete process.env.HTTP_PROXY;
      if (orighttp !== undefined) process.env.http_proxy = orighttp; else delete process.env.http_proxy;
      if (origAll !== undefined) process.env.ALL_PROXY = origAll; else delete process.env.ALL_PROXY;
      if (origall !== undefined) process.env.all_proxy = origall; else delete process.env.all_proxy;
    }
  });
});
