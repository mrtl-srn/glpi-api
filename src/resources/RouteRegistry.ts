/**
 * Default core GLPI resource route mappings.
 */
export const DEFAULT_CORE_ROUTES: Readonly<Record<string, string>> = Object.freeze({
  Ticket: 'Assistance/Ticket',
  Computer: 'Assets/Computer',
  User: 'Administration/User',
  Document: 'Management/Document',
});

/**
 * Registry mapping resource type names/aliases to GLPI URL endpoint paths.
 * Supports custom GLPI plugin route registration and direct path pass-through.
 */
export class RouteRegistry {
  private routes: Map<string, string>;

  constructor(initialRoutes?: Record<string, string>) {
    this.routes = new Map<string, string>(Object.entries(DEFAULT_CORE_ROUTES));

    if (initialRoutes) {
      for (const [alias, path] of Object.entries(initialRoutes)) {
        this.register(alias, path);
      }
    }
  }

  /**
   * Registers a new alias or overrides an existing route.
   *
   * @param alias The resource short name or alias (e.g. 'Rack', 'MyPluginItem').
   * @param path The GLPI API path (e.g. 'Assets/Rack', 'MyPlugin/Item').
   */
  register(alias: string, path: string): void {
    this.routes.set(alias, path);
  }

  /**
   * Removes a registered alias.
   *
   * @param alias The alias to remove.
   * @returns True if the alias was found and removed, false otherwise.
   */
  unregister(alias: string): boolean {
    return this.routes.delete(alias);
  }

  /**
   * Checks if an alias is registered.
   *
   * @param alias The alias name.
   */
  has(alias: string): boolean {
    return this.routes.has(alias);
  }

  /**
   * Resolves a resource identifier or alias to its GLPI URL path.
   * If the input is not registered, returns the input unchanged (direct pass-through).
   *
   * @param input Resource alias or path (e.g. 'Ticket', 'Assets/Computer', 'PluginNamespace/CustomItem').
   * @returns Resolved GLPI path.
   */
  resolve(input: string): string {
    if (this.routes.has(input)) {
      return this.routes.get(input)!;
    }
    const trimmed = input.startsWith('/') ? input.slice(1) : input;
    if (this.routes.has(trimmed)) {
      return this.routes.get(trimmed)!;
    }
    return input;
  }

  /**
   * Returns a snapshot of all registered routes as a key-value object.
   */
  getAll(): Record<string, string> {
    return Object.fromEntries(this.routes.entries());
  }

  /**
   * Clears all registered routes.
   */
  clear(): void {
    this.routes.clear();
  }
}
