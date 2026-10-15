import type { IHttpClient } from '../../http/types.js';
import { ResourceService } from '../ResourceService.js';
import type { RouteRegistry } from '../RouteRegistry.js';
import type { GlpiComputer } from '../../types/models.js';

/**
 * Specialized resource service for GLPI Computers (/Assets/Computer).
 */
export class ComputerResource extends ResourceService<GlpiComputer> {
  /**
   * Initializes a new ComputerResource instance.
   *
   * @param http The HTTP client to use for network transport.
   * @param endpoint The route path or registered alias (defaults to 'Assets/Computer').
   * @param registry Optional RouteRegistry for custom alias resolution.
   */
  constructor(
    http: IHttpClient,
    endpoint: string = 'Assets/Computer',
    registry?: RouteRegistry
  ) {
    super(http, endpoint, registry);
  }
}
