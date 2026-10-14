# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-10-14

Complete modernization and rewrite of `glpi-api` into 100% strict TypeScript for GLPI REST API v2 and GraphQL, with zero runtime dependencies.

### 💥 Breaking Changes

- **New Modern Facade**: Replaced legacy `GlpiApi` class with `GlpiClient`.
- **Removed Legacy v1 Methods**: Dropped `getItem`, `getItems`, `addItems`, `initSession`, `killSession`, `changeActiveEntities`, etc., in favor of strongly typed domain resource services (`client.tickets`, `client.computers`, `client.users`, `client.documents`, and `client.resource<T>()`).
- **Zero Runtime Dependencies**: Completely eliminated all external runtime dependencies (`request`, `request-promise-native`, `qs`, `lodash`). The library now relies strictly on native Node 18+ Web Standards (`fetch`, `Headers`, `FormData`, `Blob`, `AbortController`).
- **OAuth2 by Default**: Replaced manual user token / app token session initialization with standards-compliant OAuth2 authentication flows.
- **Node.js 18+ Requirement**: Dropped support for Node < 18.

### 🚀 Features & Enhancements

- **100% Strict TypeScript**: Complete type coverage (`strict: true`, `noImplicitAny: true`) with exported interfaces, models, and options.
- **Dual Package Distribution**: Bundled with `tsup` into both ESM (`dist/index.mjs`) and CommonJS (`dist/index.cjs`) with complete declaration types (`dist/index.d.ts`, `dist/index.d.cts`).
- **Enterprise Proxy Integration**:
  - Direct proxy URL string support (`proxy: 'http://proxy.corp:8080'`).
  - Structured `ProxyOptions` with custom proxy headers and authentication.
  - Automatic system environment discovery (`useEnvProxy: true`) respecting `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY`.
  - Custom Undici dispatcher support.
- **Robust OAuth2 Engine**:
  - Resource Owner Password Credentials (`password`) with silent credential re-authentication on token expiration (handling GLPI v2's omission of refresh tokens).
  - Authorization Code grant (`authorization_code`) with automatic refresh token rotation.
  - Client Credentials grant (`client_credentials`).
  - Single-flight mutex in `TokenManager` eliminating thundering-herd issues on concurrent token renewals.
  - Pluggable token storage via `ITokenStorage` (defaults to `InMemoryTokenStorage`).
- **Transparent 401 Recovery**:
  - Automatic token invalidation, re-authentication, and single request replay across both REST and GraphQL transports.
- **Fluent RSQL Query Builder (`rsql()`)**:
  - Full support for 14 GLPI comparison operators: `eq`, `neq`, `gt`, `ge`, `lt`, `le`, `like`, `ilike`, `in`, `out`, `isNull`, `isNotNull`, `empty`, `notEmpty`.
  - Logical conjunctions (`and`, `or`), nested group parentheses with balance checking, and automatic FIQL value escaping/quoting.
- **Domain Resource Services**:
  - `TicketResource`: Collection listing, retrieval, creation, updates, deletion/purge, `addFollowup()`, `getTimeline()`, and `assign()`.
  - `ComputerResource`: Hardware asset querying and management.
  - `UserResource`: User management, `me()` current user lookup, and `getSession()` session inspection.
  - `DocumentResource`: Multipart upload supporting `Buffer`, `Uint8Array`, `Blob`, and `Stream` with metadata attachment, plus binary `download()` with RFC 5987 / RFC 6266 filename decoding.
- **Generic & Plugin Resource Extensibility**:
  - Access any core or plugin resource using `client.resource<T>('ItemType')`.
  - Custom route mapping registry with `client.registerResource('Alias', 'Plugin/Path')`.
- **GraphQL Client**:
  - Strongly typed query and mutation execution against `/api.php/GraphQL`.
  - Structured error unwrapping into `GlpiGraphqlError`.
- **Session & Scoping Controls**:
  - Global and per-request entity (`GLPI-Entity`), recursive sub-entity (`GLPI-Entity-Recursive`), profile (`GLPI-Profile`), and language (`Accept-Language`) scoping.
- **Custom Typed Error Hierarchy**:
  - `GlpiError`, `GlpiHttpError`, `GlpiNotFoundError`, `GlpiValidationError`, `GlpiRateLimitError`, `GlpiAuthenticationError`, `GlpiGraphqlError`.
- **Pluggable Logging**:
  - `ILogger` interface with built-in `ConsoleLogger` and `NoopLogger`.

---

## 1.6.0

+ Add input parameter to `upload()` method
+ Update README.md

## 1.5.0

+ Update itemTypes.json for GLPI 9.4

## 1.4.0

+ Replace `got` module by `request-promise-native` module
+ Add `upload()` method to upload documents
+ Add `download()` method to download documents
+ Add `FileNotReadableError`, `InvalidAPIURLError` and `InvalidHTTPMethodError`
