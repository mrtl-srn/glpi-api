# GLPI API 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely rebuild `glpi-api` into version 2.0 as a pure TypeScript, SOLID-compliant, zero-runtime-dependency client library supporting GLPI High-Level REST API (v2 / v2.3), OAuth2, RSQL querying, GraphQL, proxy routing, and document management.

**Architecture:** The client is built in discrete, loosely coupled layers adhering to SOLID principles: an abstract HTTP transport (`IHttpClient`) using native `fetch` with request/response interceptors and proxy dispatcher support; an OAuth2 authentication engine (`IAuthProvider`) supporting Password, Authorization Code, and Client Credentials grants with proactive and reactive token refresh; a fluent RSQL query builder; a generic extensible resource service (`ResourceService<T>`) alongside specialized domain services (`TicketResource`, `ComputerResource`, `UserResource`, `DocumentResource`); and a unified entrypoint (`GlpiClient`).

**Tech Stack:** TypeScript (strict mode), Node.js (>= 18), `tsup` (dual ESM/CJS build + `.d.ts` generation), `vitest` (fast unit and integration testing with mocked fetch).

**Spec:** [docs/superpowers/specs/2026-10-13-glpi-api-v2-design.md](file:///workspaces/glpi-api/docs/superpowers/specs/2026-10-13-glpi-api-v2-design.md)

## Global Constraints

- 100% TypeScript with strict type checking enabled (`strict: true`, no implicit `any`).
- Zero external runtime HTTP dependencies; uses standard global `fetch` with optional `undici.ProxyAgent` dispatcher in Node for proxies.
- No bundling of the 9MB `api-openapi.json` at runtime; only compile-time TypeScript interfaces.
- Dual package output: CommonJS (`dist/index.cjs`) and ESM (`dist/index.mjs`) with TypeScript declarations (`dist/index.d.ts`).
- Clean break from legacy 1.x API: no legacy methods (`getItem`, `addItems`, `initSession`, `killSession`).
- GLPI High-Level REST endpoints follow hierarchical paths (e.g. `/Assistance/Ticket`, `/Assets/Computer`, `/Administration/User`, `/Management/Document`).
- Session scoping (Entity, Profile, Recursive, Language) is handled statelessly via HTTP request headers (`GLPI-Entity`, `GLPI-Profile`, `GLPI-Entity-Recursive`, `Accept-Language`).

## Review Focus

The five edge cases and failure modes most likely to affect users in production:
1. **Password grant token auto-refresh without refresh token**: GLPI v2 password grant returns `access_token` and `expires_in` but *no* `refresh_token`. The auth provider must retain credentials in memory to silently re-authenticate when expired.
   - Pinned in: Task 4, Step 1 (`tests/auth.test.ts::PasswordAuthProvider_auto_refreshes_using_credentials`)
2. **Concurrent requests during token refresh (thundering herd prevention)**: When multiple parallel requests encounter an expired token or a 401 response simultaneously, only one refresh/auth flight must run, and all pending requests must await that single resolution.
   - Pinned in: Task 4, Step 1 (`tests/auth.test.ts::TokenManager_deduplicates_concurrent_refresh_calls`)
3. **Special characters and quoting in RSQL query values**: Filters containing spaces, commas, semicolons, single quotes, or wildcards (e.g. `name == 'Printer; Color & Wireless'`) must be properly quoted and escaped so they do not break RSQL syntax.
   - Pinned in: Task 5, Step 1 (`tests/rsql.test.ts::escapes_and_quotes_special_characters`)
4. **URL concatenation variations in `apiUrl`**: Base URLs with or without trailing slash (`https://glpi.example/api.php` vs `https://glpi.example/api.php/` vs `https://glpi.example/api.php/v2`) and relative paths with or without leading slash must be normalized without producing double slashes or missing `/v2/` prefixes.
   - Pinned in: Task 3, Step 1 (`tests/http.test.ts::normalizes_base_url_and_path_variations`)
5. **Document upload with different Node.js input types**: File uploads must accept `Buffer`, `Blob`, `Uint8Array`, and filesystem streams, correctly formatting them into `FormData` with appropriate filename and content headers.
   - Pinned in: Task 7, Step 1 (`tests/domain-resources.test.ts::DocumentResource_upload_handles_buffer_blob_and_stream`)

---

### Task 1: Project Setup, Toolchain, and Build Infrastructure

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: Node.js runtime (>= 18.0.0), npm.
- Produces: Build scripts (`npm run build`, `npm run typecheck`, `npm test`), package configuration for dual ESM/CJS output with type definitions, and initial `src/index.ts`.

- [ ] **Step 1: Write the failing smoke test**

```typescript
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('Smoke test', () => {
  it('should export version 2.0.0', () => {
    expect(VERSION).toBe('2.0.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL (vitest not installed, `src/index.ts` not created).

- [ ] **Step 3: Configure `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, and `src/index.ts`**

Update `package.json`:
- Bump `version` to `"2.0.0"`
- Set `"type": "module"`
- Set `"main": "./dist/index.cjs"`
- Set `"module": "./dist/index.mjs"`
- Set `"types": "./dist/index.d.ts"`
- Set `"exports"`:
  ```json
  {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.mjs"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    }
  }
  ```
- Remove deprecated runtime dependencies (`request`, `request-promise-native`, `lodash`, `debug`, `qs`).
- Remove deprecated devDependencies (`mocha`, `chai`, `nyc`, `nock`, `jsdoc`, `docdash`).
- Add devDependencies: `typescript` (^5.6.3), `tsup` (^8.3.5), `vitest` (^2.1.3), `@types/node` (^22.7.5).
- Add scripts: `"build": "tsup"`, `"test": "vitest run"`, `"test:watch": "vitest"`, `"typecheck": "tsc --noEmit"`.

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

Create `tsup.config.ts`:
```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
});
```

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

Create minimal `src/index.ts`:
```typescript
export const VERSION = '2.0.0';
```

Install dependencies: `npm install`.

- [ ] **Step 4: Run test and build to verify it passes**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS with 1 test passed; `dist/index.cjs`, `dist/index.mjs`, and `dist/index.d.ts` created.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsup.config.ts vitest.config.ts src/index.ts tests/smoke.test.ts
git commit -m "chore: setup TypeScript, tsup build pipeline, and vitest test runner"
```

---

### Task 2: Error Hierarchy and Logging Infrastructure

**Files:**
- Create: `src/errors/index.ts`
- Create: `src/logger/index.ts`
- Test: `tests/errors.test.ts`
- Test: `tests/logger.test.ts`

**Interfaces:**
- Consumes: None.
- Produces:
  - Error classes:
    - `GlpiError extends Error` (base class)
    - `GlpiHttpError extends GlpiError` (`status: number`, `statusText: string`, `url: string`, `body?: unknown`)
    - `GlpiAuthenticationError extends GlpiError` (`error?: string`, `errorDescription?: string`)
    - `GlpiNotFoundError extends GlpiHttpError`
    - `GlpiValidationError extends GlpiHttpError` (`errors?: Record<string, string[]> | unknown`)
    - `GlpiRateLimitError extends GlpiHttpError` (`retryAfter?: number`)
  - Logging interfaces & implementations:
    - `ILogger` (`debug(msg, ...meta)`, `info(msg, ...meta)`, `warn(msg, ...meta)`, `error(msg, ...meta)`)
    - `NoopLogger implements ILogger` (silent default)
    - `ConsoleLogger implements ILogger`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/errors.test.ts
import { describe, it, expect } from 'vitest';
import {
  GlpiError,
  GlpiHttpError,
  GlpiAuthenticationError,
  GlpiNotFoundError,
  GlpiValidationError,
  GlpiRateLimitError,
} from '../src/errors/index.js';

describe('Error Hierarchy', () => {
  it('GlpiError should be base error', () => {
    const err = new GlpiError('Base error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GlpiError);
    expect(err.name).toBe('GlpiError');
    expect(err.message).toBe('Base error');
  });

  it('GlpiHttpError should contain status, statusText, url, body', () => {
    const err = new GlpiHttpError(500, 'Internal Server Error', 'https://glpi.test/api', { message: 'DB down' });
    expect(err).toBeInstanceOf(GlpiError);
    expect(err.status).toBe(500);
    expect(err.statusText).toBe('Internal Server Error');
    expect(err.url).toBe('https://glpi.test/api');
    expect(err.body).toEqual({ message: 'DB down' });
  });

  it('GlpiNotFoundError should inherit from GlpiHttpError with status 404', () => {
    const err = new GlpiNotFoundError('https://glpi.test/api/Ticket/999');
    expect(err).toBeInstanceOf(GlpiHttpError);
    expect(err.status).toBe(404);
    expect(err.name).toBe('GlpiNotFoundError');
  });

  it('GlpiValidationError should parse field error details', () => {
    const err = new GlpiValidationError('https://glpi.test/api/Ticket', { name: ['Required'] });
    expect(err).toBeInstanceOf(GlpiHttpError);
    expect(err.status).toBe(422);
    expect(err.errors).toEqual({ name: ['Required'] });
  });

  it('GlpiRateLimitError should store retryAfter seconds', () => {
    const err = new GlpiRateLimitError('https://glpi.test/api', 60);
    expect(err).toBeInstanceOf(GlpiHttpError);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(60);
  });

  it('GlpiAuthenticationError should capture OAuth2 error fields', () => {
    const err = new GlpiAuthenticationError('invalid_grant', 'Invalid credentials');
    expect(err).toBeInstanceOf(GlpiError);
    expect(err.error).toBe('invalid_grant');
    expect(err.errorDescription).toBe('Invalid credentials');
  });
});
```

```typescript
// tests/logger.test.ts
import { describe, it, expect, vi } from 'vitest';
import { NoopLogger, ConsoleLogger } from '../src/logger/index.js';

describe('Logger', () => {
  it('NoopLogger should not throw and output nothing', () => {
    const logger = new NoopLogger();
    expect(() => {
      logger.debug('test');
      logger.info('test');
      logger.warn('test');
      logger.error('test');
    }).not.toThrow();
  });

  it('ConsoleLogger should log messages to console', () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = new ConsoleLogger();
    logger.info('hello world');
    expect(logSpy).toHaveBeenCalledWith('[glpi-api] hello world');
    logSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test tests/errors.test.ts tests/logger.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement Error classes and Logger classes**

Create `src/errors/index.ts`:
- Define `GlpiError`, `GlpiHttpError`, `GlpiAuthenticationError`, `GlpiNotFoundError`, `GlpiValidationError`, `GlpiRateLimitError`.

Create `src/logger/index.ts`:
- Define `ILogger`, `NoopLogger`, and `ConsoleLogger`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test tests/errors.test.ts tests/logger.test.ts`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/errors/index.ts src/logger/index.ts tests/errors.test.ts tests/logger.test.ts
git commit -m "feat: add standardized error hierarchy and logging infrastructure"
```

---

### Task 3: HTTP Transport Layer and Proxy Dispatcher

**Files:**
- Create: `src/http/types.ts`
- Create: `src/http/FetchHttpClient.ts`
- Create: `src/http/index.ts`
- Test: `tests/http.test.ts`

**Interfaces:**
- Consumes: `GlpiHttpError`, `GlpiNotFoundError`, `GlpiValidationError`, `GlpiRateLimitError`, `ILogger`.
- Produces:
  - `IHttpClient`:
    ```typescript
    export interface IHttpClient {
      request<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>>;
      useRequestInterceptor(interceptor: RequestInterceptor): () => void;
      useResponseInterceptor(interceptor: ResponseInterceptor): () => void;
      setHeader(name: string, value: string): void;
      removeHeader(name: string): void;
    }
    ```
  - `HttpRequestOptions`: `method`, `path`, `headers?`, `params?`, `body?`, `timeout?`, `signal?`, `rawResponse?`
  - `HttpResponse<T>`: `status`, `statusText`, `headers: Headers`, `data: T`
  - `FetchHttpClient` class with `proxy?: string | ProxyOptions`, `useEnvProxy?: boolean`, `dispatcher?: any`, and `fetch?: typeof fetch` injection.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/http.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FetchHttpClient } from '../src/http/FetchHttpClient.js';
import { GlpiNotFoundError, GlpiRateLimitError, GlpiValidationError, GlpiHttpError } from '../src/errors/index.js';

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

  it('maps 404 to GlpiNotFoundError', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404, statusText: 'Not Found' }));
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    await expect(client.request({ method: 'GET', path: '/Assistance/Ticket/999' }))
      .rejects.toThrow(GlpiNotFoundError);
  });

  it('maps 429 to GlpiRateLimitError with retryAfter', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Too Many Requests', {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'retry-after': '30' },
    }));
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
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Validation failed', fields: { name: ['empty'] } }), {
      status: 422,
      statusText: 'Unprocessable Entity',
      headers: { 'content-type': 'application/json' },
    }));
    const client = new FetchHttpClient({ baseUrl: 'https://glpi.test/api.php/v2', fetch: mockFetch });
    await expect(client.request({ method: 'POST', path: '/Assistance/Ticket', body: {} }))
      .rejects.toThrow(GlpiValidationError);
  });

  it('supports proxy options in Node undici dispatcher', async () => {
    const client = new FetchHttpClient({
      baseUrl: 'https://glpi.test/api.php/v2',
      proxy: 'http://corp-proxy:8080',
      fetch: mockFetch,
    });
    expect(client.getProxyOptions()).toEqual({ url: 'http://corp-proxy:8080' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/http.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `FetchHttpClient` and HTTP types**

Create `src/http/types.ts`:
- Define `HttpRequestOptions`, `HttpResponse<T>`, `RequestInterceptor`, `ResponseInterceptor`, `ProxyOptions`, `HttpClientConfig`, `IHttpClient`.

Create `src/http/FetchHttpClient.ts`:
- Implement `FetchHttpClient` with URL resolution, query param builder, header merging, interceptors chain, error status parser, and proxy dispatcher setup.
- If running in Node and `proxy` or `useEnvProxy` is specified, configure undici dispatcher (or standard agent) dynamically.

Create `src/http/index.ts`:
- Export `IHttpClient`, `FetchHttpClient`, and all types.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/http.test.ts`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/http/ types/ tests/http.test.ts
git commit -m "feat: implement FetchHttpClient with interceptors, proxy routing, and error status mapping"
```

---

### Task 4: OAuth2 Authentication Layer and Token Management

**Files:**
- Create: `src/auth/types.ts`
- Create: `src/auth/storage.ts`
- Create: `src/auth/TokenManager.ts`
- Create: `src/auth/PasswordAuthProvider.ts`
- Create: `src/auth/AuthorizationCodeAuthProvider.ts`
- Create: `src/auth/ClientCredentialsAuthProvider.ts`
- Create: `src/auth/index.ts`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Consumes: `IHttpClient` from Task 3, `GlpiAuthenticationError` from Task 2.
- Produces:
  - `IAuthProvider`:
    ```typescript
    export interface IAuthProvider {
      getAccessToken(): Promise<string>;
      invalidateToken(): Promise<void>;
      logout(): Promise<void>;
    }
    ```
  - `ITokenStorage` & `InMemoryTokenStorage`
  - `TokenManager` (manages token lifetime, proactive expiry buffer, deduplicated in-flight refresh)
  - `PasswordAuthProvider`
  - `AuthorizationCodeAuthProvider`
  - `ClientCredentialsAuthProvider`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PasswordAuthProvider,
  AuthorizationCodeAuthProvider,
  ClientCredentialsAuthProvider,
  InMemoryTokenStorage,
  TokenManager,
} from '../src/auth/index.js';
import { IHttpClient, HttpResponse } from '../src/http/types.js';

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/auth.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement OAuth2 Authentication Layer**

Create `src/auth/types.ts`:
- Define `IAuthProvider`, `ITokenStorage`, `TokenData`, `PasswordAuthOptions`, `AuthCodeOptions`, `ClientCredentialsOptions`.

Create `src/auth/storage.ts`:
- Implement `InMemoryTokenStorage`.

Create `src/auth/TokenManager.ts`:
- Implement `TokenManager` tracking expiration timestamp with a 30s proactive margin and a `refreshPromise` mutex for deduplicating concurrent refresh attempts.

Create `src/auth/PasswordAuthProvider.ts`:
- Implement `PasswordAuthProvider` with credential retention for silent re-auth.

Create `src/auth/AuthorizationCodeAuthProvider.ts`:
- Implement `AuthorizationCodeAuthProvider` with code exchange, persisted token storage support, and `refresh_token` renewal.

Create `src/auth/ClientCredentialsAuthProvider.ts`:
- Implement `ClientCredentialsAuthProvider`.

Create `src/auth/index.ts`:
- Export all providers, storage, manager, and types.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/auth.test.ts`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/auth/ tests/auth.test.ts
git commit -m "feat: implement OAuth2 authentication engine with automatic proactive refresh and single-flight lock"
```

---

### Task 5: RSQL Query Builder

**Files:**
- Create: `src/rsql/builder.ts`
- Create: `src/rsql/index.ts`
- Test: `tests/rsql.test.ts`

**Interfaces:**
- Consumes: None.
- Produces:
  - `RsqlBuilder` class:
    - Methods: `eq`, `neq`, `in`, `out`, `lt`, `le`, `gt`, `ge`, `like`, `ilike`, `isNull`, `isNotNull`, `empty`, `notEmpty`, `and`, `or`, `build()`, `toString()`
  - Factory function `rsql()`: returns a new `RsqlBuilder`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/rsql.test.ts
import { describe, it, expect } from 'vitest';
import { rsql, RsqlBuilder } from '../src/rsql/index.js';

describe('RSQL Query Builder', () => {
  it('builds basic comparison operators', () => {
    expect(rsql().eq('status', 1).build()).toBe('status==1');
    expect(rsql().neq('is_deleted', true).build()).toBe('is_deleted!=true');
    expect(rsql().gt('priority', 3).build()).toBe('priority=gt=3');
    expect(rsql().ge('priority', 3).build()).toBe('priority=ge=3');
    expect(rsql().lt('priority', 2).build()).toBe('priority=lt=2');
    expect(rsql().le('priority', 2).build()).toBe('priority=le=2');
    expect(rsql().like('name', 'Server*').build()).toBe('name=like=Server*');
    expect(rsql().ilike('name', 'server*').build()).toBe('name=ilike=server*');
    expect(rsql().in('status', [1, 2, 3]).build()).toBe('status=in=(1,2,3)');
    expect(rsql().out('status', [4, 5]).build()).toBe('status=out=(4,5)');
    expect(rsql().isNull('date_mod').build()).toBe('date_mod=isnull=');
    expect(rsql().isNotNull('date_mod').build()).toBe('date_mod=isnotnull=');
    expect(rsql().empty('comment').build()).toBe('comment=empty=');
    expect(rsql().notEmpty('comment').build()).toBe('comment=notempty=');
  });

  it('escapes_and_quotes_special_characters', () => {
    // Review Focus #3: Special characters quoting
    expect(rsql().eq('name', 'Printer; Color & Wireless').build())
      .toBe('name=="Printer; Color & Wireless"');

    expect(rsql().eq('name', 'O\'Reilly "Special"').build())
      .toBe('name=="O\'Reilly \\"Special\\""');

    expect(rsql().in('locations', ['Room 101', 'HQ; Room 202']).build())
      .toBe('locations=in=("Room 101","HQ; Room 202")');
  });

  it('chains AND and OR expressions', () => {
    const q1 = rsql().eq('status', 2).and().gt('priority', 3).build();
    expect(q1).toBe('status==2;priority=gt=3');

    const q2 = rsql().eq('status', 1).or().eq('status', 2).build();
    expect(q2).toBe('status==1,status==2');
  });

  it('supports nested query groupings with parentheses', () => {
    const filter = rsql()
      .eq('status', 2)
      .and(rsql().like('name', 'Server*').or().like('name', 'Host*'))
      .build();
    expect(filter).toBe('status==2;(name=like=Server*,name=like=Host*)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/rsql.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement RSQL Query Builder**

Create `src/rsql/builder.ts`:
- Implement `escapeValue(val: unknown): string`: quotes strings containing `;`, `,`, `=`, spaces, or quotes, escaping inner quotes.
- Implement `RsqlBuilder` with operator chaining (`eq`, `neq`, `like`, `in`, `and`, `or`, nested groups) and `build()`.

Create `src/rsql/index.ts`:
- Export `RsqlBuilder` and helper `rsql()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/rsql.test.ts`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/rsql/ tests/rsql.test.ts
git commit -m "feat: implement fluent RSQL query builder with operator chaining and value escaping"
```

---

### Task 6: Generic Resource Service and Route Registry

**Files:**
- Create: `src/resources/types.ts`
- Create: `src/resources/RouteRegistry.ts`
- Create: `src/resources/ResourceService.ts`
- Create: `src/resources/index.ts`
- Test: `tests/resource.test.ts`

**Interfaces:**
- Consumes: `IHttpClient` from Task 3, `RsqlBuilder` from Task 5, error types from Task 2.
- Produces:
  - `RouteRegistry`: resolves resource type names to GLPI URL paths with plugin alias registration.
  - `IResourceService<T>` interface:
    ```typescript
    export interface IResourceService<T> {
      list(params?: ListParams): Promise<PaginatedResult<T>>;
      get(id: number | string, options?: RequestOptions): Promise<T>;
      create(data: Partial<T>, options?: CreateOptions): Promise<CreateResult | T>;
      update(id: number | string, data: Partial<T>, options?: RequestOptions): Promise<T>;
      delete(id: number | string, options?: DeleteOptions): Promise<void>;
    }
    ```
  - `ResourceService<T>` base class.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/resource.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RouteRegistry } from '../src/resources/RouteRegistry.js';
