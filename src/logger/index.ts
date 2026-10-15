/**
 * Logger interface for GLPI client operations.
 */
export interface ILogger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

/**
 * No-operation logger implementation that silently discards all logs.
 * Used as the default logger when none is provided.
 */
export class NoopLogger implements ILogger {
  debug(_message: string, ..._meta: unknown[]): void {}
  info(_message: string, ..._meta: unknown[]): void {}
  warn(_message: string, ..._meta: unknown[]): void {}
  error(_message: string, ..._meta: unknown[]): void {}
}

/**
 * Standard console logger implementation with customizable prefix.
 */
export class ConsoleLogger implements ILogger {
  private readonly prefix: string;

  constructor(prefix = '[glpi-api]') {
    this.prefix = prefix;
  }

  debug(message: string, ...meta: unknown[]): void {
    if (meta.length > 0) {
      console.debug(`${this.prefix} ${message}`, ...meta);
    } else {
      console.debug(`${this.prefix} ${message}`);
    }
  }

  info(message: string, ...meta: unknown[]): void {
    if (meta.length > 0) {
      console.info(`${this.prefix} ${message}`, ...meta);
    } else {
      console.info(`${this.prefix} ${message}`);
    }
  }

  warn(message: string, ...meta: unknown[]): void {
    if (meta.length > 0) {
      console.warn(`${this.prefix} ${message}`, ...meta);
    } else {
      console.warn(`${this.prefix} ${message}`);
    }
  }

  error(message: string, ...meta: unknown[]): void {
    if (meta.length > 0) {
      console.error(`${this.prefix} ${message}`, ...meta);
    } else {
      console.error(`${this.prefix} ${message}`);
    }
  }
}
