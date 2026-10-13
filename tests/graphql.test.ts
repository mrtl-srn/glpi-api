import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphqlClient } from '../src/graphql/GraphqlClient.js';
import { IHttpClient } from '../src/http/types.js';
import { GlpiError, GlpiHttpError } from '../src/errors/index.js';
import { GlpiGraphqlError } from '../src/graphql/types.js';

describe('GraphqlClient', () => {
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

  it('executes GraphQL query and returns data', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: {
        data: {
          tickets: [{ id: '1', name: 'GLPI Issue' }],
        },
      },
    });

    const client = new GraphqlClient(mockHttp, '/GraphQL');
    const result = await client.query<{ tickets: Array<{ id: string; name: string }> }>(
      'query GetTickets { tickets { id name } }'
    );

    expect(result.tickets).toEqual([{ id: '1', name: 'GLPI Issue' }]);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/GraphQL',
        body: {
          query: 'query GetTickets { tickets { id name } }',
          variables: undefined,
        },
      })
    );
  });

  it('uses default path /GraphQL when not specified in constructor', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: {
        data: { ping: 'pong' },
      },
    });

    const client = new GraphqlClient(mockHttp);
    expect(client.path).toBe('/GraphQL');

    const result = await client.query<{ ping: string }>('{ ping }');
    expect(result.ping).toBe('pong');
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/GraphQL',
      })
    );
  });

  it('uses custom path when specified in constructor', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: {
        data: { ping: 'pong' },
      },
    });

    const client = new GraphqlClient(mockHttp, '/api.php/GraphQL');
    expect(client.path).toBe('/api.php/GraphQL');

    await client.query('{ ping }');
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api.php/GraphQL',
      })
    );
  });

  it('passes variables in request body', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: {
        data: {
          ticket: { id: '42', name: 'Printer Issue' },
        },
      },
    });

    const client = new GraphqlClient(mockHttp);
    const result = await client.query<{ ticket: { id: string; name: string } }>(
      'query GetTicket($id: ID!) { ticket(id: $id) { id name } }',
      { id: '42' }
    );

    expect(result.ticket.id).toBe('42');
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/GraphQL',
        body: {
          query: 'query GetTicket($id: ID!) { ticket(id: $id) { id name } }',
          variables: { id: '42' },
        },
      })
    );
  });

  it('includes operationName in body when specified in options', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: {
        data: { result: true },
      },
    });

    const client = new GraphqlClient(mockHttp);
    await client.query(
      'query OpA { a } query OpB { b }',
      { test: true },
      { operationName: 'OpB' }
    );

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/GraphQL',
        body: {
          query: 'query OpA { a } query OpB { b }',
          variables: { test: true },
          operationName: 'OpB',
        },
      })
    );
  });

  it('forwards custom headers and abort signal in options', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: {
        data: { result: true },
      },
    });

    const controller = new AbortController();
    const client = new GraphqlClient(mockHttp);

    await client.query(
      '{ result }',
      undefined,
      {
        headers: { 'X-Correlation-ID': 'corr-123' },
        signal: controller.signal,
      }
    );

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'X-Correlation-ID': 'corr-123' },
        signal: controller.signal,
      })
    );
  });

  it('throws GlpiError when response contains GraphQL errors', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: {
        errors: [{ message: 'Field "unknown" not found', locations: [] }],
      },
    });

    const client = new GraphqlClient(mockHttp, '/GraphQL');
    await expect(client.query('{ unknown }')).rejects.toThrow(GlpiError);
  });

  it('formats multiple GraphQL errors and attaches error details', async () => {
    const graphqlErrors = [
      { message: 'Field "unknown" not found', locations: [{ line: 1, column: 3 }] },
      { message: 'Syntax error', path: ['field'] },
    ];

    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: {
        errors: graphqlErrors,
      },
    });

    const client = new GraphqlClient(mockHttp);

    try {
      await client.query('{ unknown }');
      expect.unreachable('Should have thrown an error');
    } catch (err) {
      expect(err).toBeInstanceOf(GlpiError);
      expect(err).toBeInstanceOf(GlpiGraphqlError);
      const gqlErr = err as GlpiGraphqlError;
      expect(gqlErr.message).toBe('Field "unknown" not found; Syntax error');
      expect(gqlErr.errors).toEqual(graphqlErrors);
    }
  });

  it('handles fallback message when GraphQL error has no message string', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: {
        errors: [{} as any],
      },
    });

    const client = new GraphqlClient(mockHttp);
    await expect(client.query('{ test }')).rejects.toThrow('Unknown GraphQL error');
  });

  it('throws GlpiError when response payload is null or not an object', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: null,
    });

    const client = new GraphqlClient(mockHttp);
    await expect(client.query('{ test }')).rejects.toThrow(
      'Invalid GraphQL response: payload is not an object'
    );
  });

  it('throws GlpiError when response payload is a primitive string', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: 'Gateway Timeout',
    });

    const client = new GraphqlClient(mockHttp);
    await expect(client.query('{ test }')).rejects.toThrow(
      'Invalid GraphQL response: payload is not an object'
    );
  });

  it('throws GlpiError when response is missing both data and errors', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: {},
    });

    const client = new GraphqlClient(mockHttp);
    await expect(client.query('{ test }')).rejects.toThrow(
      'Invalid GraphQL response: missing "data" field'
    );
  });

  it('returns data when data is null without errors', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      data: {
        data: null,
      },
    });

    const client = new GraphqlClient(mockHttp);
    const result = await client.query('{ ticket(id: "non-existent") { id } }');
    expect(result).toBeNull();
  });

  it('propagates network or HTTP error from underlying http client', async () => {
    (mockHttp.request as any).mockRejectedValueOnce(
      new GlpiHttpError(500, 'Internal Server Error', '/GraphQL')
    );

    const client = new GraphqlClient(mockHttp);
    await expect(client.query('{ tickets }')).rejects.toThrow(GlpiHttpError);
  });
});