import { ResourceService } from '../src/resources/ResourceService.js';
import { IHttpClient } from '../src/http/types.js';
import { rsql } from '../src/rsql/index.js';

interface TestItem {
  id: number;
  name: string;
}

describe('Resource Service & Route Registry', () => {
  let mockHttp: IHttpClient;
  let registry: RouteRegistry;

  beforeEach(() => {
    mockHttp = {
      request: vi.fn(),
      useRequestInterceptor: vi.fn(),
      useResponseInterceptor: vi.fn(),
      setHeader: vi.fn(),
      removeHeader: vi.fn(),
    };
    registry = new RouteRegistry();
  });

  it('resolves core aliases and custom plugin paths', () => {
    expect(registry.resolve('Ticket')).toBe('Assistance/Ticket');
    expect(registry.resolve('Computer')).toBe('Assets/Computer');
    expect(registry.resolve('User')).toBe('Administration/User');
    expect(registry.resolve('Document')).toBe('Management/Document');

    // Direct path pass-through
    expect(registry.resolve('PluginNamespace/CustomItem')).toBe('PluginNamespace/CustomItem');

    // Custom registration
    registry.register('MyPlugin', 'CustomPlugin/MainItem');
    expect(registry.resolve('MyPlugin')).toBe('CustomPlugin/MainItem');
  });

  it('performs list() with pagination and RSQL filter', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ 'x-total-count': '42' }),
      data: [{ id: 1, name: 'Item 1' }],
    });

    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    const result = await service.list({
      filter: rsql().eq('name', 'Test'),
      start: 0,
      limit: 10,
      sort: 'id:desc',
    });

    expect(result.data).toEqual([{ id: 1, name: 'Item 1' }]);
    expect(result.total).toBe(42);
    expect(result.count).toBe(1);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/Assistance/Ticket',
        params: {
          filter: 'name==Test',
          start: 0,
          limit: 10,
          sort: 'id:desc',
        },
      })
    );
  });

  it('performs create() returning { id, href } by default', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 201,
      data: { id: 101, href: '/Assistance/Ticket/101' },
    });

    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    const res = await service.create({ name: 'New Ticket' });

    expect(res).toEqual({ id: 101, href: '/Assistance/Ticket/101' });
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/Assistance/Ticket',
        body: { name: 'New Ticket' },
      })
    );
  });

  it('performs create({ fetch: true }) fetching full object', async () => {
    (mockHttp.request as any)
      .mockResolvedValueOnce({
        status: 201,
        data: { id: 101, href: '/Assistance/Ticket/101' },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { id: 101, name: 'New Ticket Fetched' },
      });

    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    const res = await service.create({ name: 'New Ticket' }, { fetch: true });

    expect(res).toEqual({ id: 101, name: 'New Ticket Fetched' });
    expect(mockHttp.request).toHaveBeenCalledTimes(2);
  });

  it('passes scoping headers in request options', async () => {
    (mockHttp.request as any).mockResolvedValueOnce({ status: 200, data: { id: 1, name: 'Scoper' } });
    const service = new ResourceService<TestItem>(mockHttp, 'Assistance/Ticket');
    await service.get(1, {
      entity: 2,
      profile: 5,
      recursive: true,
      language: 'fr_FR',
    });

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'GLPI-Entity': '2',
          'GLPI-Profile': '5',
          'GLPI-Entity-Recursive': 'true',
          'Accept-Language': 'fr_FR',
        }),
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/resource.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `RouteRegistry` and `ResourceService`**

