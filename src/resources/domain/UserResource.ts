import type { IHttpClient } from '../../http/types.js';
import { ResourceService } from '../ResourceService.js';
import type { RouteRegistry } from '../RouteRegistry.js';
import type { RequestOptions } from '../types.js';
import type { GlpiSessionInfo, GlpiUser } from '../../types/models.js';

/**
 * Specialized resource service for GLPI Users (/Administration/User).
 * Provides helper methods for inspecting the current user identity and active session details.
 */
export class UserResource extends ResourceService<GlpiUser> {
  /**
   * Initializes a new UserResource instance.
   *
   * @param http The HTTP client to use for network transport.
   * @param endpoint The route path or registered alias (defaults to 'Administration/User').
   * @param registry Optional RouteRegistry for custom alias resolution.
   */
  constructor(
    http: IHttpClient,
    endpoint: string = 'Administration/User',
    registry?: RouteRegistry
  ) {
    super(http, endpoint, registry);
  }

  /**
   * Retrieves profile information for the currently authenticated user (/Administration/User/Me).
   *
   * @param options Optional request options including entity/profile scoping.
   * @returns The authenticated user entity.
   */
  async me(options?: RequestOptions): Promise<GlpiUser> {
    const headers = this.buildHeaders(options);

    const response = await this.http.request<GlpiUser>({
      method: 'GET',
      path: `${this.basePath}/Me`,
      headers,
      signal: options?.signal,
    });

    return response.data;
  }

  /**
   * Retrieves current session information (/session) including active profiles, rights, and entities.
   *
   * @param options Optional request options including entity/profile scoping.
   * @returns The session metadata.
   */
  async getSession(options?: RequestOptions): Promise<GlpiSessionInfo> {
    const headers = this.buildHeaders(options);

    const response = await this.http.request<GlpiSessionInfo>({
      method: 'GET',
      path: '/session',
      headers,
      signal: options?.signal,
    });

    return response.data;
  }
}
