# GLPI API 2.0 TypeScript Client — Design Specification

**Date:** 2026-10-13  
**Status:** Draft for Review  
**Target:** GLPI High-Level REST API (v2 / v2.3) & GraphQL  

---

## 1. Intent and Context

The current `glpi-api` package (v1.6.1) was built for the legacy GLPI REST API (`/apirest.php`), implemented in legacy CommonJS with deprecated dependencies (`request`, `request-promise-native`, `lodash`), untyped dynamic methods, and manual session token management.

GLPI 10+ introduces a modern "High-Level REST API" (v2 / v2.3) accessible via `/api.php/v2/...` alongside a GraphQL query interface at `/api.php/GraphQL`. Authentication is standardized around OAuth2 (Password grant, Authorization Code grant, and Client Credentials for inventory), filtering uses RSQL (REST Query Language), and the API is fully documented via OpenAPI 3.0.

The goal of this project is a complete rewrite to version 2.0:
- Pure **TypeScript** with strict type checking.
- Built strictly around **SOLID design principles**.
- **Testable by design**, allowing 100% mocked offline testing.
- **Clean break** from the legacy API: modern, resource-oriented namespaces rather than old generic verb methods.
- **Zero bloat**: lightweight package footprint with zero runtime HTTP dependencies (using native `fetch`), without bundling heavy schema files at runtime.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Full GLPI v2 / v2.3 Support:** Implement full lifecycle interactions with GLPI High-Level REST API endpoints and `/api.php/GraphQL`.
- **OAuth2 Lifecycle Engine:** Native support for Password, Authorization Code, and Client Credentials grant types, including automatic token expiry tracking, secure storage, and transparent proactive/reactive token refreshing.
- **SOLID Architecture:**
  - *Single Responsibility:* Dedicated decoupled modules for HTTP transport, authentication, resource services, query formatting (RSQL), and errors.
  - *Open/Closed:* Extensible to custom GLPI plugins and new entity types without modifying core library code.
  - *Liskov Substitution:* Consistent interfaces for authenticators, storage, and HTTP adapters.
  - *Interface Segregation:* Discrete contracts (`IHttpClient`, `IAuthProvider`, `ITokenStorage`, `ILogger`, `IResourceClient`).
  - *Dependency Inversion:* Core client depends on abstractions, allowing complete dependency injection for mocking and testing.
- **Resource-Oriented Ergonomics:**
  - First-class typed services for core entities: `client.tickets`, `client.computers`, `client.users`, `client.software`, `client.documents`, etc.
  - Flexible generic service: `client.resource<T>('ItemType')` for any core or custom plugin entity.
  - Standard CRUD operations: `list(options)`, `get(id, options)`, `create(data)`, `update(id, data)`, `delete(id, options)`.
  - Document upload/download support with binary streaming and `FormData`.
- **RSQL Query Builder:** Fluent, type-safe query builder for constructing RSQL filter expressions (`==`, `!=`, `=in=`, `=like=`, `=gt=`, etc.) and boolean logic (`and`, `or`), preventing query injection and syntax mistakes.
- **GraphQL Client:** Built-in query execution against `/api.php/GraphQL` for complex multi-schema traversals.
- **Featherweight Package:** Zero runtime HTTP dependencies (native `fetch`), minimal package size, and compile-time `.d.ts` definitions that do not inflate runtime memory or bundle size.
- **High Test Coverage:** Vitest test suite with mocked HTTP layer validating every component in isolation.

### Non-Goals
- **No Legacy Parity:** Backwards compatibility with the deprecated `glpi-api` 1.x API (`initSession`, `killSession`, `getItem`, `addItems`) is intentionally omitted per user decision.
- **No Runtime OpenAPI Bundling:** The 9MB OpenAPI JSON spec will not be shipped in the npm bundle; only lightweight TypeScript interface declarations will be compiled.
- **No Browser GUI:** The library is an SDK / client library for Node.js and modern JS/TS runtimes, not a frontend UI component.

### Anti-Goals
- **No Deprecated Dependencies:** No `request`, `request-promise`, `axios`, or heavy utility libraries.
- **No Loose `any`:** Strict typing throughout the public API surface.
- **No Global Mutable State:** Instances must be fully self-contained and concurrency-safe.

---

## 3. Architecture & SOLID Design