Create `src/resources/types.ts`:
- Define `ListParams`, `PaginatedResult<T>`, `RequestOptions`, `CreateOptions`, `CreateResult`, `DeleteOptions`, `IResourceService<T>`.

Create `src/resources/RouteRegistry.ts`:
- Map default core entity aliases: `'Ticket'` -> `'Assistance/Ticket'`, `'Computer'` -> `'Assets/Computer'`, `'User'` -> `'Administration/User'`, `'Document'` -> `'Management/Document'`.
- Implement `register(alias, path)` and `resolve(input)`.

Create `src/resources/ResourceService.ts`:
- Implement standard CRUD methods: `list`, `get`, `create`, `update`, `delete`.
- Map `x-total-count` response header to `total` in `PaginatedResult`.
- Attach scoping headers (`GLPI-Entity`, `GLPI-Profile`, `GLPI-Entity-Recursive`, `Accept-Language`) from `RequestOptions`.

Create `src/resources/index.ts`:
- Export registry, service, and types.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/resource.test.ts`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/resources/ tests/resource.test.ts
git commit -m "feat: implement generic ResourceService with RouteRegistry and stateless scoping headers"
```

---

### Task 7: Domain Resource Services (Tickets, Computers, Users, Documents)

**Files:**
- Create: `src/types/models.ts`
- Create: `src/resources/domain/TicketResource.ts`
- Create: `src/resources/domain/ComputerResource.ts`
- Create: `src/resources/domain/UserResource.ts`
- Create: `src/resources/domain/DocumentResource.ts`
- Modify: `src/resources/index.ts`
- Test: `tests/domain-resources.test.ts`

