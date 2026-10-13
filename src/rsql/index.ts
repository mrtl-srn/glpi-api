import { RsqlBuilder } from './builder.js';

export { RsqlBuilder, escapeValue } from './builder.js';
export type { RsqlNested } from './builder.js';

/**
 * Creates a new fluent RSQL query builder.
 *
 * @param initial Optional initial RSQL query string or existing RsqlBuilder to clone.
 * @returns A new RsqlBuilder instance.
 */
export function rsql(initial?: string | RsqlBuilder): RsqlBuilder {
  if (initial instanceof RsqlBuilder) {
    return new RsqlBuilder(initial.build());
  }
  return new RsqlBuilder(initial);
}
