/**
 * Escapes and quotes values for RSQL query strings.
 *
 * Values containing special characters (;, ,, =, spaces, quotes, parentheses)
 * are enclosed in double quotes with inner double quotes escaped with a backslash.
 * Numbers and booleans are output without quotes.
 */
export function escapeValue(val: unknown): string {
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
    return String(val);
  }

  if (val === null || val === undefined) {
    return '';
  }

  if (val instanceof Date) {
    return val.toISOString();
  }

  const str = String(val);

  if (str === '') {
    return '""';
  }

  // Quote strings containing ;, ,, =, whitespace, quotes, backslashes, or parentheses
  const needsQuotes = /[;,=\s"'\\()]/.test(str);
  if (needsQuotes) {
    const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }

  return str;
}

export type RsqlNested = RsqlBuilder | string | ((builder: RsqlBuilder) => RsqlBuilder);

/**
 * Fluent builder for RSQL (REST Query Language / FIQL) expressions.
 */
export class RsqlBuilder {
  private parts: string[] = [];
  private pendingConjunction?: ';' | ',';

  constructor(initial?: string) {
    if (initial) {
      this.parts.push(initial);
    }
  }

  private append(expr: string): this {
    if (!expr) return this;
    if (this.parts.length > 0) {
      const conj = this.pendingConjunction ?? ';';
      this.parts.push(conj);
      this.pendingConjunction = undefined;
    } else {
      this.pendingConjunction = undefined;
    }
    this.parts.push(expr);
    return this;
  }

  /**
   * Equality operator: `field==value`
   */
  eq(field: string, val: unknown): this {
    return this.append(`${field}==${escapeValue(val)}`);
  }

  /**
   * Inequality operator: `field!=value`
   */
  neq(field: string, val: unknown): this {
    return this.append(`${field}!=${escapeValue(val)}`);
  }

  /**
   * Greater than operator: `field=gt=value`
   */
  gt(field: string, val: unknown): this {
    return this.append(`${field}=gt=${escapeValue(val)}`);
  }

  /**
   * Greater than or equal operator: `field=ge=value`
   */
  ge(field: string, val: unknown): this {
    return this.append(`${field}=ge=${escapeValue(val)}`);
  }

  /**
   * Less than operator: `field=lt=value`
   */
  lt(field: string, val: unknown): this {
    return this.append(`${field}=lt=${escapeValue(val)}`);
  }

  /**
   * Less than or equal operator: `field=le=value`
   */
  le(field: string, val: unknown): this {
    return this.append(`${field}=le=${escapeValue(val)}`);
  }

  /**
   * Like (pattern matching) operator: `field=like=pattern`
   */
  like(field: string, pattern: string): this {
    return this.append(`${field}=like=${escapeValue(pattern)}`);
  }

  /**
   * Case-insensitive like operator: `field=ilike=pattern`
   */
  ilike(field: string, pattern: string): this {
    return this.append(`${field}=ilike=${escapeValue(pattern)}`);
  }

  /**
   * In-list operator: `field=in=(val1,val2,...)`
   */
  in(field: string, values: unknown[]): this {
    const list = values.map((v) => escapeValue(v)).join(',');
    return this.append(`${field}=in=(${list})`);
  }

  /**
   * Not-in-list operator: `field=out=(val1,val2,...)`
   */
  out(field: string, values: unknown[]): this {
    const list = values.map((v) => escapeValue(v)).join(',');
    return this.append(`${field}=out=(${list})`);
  }

  /**
   * Null check operator: `field=isnull=`
   */
  isNull(field: string): this {
    return this.append(`${field}=isnull=`);
  }

  /**
   * Not-null check operator: `field=isnotnull=`
   */
  isNotNull(field: string): this {
    return this.append(`${field}=isnotnull=`);
  }

  /**
   * Empty check operator: `field=empty=`
   */
  empty(field: string): this {
    return this.append(`${field}=empty=`);
  }

  /**
   * Not-empty check operator: `field=notempty=`
   */
  notEmpty(field: string): this {
    return this.append(`${field}=notempty=`);
  }

  /**
   * Logical AND conjunction (`;`).
   * When called without arguments, marks the next condition to be joined by `;`.
   * When called with a nested builder or function, appends a parenthesized group with `;`.
   */
  and(nested?: RsqlNested): this {
    if (nested === undefined) {
      this.pendingConjunction = ';';
      return this;
    }
    const groupStr = this.resolveNested(nested);
    if (!groupStr) return this;
    this.pendingConjunction = ';';
    return this.append(groupStr);
  }

  /**
   * Logical OR conjunction (`,`).
   * When called without arguments, marks the next condition to be joined by `,`.
   * When called with a nested builder or function, appends a parenthesized group with `,`.
   */
  or(nested?: RsqlNested): this {
    if (nested === undefined) {
      this.pendingConjunction = ',';
      return this;
    }
    const groupStr = this.resolveNested(nested);
    if (!groupStr) return this;
    this.pendingConjunction = ',';
    return this.append(groupStr);
  }

  private isEnclosedInParens(str: string): boolean {
    if (!str.startsWith('(') || !str.endsWith(')')) {
      return false;
    }
    let depth = 0;
    for (let i = 0; i < str.length - 1; i++) {
      if (str[i] === '(') depth++;
      else if (str[i] === ')') depth--;
      if (depth <= 0) return false;
    }
    return depth === 1;
  }

  private resolveNested(nested: RsqlNested): string {
    let str: string;
    if (typeof nested === 'function') {
      const sub = nested(new RsqlBuilder());
      str = sub instanceof RsqlBuilder ? sub.build() : sub !== undefined && sub !== null ? String(sub) : '';
    } else if (nested instanceof RsqlBuilder) {
      str = nested.build();
    } else if (nested !== undefined && nested !== null) {
      str = String(nested).trim();
    } else {
      str = '';
    }
    if (!str) return '';
    if (this.isEnclosedInParens(str)) {
      return str;
    }
    return `(${str})`;
  }

  /**
   * Builds and returns the compiled RSQL query string.
   */
  build(): string {
    return this.parts.join('');
  }

  /**
   * Returns the compiled RSQL query string.
   */
  toString(): string {
    return this.build();
  }
}