**Interfaces:**
- Consumes: `ResourceService<T>` from Task 6, `IHttpClient` from Task 3.
- Produces:
  - TypeScript models: `GlpiTicket`, `GlpiComputer`, `GlpiUser`, `GlpiDocument`, `GlpiSessionInfo`, `TicketTimelineItem`.
  - `TicketResource` (with `addFollowup`, `getTimeline`, `assign`).
  - `ComputerResource`.
  - `UserResource` (with `me()` calling `/Administration/User/Me`, `getSession()` calling `/session`).
  - `DocumentResource` (with `upload()` via `FormData` to `/Management/Document`, `download()` from `/Management/Document/{id}/Download`).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/domain-resources.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TicketResource } from '../src/resources/domain/TicketResource.js';
import { UserResource } from '../src/resources/domain/UserResource.js';
import { DocumentResource } from '../src/resources/domain/DocumentResource.js';
import { IHttpClient } from '../src/http/types.js';

describe('Domain Resource Services', () => {
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

  it('TicketResource_adds_followup_and_assigns', async () => {
    (mockHttp.request as any)
      .mockResolvedValueOnce({ status: 201, data: { id: 50, href: '/Assistance/Ticket/1/Followup/50' } })
      .mockResolvedValueOnce({ status: 201, data: { id: 51, href: '/Assistance/Ticket/1/Actor/51' } });

    const tickets = new TicketResource(mockHttp);
    const followup = await tickets.addFollowup(1, 'Issue investigated');
    expect(followup.id).toBe(50);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/Assistance/Ticket/1/Followup',
        body: expect.objectContaining({ content: 'Issue investigated' }),
      })
    );

    const assignRes = await tickets.assign(1, 24, 'user');
    expect(assignRes.id).toBe(51);
  });

  it('UserResource_me_and_getSession', async () => {
    (mockHttp.request as any)
      .mockResolvedValueOnce({ status: 200, data: { id: 7, name: 'tech_lead' } })
      .mockResolvedValueOnce({ status: 200, data: { glpi_plugins: [], glpiactiveprofile: { id: 2 } } });

    const users = new UserResource(mockHttp);
    const me = await users.me();
    expect(me.id).toBe(7);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/Administration/User/Me' })
    );

    const session = await users.getSession();
    expect(session.glpiactiveprofile.id).toBe(2);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/session' })
    );
  });

  it('DocumentResource_upload_handles_buffer_blob_and_stream', async () => {
    // Review Focus #4: Document upload handling
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 201,
      data: { id: 77, href: '/Management/Document/77' },
    });

    const docs = new DocumentResource(mockHttp);
    const buffer = Buffer.from('GLPI log contents');
    const result = await docs.upload(
      { content: buffer, filename: 'log.txt', mimeType: 'text/plain' },
      { name: 'System Log', comment: 'Uploaded from SDK' }
    );

    expect(result.id).toBe(77);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/Management/Document',
        body: expect.any(FormData),
      })
    );
  });

  it('DocumentResource_download_returns_binary_and_metadata', async () => {
    const rawData = new Uint8Array([1, 2, 3, 4]);
    (mockHttp.request as any).mockResolvedValueOnce({
      status: 200,
      headers: new Headers({
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="report.pdf"',
      }),
      data: rawData.buffer,
    });

    const docs = new DocumentResource(mockHttp);
    const file = await docs.download(77);

    expect(file.contentType).toBe('application/pdf');
    expect(file.filename).toBe('report.pdf');
    expect(file.data).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/domain-resources.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement domain models and specialized resources**

Create `src/types/models.ts`:
- Define `GlpiTicket`, `GlpiComputer`, `GlpiUser`, `GlpiDocument`, `GlpiSessionInfo`, `TicketTimelineItem`, `DocumentUploadFile`, `DocumentMetadata`, `DocumentDownloadResult`.

Create `src/resources/domain/TicketResource.ts`:
- Inherit `ResourceService<GlpiTicket>`. Implement `addFollowup`, `getTimeline`, `assign`.

Create `src/resources/domain/ComputerResource.ts`:
- Inherit `ResourceService<GlpiComputer>`.

Create `src/resources/domain/UserResource.ts`:
- Inherit `ResourceService<GlpiUser>`. Implement `me()` and `getSession()`.

Create `src/resources/domain/DocumentResource.ts`:
- Inherit `ResourceService<GlpiDocument>`. Implement `upload(file, metadata)` building standard `FormData` payload; implement `download(id)` requesting arrayBuffer and reading Content-Disposition/Content-Type.

Update `src/resources/index.ts`:
- Export all domain resource classes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/domain-resources.test.ts`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/types/models.ts src/resources/domain/ src/resources/index.ts tests/domain-resources.test.ts
git commit -m "feat: implement specialized domain resources for Tickets, Computers, Users, and Documents"
```

---

### Task 8: GraphQL Client

**Files:**
- Create: `src/graphql/types.ts`
- Create: `src/graphql/GraphqlClient.ts`
- Create: `src/graphql/index.ts`
- Test: `tests/graphql.test.ts`

**Interfaces:**
- Consumes: `IHttpClient` from Task 3, `GlpiError` from Task 2.
- Produces:
  - `IGraphqlClient` interface and `GraphqlClient` class:
    - `query<T>(query: string, variables?: Record<string, any>): Promise<T>`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/graphql.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphqlClient } from '../src/graphql/GraphqlClient.js';
import { IHttpClient } from '../src/http/types.js';
import { GlpiError } from '../src/errors/index.js';

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/graphql.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `GraphqlClient`**

Create `src/graphql/types.ts`:
- Define `GraphqlResponse<T>`, `GraphqlError`, `IGraphqlClient`.

Create `src/graphql/GraphqlClient.ts`:
- Implement `GraphqlClient` executing `POST` with `{ query, variables }`. Inspect response for `errors` array, throwing `GlpiError` if found.

Create `src/graphql/index.ts`:
- Export `GraphqlClient` and types.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/graphql.test.ts`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/graphql/ tests/graphql.test.ts
git commit -m "feat: implement typed GraphQL client targeting /api.php/GraphQL"
```

---

### Task 9: Main Client Entrypoint (`GlpiClient`) and E2E Workflows

**Files:**
- Create: `src/client.ts`
- Modify: `src/index.ts`
- Test: `tests/client.test.ts`
- Test: `tests/e2e-workflow.test.ts`

**Interfaces:**
- Consumes: All components from Tasks 2-8.
- Produces:
  - `GlpiClient` class and main package exports.
  - End-to-end integration test verifying the full lifecycle: Password authentication -> ticket creation -> document upload -> query ticket with RSQL -> logout.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { GlpiClient } from '../src/client.js';

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
  });
});
```

```typescript
// tests/e2e-workflow.test.ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/client.test.ts tests/e2e-workflow.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `GlpiClient` and main exports**

