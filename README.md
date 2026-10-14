# GLPI API Client

[![npm version](https://badge.fury.io/js/glpi-api.svg)](https://badge.fury.io/js/glpi-api)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)

Modern, strictly typed TypeScript client for the [GLPI](https://glpi-project.org/) REST API (v2) and GraphQL endpoint.

Designed for Node.js 18+ with zero runtime dependencies, robust OAuth2 authentication, enterprise HTTP proxy support, a fluent RSQL query builder, and full TypeScript typings.

---

## Features

- **Zero Runtime Dependencies**: Built entirely on standard web APIs (`fetch`, `Headers`, `FormData`, `Blob`).
- **100% Strict TypeScript**: Complete type coverage, interfaces, and domain models for GLPI entities.
- **Dual ESM & CommonJS**: Seamlessly imports in both ES modules (`import`) and CommonJS (`require`).
- **Node.js 18+**: Native asynchronous streams, FormData, and AbortController timeout support.
- **Enterprise Proxy Support**: Connect through corporate HTTP/HTTPS proxies with automatic environment variable detection (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`).
- **Authentication & OAuth2**: Password, Authorization Code, and Client Credentials grant flows with transparent token refresh and deduplication.
- **Fluent RSQL Query Builder**: Construct complex search filters with full operator support and automatic escaping.
- **GraphQL Support**: Strongly typed GraphQL queries and mutations with comprehensive error handling.
- **Domain & Generic Resources**: Dedicated helpers for `tickets`, `computers`, `users`, and `documents` (multipart upload & binary download), plus generic access to any core or plugin resource.
- **Session Scoping**: Convenient entity, profile, and language scoping at client or request level.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Proxy Configuration](#proxy-configuration)
  - [Explicit Proxy URL](#explicit-proxy-url)
  - [Advanced Proxy Options](#advanced-proxy-options)
  - [Environment Variable Auto-Discovery](#environment-variable-auto-discovery)
  - [Bypassing Proxies with NO_PROXY / noProxy](#bypassing-proxies-with-no_proxy--noproxy)
  - [Custom Dispatcher](#custom-dispatcher)
- [Authentication](#authentication)
  - [1. Resource Owner Password Credentials](#1-resource-owner-password-credentials-password)
  - [2. Authorization Code Flow](#2-authorization-code-flow-authorization_code)
  - [3. Client Credentials Flow](#3-client-credentials-flow-client_credentials)
  - [Token Storage](#token-storage)
- [RSQL Query Builder](#rsql-query-builder)
  - [Supported Operators](#supported-operators)
- [Domain Resources](#domain-resources)
  - [Tickets (`client.tickets`)](#tickets-clienttickets)
  - [Computers (`client.computers`)](#computers-clientcomputers)
  - [Users (`client.users`)](#users-clientusers)
  - [Documents (`client.documents`)](#documents-clientdocuments)
- [Generic & Plugin Resources](#generic--plugin-resources)
  - [Using Core Endpoints](#using-core-endpoints)
  - [Registering Plugin Route Aliases](#registering-plugin-route-aliases)
- [GraphQL Queries](#graphql-queries)
- [Session Scoping](#session-scoping)
  - [Global Client Scoping](#global-client-scoping)
  - [Per-Request Scoping](#per-request-scoping)
- [Error Handling](#error-handling)
  - [Error Types Reference](#error-types-reference)
- [Migration from v1.x](#migration-from-v1x)
- [Changelog](#changelog)
- [License](#license)

---

## Installation

```bash
npm install glpi-api
```

---

## Quick Start

Here is a complete example demonstrating authentication, creating a ticket, uploading an attachment, querying with RSQL, and logging out:

```typescript
import { GlpiClient, rsql } from 'glpi-api';

// Initialize the GLPI client
const client = new GlpiClient({
  apiUrl: 'https://glpi.example.com/api.php',
  auth: {
    type: 'password',
    clientId: 'your-oauth-client-id',
    clientSecret: 'your-oauth-client-secret',
    username: 'technician',
    password: 'secure-password',
  },
});

async function main() {
  try {
    // 1. Create a support ticket
    const ticket = await client.tickets.create({
      name: 'Network Switch port flap in Rack B2',
      content: 'Port 12 is flapping continuously since 08:00 AM.',
      urgency: 4,
      priority: 4,
    });
    console.log(`Ticket created: #${ticket.id}`);

    // 2. Upload and attach a diagnostic log file to the ticket
    const logData = Buffer.from('Interface GigabitEthernet0/12 link down/up trap received');
    const attachment = await client.documents.upload(
      {
        content: logData,
        filename: 'switch-port-flapping.log',
        mimeType: 'text/plain',
      },
      {
        name: 'Switch Port Flap Syslog',
        items_id: ticket.id,
        itemtype: 'Ticket',
      }
    );
    console.log(`Document attached: #${attachment.id}`);

    // 3. Search tickets using the fluent RSQL builder
    const searchResults = await client.tickets.list({
      filter: rsql()
        .like('name', 'Network Switch%')
        .and(q => q.eq('status', 1).or().eq('status', 2)),
      sort: 'id:desc',
      limit: 10,
    });
    console.log(`Found ${searchResults.total} matching tickets:`);
    for (const item of searchResults.data) {
      console.log(` - [#${item.id}] ${item.name}`);
    }
  } catch (error) {
    console.error('GLPI API error:', error);
  } finally {
    // 4. Invalidate session and clear stored tokens
    await client.logout();
    console.log('Session closed.');
  }
}

main();
```

---

## Proxy Configuration

In corporate environments, outgoing requests often need to pass through an HTTP/HTTPS proxy. `glpi-api` provides multiple ways to configure proxy tunneling:

### Explicit Proxy URL

Pass a proxy URL string directly to the client configuration:

```typescript
const client = new GlpiClient({
  apiUrl: 'https://glpi.example.com/api.php',
  proxy: 'http://proxy.corp.internal:8080',
  auth: { /* ... */ },
});
```

### Advanced Proxy Options

Pass structured `ProxyOptions` to configure authentication or custom headers for the proxy:

```typescript
const client = new GlpiClient({
  apiUrl: 'https://glpi.example.com/api.php',
  proxy: {
    url: 'http://proxy.corp.internal:8080',
    headers: {
      'Proxy-Authorization': 'Basic ' + Buffer.from('user:pass').toString('base64'),
    },
  },
});
```

### Environment Variable Auto-Discovery

Enable `useEnvProxy: true` to automatically read proxy settings from system environment variables (`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, and their lowercase equivalents):

```typescript
const client = new GlpiClient({
  apiUrl: 'https://glpi.example.com/api.php',
  useEnvProxy: true,
  auth: { /* ... */ },
});
```

### Bypassing Proxies with `NO_PROXY` / `noProxy`

Target URLs can bypass configured proxies automatically or programmatically:

1. **Environment Variables**: `glpi-api` automatically evaluates standard `NO_PROXY` and `no_proxy` environment variables.
2. **Programmatic Bypass**: Pass `noProxy` as a string or array in `GlpiClientOptions` (or `ProxyOptions`), which overrides environment defaults:

```typescript
const client = new GlpiClient({
  apiUrl: 'https://glpi.corp.internal/api.php',
  proxy: 'http://proxy.corp.internal:8080',
  noProxy: ['localhost', '127.0.0.1', '.corp.internal', '192.168.0.0/16'],
  auth: { /* ... */ },
});
```

Supported bypass rule formats:
- **Wildcard (`*`)**: Bypasses proxy for all target URLs.
- **Domain suffixes (`.example.com`, `*.example.com`, `example.com`)**: Matches the host and subdomains.
- **Exact hostnames & IP addresses (`localhost`, `127.0.0.1`, `::1`, `[::1]`)**.
- **Port-specific rules (`host:port`, e.g. `glpi.internal:8443` or `[::1]:8080`)**.
- **IPv4 CIDR blocks (`192.168.0.0/16`, `10.0.0.0/8`)**.

### Custom Dispatcher

If you require an explicit HTTP agent or dispatcher (e.g. from `undici`):

```typescript
import { ProxyAgent } from 'undici';

const client = new GlpiClient({
  apiUrl: 'https://glpi.example.com/api.php',
  dispatcher: new ProxyAgent('http://proxy.corp.internal:8080'),
});
```

---

## Authentication

`glpi-api` supports all GLPI OAuth2 authentication flows with automatic proactive token refresh and concurrency-safe token deduplication.

### 1. Resource Owner Password Credentials (`password`)

```typescript
const client = new GlpiClient({
  apiUrl: 'https://glpi.example.com/api.php',
  auth: {
    type: 'password',
    clientId: 'my-client-id',
    clientSecret: 'my-client-secret',
    username: 'my-username',
    password: 'my-password',
    scope: 'all', // optional
  },
});
```

### 2. Authorization Code Flow (`authorization_code`)

```typescript
const client = new GlpiClient({
  apiUrl: 'https://glpi.example.com/api.php',
  auth: {
    type: 'authorization_code',
    clientId: 'my-client-id',
    clientSecret: 'my-client-secret',
    code: 'authorization-code-from-callback',
    redirectUri: 'https://my-app.example.com/oauth/callback',
  },
});
```

### 3. Client Credentials Flow (`client_credentials`)

```typescript
const client = new GlpiClient({
  apiUrl: 'https://glpi.example.com/api.php',
  auth: {
    type: 'client_credentials',
    clientId: 'my-service-account-id',
    clientSecret: 'my-service-account-secret',
    scope: 'inventory', // optional
  },
});
```

> **Note on GLPI 11 support:** In GLPI 11, the `client_credentials` grant is specifically restricted by GLPI core to agent inventory submissions (scope: `inventory`). Interacting with general REST resources (Tickets, Users, Computers, Documents, etc.) requires an authenticated GLPI user account via the `password` or `authorization_code` grant.


### Token Storage

By default, tokens are cached in memory. You can supply a custom token storage implementing `ITokenStorage` (e.g., Redis, database, encrypted file system):

```typescript
import type { ITokenStorage, TokenData } from 'glpi-api';

class RedisTokenStorage implements ITokenStorage {
  async getToken(): Promise<TokenData | null> {
    const raw = await redis.get('glpi:token');
    return raw ? JSON.parse(raw) : null;
  }

  async setToken(token: TokenData): Promise<void> {
    await redis.set('glpi:token', JSON.stringify(token));
  }

  async clearToken(): Promise<void> {
    await redis.del('glpi:token');
  }
}

const client = new GlpiClient({
  apiUrl: 'https://glpi.example.com/api.php',
  auth: {
    type: 'password',
    username: 'tech',
    password: 'secret',
    storage: new RedisTokenStorage(),
  },
});
```

---

## RSQL Query Builder

The GLPI REST API v2 uses RSQL (REST Query Language / FIQL) for advanced filtering. `glpi-api` includes a type-safe, fluent query builder via `rsql()`:

```typescript
import { rsql } from 'glpi-api';

// Simple equality
rsql().eq('status', 1).toString();
// => "status==1"

// Chained conditions (default separator is AND ';')
rsql().eq('status', 1).gt('urgency', 3).toString();
// => "status==1;urgency=gt=3"

// Pattern matching (LIKE / ILIKE)
rsql().like('name', 'Server*').toString();
// => "name=like=Server*"

// IN and NOT IN lists
rsql().in('status', [1, 2, 3]).toString();
// => "status=in=(1,2,3)"

// Null checks
rsql().isNotNull('solvedate').toString();
// => "solvedate=isnotnull="

// Logical OR (',') and nested groups
rsql()
  .eq('is_deleted', 0)
  .and(q => q.eq('status', 1).or().eq('status', 2))
  .toString();
// => "is_deleted==0;(status==1,status==2)"
```

### Supported Operators

| Method | Operator | Description |
| :--- | :--- | :--- |
| `.eq(field, val)` | `==` | Equal to |
| `.neq(field, val)` | `!=` | Not equal to |
| `.gt(field, val)` | `=gt=` | Greater than |
| `.ge(field, val)` | `=ge=` | Greater than or equal |
| `.lt(field, val)` | `=lt=` | Less than |
| `.le(field, val)` | `=le=` | Less than or equal |
| `.like(field, pattern)` | `=like=` | Pattern match (`*` wildcard) |
| `.ilike(field, pattern)` | `=ilike=` | Case-insensitive pattern match |
| `.in(field, values)` | `=in=` | In set |
| `.out(field, values)` | `=out=` | Not in set |
| `.isNull(field)` | `=isnull=` | Is null |
| `.isNotNull(field)` | `=isnotnull=` | Is not null |
| `.empty(field)` | `=empty=` | Is empty |
| `.notEmpty(field)` | `=notempty=` | Is not empty |
| `.and(nested?)` | `;` | Logical AND |
| `.or(nested?)` | `,` | Logical OR |

Special characters, spaces, and punctuation are automatically escaped and quoted.

---

## Domain Resources

`GlpiClient` provides dedicated domain resource properties with domain-specific helpers:

### Tickets (`client.tickets`)

```typescript
// List tickets with pagination and sorting
const result = await client.tickets.list({
  filter: rsql().eq('status', 1),
  sort: 'date_mod:desc',
  start: 0,
  limit: 20,
});

// Get a ticket by ID
const ticket = await client.tickets.get(1042);

// Create a new ticket
const created = await client.tickets.create({
  name: 'Workstation boot failure',
  content: 'Kernel panic on startup.',
  urgency: 4,
});

// Update a ticket
await client.tickets.update(1042, {
  status: 2, // In progress
});

// Add a followup comment to the ticket
await client.tickets.addFollowup(1042, 'Technician dispatched on site.');

// Assign an actor (technician, group, or supplier)
await client.tickets.assign(1042, 15, 'user');

// Retrieve ticket timeline (followups, tasks, solutions)
const timeline = await client.tickets.getTimeline(1042);

// Delete / purge a ticket
await client.tickets.delete(1042, { purge: true });
```

### Computers (`client.computers`)

```typescript
// Query computers
const computers = await client.computers.list({
  filter: rsql().like('name', 'SRV-%'),
});

// Fetch computer by ID
const computer = await client.computers.get(42);
```

### Users (`client.users`)

```typescript
// Query active users
const users = await client.users.list({
  filter: rsql().eq('is_active', 1),
});

// Fetch user profile by ID
const user = await client.users.get(15);

// Get current logged-in user details
const me = await client.users.me();
console.log(`Logged in as: ${me.name}`);

// Inspect session details (entities, active profile)
const session = await client.users.getSession();
```

### Documents (`client.documents`)

Upload files of any size via multipart/form-data from `Buffer`, `Uint8Array`, `Blob`, `string`, or `Stream`:

```typescript
// Upload a file
const upload = await client.documents.upload(
  {
    content: Buffer.from('Diagnostic report logs...'),
    filename: 'report.txt',
    mimeType: 'text/plain',
  },
  {
    name: 'Hardware Diagnostic Report',
    items_id: 1042,
    itemtype: 'Ticket',
  }
);

// Download binary document content
const download = await client.documents.download(upload.id);
console.log(`Downloaded: ${download.filename} (${download.contentType})`);
// download.data is an ArrayBuffer containing raw binary bytes
```

---

## Generic & Plugin Resources

GLPI has hundreds of native core items (e.g. `Monitor`, `NetworkEquipment`, `Software`, `Change`) and community plugins (e.g. `Rack`, `Formcreator`). You can access any GLPI resource using `client.resource()`:

### Using Core Endpoints

```typescript
interface GlpiMonitor {
  id: number;
  name: string;
  serial?: string;
}

const monitors = client.resource<GlpiMonitor>('Monitor');

// CRUD operations
const allMonitors = await monitors.list();
const singleMonitor = await monitors.get(12);
const created = await monitors.create({ name: 'Dell UltraSharp 27"' });
await monitors.update(created.id, { serial: 'CN-0ABCDE-12345' });
await monitors.delete(created.id);
```

### Registering Plugin Route Aliases

You can register custom aliases for plugin endpoints:

```typescript
// Register plugin routes
client.registerResource('Rack', 'PluginRack/Rack');

// Use registered alias
const racks = client.resource('Rack');
const rackList = await racks.list({ limit: 5 });
```

---

## GraphQL Queries

Execute arbitrary queries and mutations against GLPI's `/GraphQL` endpoint with strong typing and error handling:

```typescript
interface MyQueryResult {
  tickets: Array<{
    id: number;
    name: string;
    status: number;
  }>;
}

const result = await client.graphql.query<MyQueryResult>(
  `
    query GetOpenTickets($limit: Int!) {
      tickets(limit: $limit, where: { status: 1 }) {
        id
        name
        status
      }
    }
  `,
  { limit: 5 }
);

for (const t of result.tickets) {
  console.log(`Ticket #${t.id}: ${t.name}`);
}
```

---

## Session Scoping

GLPI supports multitenancy with entities, permissions via profiles, and multilingual responses. You can set session scoping globally on the client or override it on individual requests:

### Global Client Scoping

```typescript
// Set active entity (and recursively include sub-entities)
client.setEntity(3, true);

// Switch active profile
client.setProfile(4); // e.g., 'Super-Admin' or 'Technician'

// Set response language
client.setLanguage('fr_FR');

// Clear scoping
client.setEntity(undefined);
client.setProfile(undefined);
client.setLanguage(undefined);
```

### Per-Request Scoping

Pass scoping overrides in the `options` argument of any resource method:

```typescript
const ticketsInSubEntity = await client.tickets.list({
  filter: rsql().eq('status', 1),
  entity: 5,
  recursive: false,
  profile: 2,
  language: 'en_GB',
});
```

---

## Error Handling

All errors thrown by `glpi-api` inherit from `GlpiError`, allowing fine-grained error handling:

```typescript
import {
  GlpiError,
  GlpiHttpError,
  GlpiNotFoundError,
  GlpiValidationError,
  GlpiRateLimitError,
  GlpiAuthenticationError,
  GlpiGraphqlError,
} from 'glpi-api';

try {
  await client.tickets.get(999999);
} catch (error) {
  if (error instanceof GlpiNotFoundError) {
    console.error(`Resource not found at: ${error.url}`);
  } else if (error instanceof GlpiValidationError) {
    console.error('Validation failed on fields:', error.errors);
  } else if (error instanceof GlpiRateLimitError) {
    console.warn(`Rate limited. Retry after ${error.retryAfter} seconds.`);
  } else if (error instanceof GlpiAuthenticationError) {
    console.error(`Authentication error: ${error.error} - ${error.errorDescription}`);
  } else if (error instanceof GlpiGraphqlError) {
    console.error('GraphQL errors:', error.errors);
  } else if (error instanceof GlpiHttpError) {
    console.error(`HTTP Error ${error.status} ${error.statusText}: ${error.url}`);
    console.error('Response body:', error.body);
  } else if (error instanceof GlpiError) {
    console.error('General GLPI Error:', error.message);
  } else {
    throw error;
  }
}
```

### Error Types Reference

- `GlpiError`: Base class for all library errors.
- `GlpiHttpError`: Thrown for non-2xx HTTP responses (`status`, `statusText`, `url`, `body`).
- `GlpiNotFoundError`: Thrown when a resource does not exist (HTTP 404).
- `GlpiValidationError`: Thrown on validation or unprocessable entity failures (HTTP 400 / 422). Exposes `errors` field map.
- `GlpiRateLimitError`: Thrown when rate limited (HTTP 429). Exposes `retryAfter` in seconds.
- `GlpiAuthenticationError`: Thrown on OAuth2 authentication and authorization failures (`error`, `errorDescription`).
- `GlpiGraphqlError`: Thrown when GraphQL execution returns one or more errors (`errors` array).

---

## Migration from v1.x

Version 2.0.0 is a complete TypeScript rewrite modernizing the library for the current GLPI REST API (v2) and GraphQL:

- **Class Name**: Use `GlpiClient` instead of the legacy `GlpiApi`.
- **Modern API Architecture**: Native Promise-based `async`/`await` interface throughout.
- **Modern Authentication**: Standards-compliant OAuth2 flows replace legacy manual `initSession` / session token handling.
- **Zero Runtime Dependencies**: Replaces deprecated dependencies (`request`, `request-promise-native`, `qs`, `lodash`) with native Node 18+ Web Standards.
- **Dual Bundling**: Native support for ESM (`import`) and CommonJS (`require`).
- **Full Type Safety**: Complete TypeScript definitions included without needing third-party `@types/` packages.

For a full list of breaking changes and new features, see the [CHANGELOG.md](CHANGELOG.md).

---

## Changelog

Detailed release notes and migration guides are maintained in [CHANGELOG.md](CHANGELOG.md).

---

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
