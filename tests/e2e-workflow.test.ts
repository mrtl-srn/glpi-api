import { describe, it, expect, vi } from 'vitest';
import { GlpiClient } from '../src/client.js';
import { rsql } from '../src/rsql/index.js';

describe('End-to-End Workflow (Mocked GLPI Server)', () => {
  it('authenticates, creates ticket, attaches document, queries with RSQL, and logs out', async () => {
    const fetchMock = vi.fn();

    // 1. Token exchange (POST /token)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'auth-token-xyz',
      expires_in: 3600,
      token_type: 'Bearer',
    }), { status: 200 }));

    // 2. Ticket creation (POST /v2/Assistance/Ticket)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      id: 1042,
      href: '/Assistance/Ticket/1042',
    }), { status: 201 }));

    // 3. Document upload (POST /v2/Management/Document)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      id: 501,
      href: '/Management/Document/501',
    }), { status: 201 }));

    // 4. Ticket query (GET /v2/Assistance/Ticket?filter=id==1042)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      { id: 1042, name: 'Printer Failure in Building A', status: 1 },
    ]), { status: 200, headers: { 'x-total-count': '1' } }));

    // 5. Logout (DELETE /v2/session)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
      auth: {
        type: 'password',
        clientId: 'app',
        clientSecret: 'secret',
        username: 'tech',
        password: 'password123',
      },
      fetch: fetchMock,
    });

    // Create ticket
    const ticketResult = await client.tickets.create({
      name: 'Printer Failure in Building A',
      content: 'Paper jam and offline indicator flashing red',
    });
    expect(ticketResult.id).toBe(1042);

    // Upload document
    const docResult = await client.documents.upload(
      { content: Buffer.from('photo data'), filename: 'error.jpg', mimeType: 'image/jpeg' },
      { name: 'Printer error screen', items_id: ticketResult.id, itemtype: 'Ticket' }
    );
    expect(docResult.id).toBe(501);

    // Query ticket
    const queryResult = await client.tickets.list({
      filter: rsql().eq('id', ticketResult.id),
    });
    expect(queryResult.total).toBe(1);
    expect(queryResult.data[0].id).toBe(1042);

    // Logout
    await client.logout();

    // Verify token was injected
    const ticketCall = fetchMock.mock.calls[1];
    expect(ticketCall[1].headers.get('authorization')).toBe('Bearer auth-token-xyz');
  });

  it('transparently recovers from 401 token expiry by re-authenticating and replaying request', async () => {
    const fetchMock = vi.fn();

    // 1. Initial token
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'old-token',
      expires_in: 3600,
    }), { status: 200 }));

    // 2. Request fails with 401
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    // 3. Silent re-auth with credentials
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'new-token',
      expires_in: 3600,
    }), { status: 200 }));

    // 4. Request retry succeeds
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, name: 'Recovered' }]), { status: 200 }));

    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
      auth: {
        type: 'password',
        clientId: 'app',
        clientSecret: 'secret',
        username: 'tech',
        password: 'password123',
      },
      fetch: fetchMock,
    });

    const list = await client.tickets.list();
    expect(list.data[0].name).toBe('Recovered');
  });

  it('transparently recovers from 401 token expiry during GraphQL operations', async () => {
    const fetchMock = vi.fn();

    // 1. Initial token
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'old-gql-token',
      expires_in: 3600,
    }), { status: 200 }));

    // 2. GraphQL query fails with 401
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    // 3. Silent re-auth with credentials
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'new-gql-token',
      expires_in: 3600,
    }), { status: 200 }));

    // 4. GraphQL query retry succeeds
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: { ticket: { id: 1042, name: 'Recovered Ticket' } }
    }), { status: 200 }));

    const client = new GlpiClient({
      apiUrl: 'https://glpi.corp.com/api.php',
      auth: {
        type: 'password',
        clientId: 'app',
        clientSecret: 'secret',
        username: 'tech',
        password: 'password123',
      },
      fetch: fetchMock,
    });

    const result = await client.graphql.query<{ ticket: { id: number; name: string } }>(
      'query { ticket(id: 1042) { id name } }'
    );
    expect(result.ticket.name).toBe('Recovered Ticket');
  });
});