Create `src/client.ts`:
- Configure `FetchHttpClient` with base URL (handling `/v2` endpoint and `/token` endpoint).
- Attach auth interceptor and 401 retry interceptor.
- Initialize `TicketResource`, `ComputerResource`, `UserResource`, `DocumentResource`, and `GraphqlClient`.
- Implement scoping methods (`setEntity`, `setProfile`, `setLanguage`).
- Implement `resource<T>()` and `registerResource()`.
- Implement `login()` and `logout()`.

Update `src/index.ts`:
- Re-export `GlpiClient`, `rsql`, error classes, auth providers, resource classes, and all TypeScript types.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/client.test.ts tests/e2e-workflow.test.ts`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/client.ts src/index.ts tests/client.test.ts tests/e2e-workflow.test.ts
git commit -m "feat: implement GlpiClient with transparent 401 retry, session scoping, and e2e workflow"
```

---

### Task 10: Legacy Cleanup, Packaging Verification, and Documentation

**Files:**
- Modify: `README.md`
- Delete: `glpi.js`
- Delete: `test/` (legacy mocha tests)
- Delete: `.jsdoc.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: All modules from Tasks 1-9.
- Produces: Clean repository without legacy code, up-to-date documentation with examples, valid dual build (`dist/index.cjs`, `dist/index.mjs`, `dist/index.d.ts`), and zero runtime dependencies.

- [ ] **Step 1: Write verification test for zero runtime dependencies**

```typescript
// tests/package.test.ts
import { describe, it, expect } from 'vitest';
import packageJson from '../package.json' assert { type: 'json' };

