import { describe, it, expect } from 'vitest';
import { rsql, RsqlBuilder, escapeValue } from '../src/rsql/index.js';

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

  it('supports toString() matching build()', () => {
    const builder = rsql().eq('status', 1);
    expect(builder.toString()).toBe('status==1');
    expect(`${builder}`).toBe('status==1');
  });

  it('handles empty builder', () => {
    expect(rsql().build()).toBe('');
    expect(rsql().toString()).toBe('');
  });

  it('handles implicit AND when chaining multiple conditions', () => {
    const filter = rsql().eq('status', 1).gt('priority', 2).build();
    expect(filter).toBe('status==1;priority=gt=2');
  });

  it('handles nested group using callback function', () => {
    const filter = rsql()
      .eq('status', 2)
      .and((b) => b.like('name', 'Server*').or().like('name', 'Host*'))
      .build();
    expect(filter).toBe('status==2;(name=like=Server*,name=like=Host*)');
  });

  it('supports or() with nested builder', () => {
    const filter = rsql()
      .eq('status', 1)
      .or(rsql().eq('status', 2).and().gt('priority', 3))
      .build();
    expect(filter).toBe('status==1,(status==2;priority=gt=3)');
  });

  it('handles leading and trailing conjunctions gracefully', () => {
    expect(rsql().and().eq('status', 1).build()).toBe('status==1');
    expect(rsql().or().eq('status', 1).build()).toBe('status==1');
    expect(rsql().eq('status', 1).and().build()).toBe('status==1');
    expect(rsql().eq('status', 1).or().build()).toBe('status==1');
  });

  it('initializes with raw RSQL string or existing builder', () => {
    const b1 = rsql('status==1').and().gt('priority', 2);
    expect(b1.build()).toBe('status==1;priority=gt=2');

    const b2 = rsql(rsql().eq('status', 1)).or().eq('status', 2);
    expect(b2.build()).toBe('status==1,status==2');
  });

  it('escapes values with escapeValue helper directly', () => {
    expect(escapeValue(123)).toBe('123');
    expect(escapeValue(true)).toBe('true');
    expect(escapeValue(false)).toBe('false');
    expect(escapeValue('simple')).toBe('simple');
    expect(escapeValue('')).toBe('""');
    expect(escapeValue('hello world')).toBe('"hello world"');
    expect(escapeValue('semi;colon')).toBe('"semi;colon"');
    expect(escapeValue('a,b')).toBe('"a,b"');
    expect(escapeValue('a=b')).toBe('"a=b"');
    expect(escapeValue('foo"bar')).toBe('"foo\\"bar"');
    expect(escapeValue('back\\slash')).toBe('"back\\\\slash"');
  });
});