```
+------------------------------------------------------------------------+
|                              GlpiClient                                |
|  - tickets, computers, users, ... (Domain Resource Services)          |
|  - resource<T>(itemType) (Generic Resource Service)                   |
|  - graphql (GraphQL Client)                                            |
+------------------------------------------------------------------------+
        |                                       |
        v                                       v
+-------------------------------+   +------------------------------------+
|         IAuthProvider         |   |            IHttpClient             |
| - PasswordAuthProvider        |   | - FetchHttpClient (native fetch)   |
| - AuthCodeAuthProvider        |   | - Supports interceptors/middleware |
| - ClientCredentialsProvider   |   +------------------------------------+
| - Uses ITokenStorage          |                   |
+-------------------------------+                   |
        |                                           |
        +-------------------+-----------------------+
                            v
                    Network / GLPI Server
```

### 3.1 HTTP Transport Layer (`IHttpClient`)
- Defines contract for sending requests: `request<T>(options: HttpRequestOptions): Promise<HttpResponse<T>>`.
- Default implementation `FetchHttpClient` utilizes standard global `fetch`.
- Supports request and response interceptors (used by the auth provider to inject `Authorization: Bearer <token>` and intercept `401 Unauthorized` for automatic token refresh).
- Exposes configurable timeout and base URL handling.
- **Session Scoping Headers:** Supports default and per-request headers for GLPI v2 context:
  - `GLPI-Entity`: Target entity ID.
  - `GLPI-Profile`: Target profile ID.
  - `GLPI-Entity-Recursive`: `"true"` | `"false"`.
  - `Accept-Language`: Language code (e.g. `"en_GB"`, `"fr_FR"`).
  - Can be set globally via `client.setEntity(id, recursive?)` / `client.setProfile(id)` or overridden per individual method call.

### 3.2 Authentication Layer (`IAuthProvider`)
- Responsible for acquiring and refreshing OAuth2 tokens from `/api.php/token`.
- Standard grant implementations:
  - `PasswordAuthProvider`: `grant_type: password`, `username`, `password`, `client_id`, `client_secret`, `scope`.
    - *Auto-Refresh Mechanism:* Because GLPI v2 password grant does not return a `refresh_token` (only `access_token` and `expires_in`), `PasswordAuthProvider` retains the credentials in memory to automatically and silently execute a re-authentication request before the token expires.
  - `AuthorizationCodeAuthProvider`: `grant_type: authorization_code`, `code`, `client_id`, `client_secret`.
    - Supports initial `code` exchange as well as initialization from persisted tokens (`access_token` and `refresh_token` via `ITokenStorage`), enabling session recovery across process restarts without re-entering an authorization code.
  - `ClientCredentialsAuthProvider`: `grant_type: client_credentials`, `client_id`, `client_secret`, `scope: inventory`.
- `ITokenStorage`: Interface for storing tokens in-memory (default) or pluggable external stores (e.g. Redis, encrypted file).
- Token manager tracks `expires_in` timestamp and automatically refreshes expired or expiring tokens before firing queued requests.

### 3.3 Resource Layer (`IResourceService<T>`)
- Base generic class `ResourceService<T>` providing uniform CRUD operations:
  - `list(params?: ListParams): Promise<PaginatedResult<T>>`
    - Supports query parameters: `filter` (RSQL string or RsqlBuilder), `start` (offset, default 0), `limit` (page size, default 100), `sort` (`field:asc` or `field:desc`).
  - `get(id: number | string, params?: GetParams): Promise<T>`
  - `create(data: Partial<T>, options?: { fetch?: boolean }): Promise<CreateResult | T>`
    - Matches GLPI v2's HTTP 201 response returning `{ id: number; href: string }`.
    - If `options.fetch = true` is provided, automatically performs a subsequent `get(id)` to return the full entity `T`.
  - `update(id: number | string, data: Partial<T>): Promise<T>`
  - `delete(id: number | string, options?: DeleteOptions): Promise<void>`
- **Route Resolution & Plugin Support:**
  - GLPI v2 routes are categorized (e.g., `/Assistance/Ticket`, `/Assets/Computer`, `/Administration/User`, `/Management/Document`).
  - `client.resource<T>(pathOrType)` accepts full route paths (e.g., `client.resource('Assets/Computer')` or `client.resource('PluginNamespace/CustomItem')`).
  - Core shortcuts are mapped automatically (`'Ticket'` -> `'Assistance/Ticket'`, `'Computer'` -> `'Assets/Computer'`, `'User'` -> `'Administration/User'`, `'Document'` -> `'Management/Document'`).
  - Extensible via `client.registerResource(alias, routePath)` so custom GLPI plugin resources can be given custom aliases.