describe('Package constraints', () => {
  it('should have zero runtime dependencies', () => {
    expect(packageJson.dependencies || {}).toEqual({});
  });

  it('should have version 2.0.0', () => {
    expect(packageJson.version).toBe('2.0.0');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test tests/package.test.ts`
Expected: PASS.

- [ ] **Step 3: Update `README.md` and clean up legacy files**

- Rewrite `README.md` documenting:
  - Installation: `npm install glpi-api`
  - Quick Start example (Authentication, Ticket creation, Document upload, Logout).
  - Proxy configuration (corporate proxy URL, environment variables `HTTP_PROXY`, `HTTPS_PROXY`).
  - RSQL Query Builder usage.
  - GraphQL querying.
  - Generic & custom plugin resource usage (`client.resource()`).
  - Session scoping (`setEntity`, `setProfile`, `setLanguage`).
- Remove obsolete files:
  - `rm glpi.js .jsdoc.json`
  - `rm -rf test/`
- Run build and type check: `npm run build && npm run typecheck`.

- [ ] **Step 4: Run full test suite and verify build artifacts**

Run: `npm test && npm run typecheck && npm run build`
Expected: All tests pass (100% green), types validate with 0 errors, `dist/` contains ESM, CJS, and `.d.ts` bundles.

- [ ] **Step 5: Commit**

```bash
git add README.md package.json tests/package.test.ts
git rm glpi.js .jsdoc.json test/test.js test/init.js
git commit -m "chore: remove legacy 1.x files, add package verification test, and update README for v2"
```
