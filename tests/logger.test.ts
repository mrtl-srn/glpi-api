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

  it('ConsoleLogger should support all log levels and custom prefixes', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = new ConsoleLogger('[custom-prefix]');
    const meta = { id: 123 };

    logger.debug('debug msg', meta);
    expect(debugSpy).toHaveBeenCalledWith('[custom-prefix] debug msg', meta);

    logger.warn('warn msg');
    expect(warnSpy).toHaveBeenCalledWith('[custom-prefix] warn msg');

    logger.error('error msg', new Error('boom'));
    expect(errorSpy).toHaveBeenCalledWith('[custom-prefix] error msg', expect.any(Error));

    debugSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