- Dedicated resource subclasses for core GLPI items:
  - `TicketResource` (includes `addFollowup`, `getTimeline`, `assign`)
  - `ComputerResource`
  - `UserResource` (includes `me()` querying `/Administration/User/Me`, and session inspection via `/session`)
  - `DocumentResource` (includes `upload(file, metadata)`, `download(id)`)

### 3.4 Document & File Handling
- File uploads use standard `FormData` targeting `/Management/Document`:
  - Accepts `Blob`, `Buffer`, or filesystem `ReadStream` with metadata (`name`, `filename`, `comment`).
- File downloads target `/Management/Document/{id}/Download`:
  - Returns raw binary stream / `ArrayBuffer` with content metadata (`contentType`, `filename`).

### 3.5 RSQL Query Builder
- Provides a chainable, type-safe builder:
  ```typescript
  import { rsql } from 'glpi-api';
  const filter = rsql()
    .eq('status', 2)
    .and(rsql().like('name', 'Server*').or().like('name', 'Host*'))
    .build();
  // Output: status==2;(name=like=Server*,name=like=Host*)
  ```
- Supports all operators documented in GLPI 2.3: `==`, `!=`, `=in=`, `=out=`, `=lt=`, `=le=`, `=gt=`, `=ge=`, `=like=`, `=ilike=`, `=isnull=`, `=isnotnull=`, `=empty=`, `=notempty=`.

### 3.6 GraphQL Client
- Simple, typed execution helper:
  ```typescript
  const result = await client.graphql.query<TicketQueryResponse>(query, variables);
  ```

### 3.7 Error Hierarchy
- `GlpiError`: Base error class.
- `GlpiHttpError`: Contains `status`, `statusText`, `url`, and server response body.
- `GlpiAuthenticationError`: OAuth2 errors, invalid credentials, or expired refresh tokens.
- `GlpiNotFoundError`: HTTP 404 responses.
- `GlpiValidationError`: HTTP 400 / 422 with GLPI field validation error details.
- `GlpiRateLimitError`: HTTP 429 with retry timing.

### 3.8 Logging Interface (`ILogger`)
- Minimal interface: `debug`, `info`, `warn`, `error`.
- Configurable in client options; defaults to silent (`NoopLogger`).

---

## 4. Package Structure & Runtime Footprint

- **Distribution:** Dual ESM (`dist/index.mjs`) and CommonJS (`dist/index.cjs`) using `tsup`.
- **TypeScript Declarations:** Emitted `.d.ts` files with declaration maps.
- **Dependencies:**
  - `dependencies`: None (`0` external runtime dependencies).
  - `devDependencies`: `typescript`, `tsup`, `vitest`, `@types/node`.
- **Target Environments:** Node.js >= 18.0.0, Bun, Deno, and modern browser/edge runtimes supporting standard `fetch`.

---

## 5. Decisions Made

1. **Clean Break:** Legacy methods (`getItem`, `addItems`, `initSession`, etc.) removed entirely in favor of `client.<resource>.<action>` and `client.resource('<type>').<action>` (User choice).
2. **Featherweight Types:** No runtime JSON spec bundling; clean TypeScript type definitions for core models with flexible generics for extensions (User choice).
3. **Native Fetch:** Standard web API `fetch` used as the default transport; zero external HTTP libraries (User choice).
4. **Custom Typed Error Hierarchy:** Standardized error classes for granular error handling (Agent proposal).
5. **Pluggable Logger:** Silent by default, injectable `ILogger` interface (Agent proposal).

---

## 6. What's Left to the Builder (Implementation Plan)

- Directory layout inside `src/` (`auth/`, `http/`, `resources/`, `rsql/`, `graphql/`, `errors/`, `types/`).
- Concrete AST and parser/builder for RSQL expressions.
- File upload handling with `FormData` and `Blob` compatibility across Node 18+.
- Comprehensive unit test suite with mock fetch responses covering all auth flows, error statuses, and resource operations.
