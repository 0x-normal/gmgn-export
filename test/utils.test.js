const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Load utils.js in Node context — uses module.exports branch
const U = require('../lib/utils.js');

// ── csvEscape ──────────────────────────────────────────────────────────────
describe('csvEscape', () => {
  it('returns plain value unchanged', () => {
    assert.equal(U.csvEscape('hello'), 'hello');
  });
  it('wraps value containing comma in double quotes', () => {
    assert.equal(U.csvEscape('1,000'), '"1,000"');
  });
  it('wraps value containing double-quote and escapes inner quotes', () => {
    assert.equal(U.csvEscape('say "hi"'), '"say ""hi"""');
  });
  it('wraps value containing newline', () => {
    assert.equal(U.csvEscape('line1\nline2'), '"line1\nline2"');
  });
  it('converts null/undefined to empty string', () => {
    assert.equal(U.csvEscape(null), '');
    assert.equal(U.csvEscape(undefined), '');
  });
});

// ── formatCSV ──────────────────────────────────────────────────────────────
describe('formatCSV', () => {
  it('returns header row when trades array is empty', () => {
    const csv = U.formatCSV([]);
    assert.equal(csv, 'timestamp,type,mc,amount,totalUSD,gas,trader');
  });
  it('includes one data row per trade', () => {
    const trades = [{
      timestamp: '2024-01-01T00:00:00.000Z',
      type: 'buy',
      mc: 500000,
      amount: 1000,
      totalUSD: 50,
      gas: 0.001,
      trader: '0xabc',
    }];
    const csv = U.formatCSV(trades);
    const lines = csv.split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[1].includes('0xabc'));
    assert.ok(lines[1].includes('buy'));
  });
});

// ── extractAddress ───────────────────────────────────────────────────────────
describe('extractAddress', () => {
  it('extracts and lowercases an EVM address', () => {
    assert.equal(
      U.extractAddress('/eth/address/0xABCDEF1234567890ABCDEF1234567890ABCDEF12'),
      '0xabcdef1234567890abcdef1234567890abcdef12'
    );
  });
  it('extracts a Solana base58 address verbatim (case preserved)', () => {
    const sol = 'So11111111111111111111111111111111111111112';
    assert.equal(U.extractAddress('/sol/address/' + sol), sol);
  });
  it('prefers EVM match when both could appear', () => {
    assert.equal(
      U.extractAddress('0x461d3c96d170e551611f54fa466d3d74a680aba3'),
      '0x461d3c96d170e551611f54fa466d3d74a680aba3'
    );
  });
  it('returns null when no address present', () => {
    assert.equal(U.extractAddress('no address here'), null);
    assert.equal(U.extractAddress(null), null);
    assert.equal(U.extractAddress(undefined), null);
  });
});

// ── parseTokenUrl ──────────────────────────────────────────────────────────
describe('parseTokenUrl', () => {
  it('parses base token URL', () => {
    const result = U.parseTokenUrl('https://gmgn.ai/base/token/0x461d3c96d170e551611f54fa466d3d74a680aba3');
    assert.deepEqual(result, {
      chain: 'base',
      addr: '0x461d3c96d170e551611f54fa466d3d74a680aba3',
    });
  });
  it('lowercases the EVM address', () => {
    const result = U.parseTokenUrl('https://gmgn.ai/base/token/0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
    assert.equal(result.addr, '0xabcdef1234567890abcdef1234567890abcdef12');
  });
  it('parses a Solana token URL and preserves base58 casing', () => {
    const sol = 'So11111111111111111111111111111111111111112';
    const result = U.parseTokenUrl('https://gmgn.ai/sol/token/' + sol);
    assert.deepEqual(result, { chain: 'sol', addr: sol });
  });
  it('returns null for non-token URLs', () => {
    assert.equal(U.parseTokenUrl('https://gmgn.ai/'), null);
    assert.equal(U.parseTokenUrl('https://example.com/'), null);
  });
});

// ── parseAddressUrl ────────────────────────────────────────────────────────
describe('parseAddressUrl', () => {
  it('parses a Solana wallet/profile URL and preserves base58 casing', () => {
    const w = 'hnu69n6P5CgYXCtUKii9wgamqtDeTVHY3TVJ6HKt7wC';
    const result = U.parseAddressUrl('https://gmgn.ai/sol/address/' + w);
    assert.deepEqual(result, { chain: 'sol', addr: w });
  });
  it('parses and lowercases an EVM wallet URL', () => {
    const result = U.parseAddressUrl('https://gmgn.ai/eth/address/0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
    assert.deepEqual(result, { chain: 'eth', addr: '0xabcdef1234567890abcdef1234567890abcdef12' });
  });
  it('returns null for token URLs and non-address URLs', () => {
    assert.equal(U.parseAddressUrl('https://gmgn.ai/sol/token/So11111111111111111111111111111111111111112'), null);
    assert.equal(U.parseAddressUrl('https://gmgn.ai/'), null);
  });
});

// ── extractField ───────────────────────────────────────────────────────────
describe('extractField', () => {
  it('returns value for first matching alias', () => {
    assert.equal(U.extractField({ timestamp: 12345 }, ['time', 'timestamp']), 12345);
  });
  it('tries aliases in order and returns first match', () => {
    assert.equal(U.extractField({ maker: '0x1' }, ['wallet', 'maker', 'address']), '0x1');
  });
  it('returns null when no alias matches', () => {
    assert.equal(U.extractField({ foo: 'bar' }, ['wallet', 'maker']), null);
  });
  it('skips null/undefined values and tries next alias', () => {
    assert.equal(U.extractField({ wallet: null, maker: '0x2' }, ['wallet', 'maker']), '0x2');
  });
});

// ── findTradeArray ─────────────────────────────────────────────────────────
describe('findTradeArray', () => {
  it('returns the array if payload is already an array', () => {
    const arr = [{ a: 1 }];
    assert.equal(U.findTradeArray(arr), arr);
  });
  it('finds array nested one level deep under "list"', () => {
    const arr = [{ a: 1 }];
    assert.equal(U.findTradeArray({ data: { list: arr } }), arr);
  });
  it('finds array nested under "data" directly', () => {
    const arr = [{ a: 1 }];
    assert.equal(U.findTradeArray({ data: arr }), arr);
  });
  it('returns null when no array found', () => {
    assert.equal(U.findTradeArray({ code: 0, msg: 'ok' }), null);
  });
  it('skips empty arrays and finds the first non-empty one', () => {
    const arr = [{ a: 1 }];
    assert.equal(U.findTradeArray({ empty: [], trades: arr }), arr);
  });
});

// ── tradeKey ───────────────────────────────────────────────────────────────
describe('tradeKey', () => {
  it('produces a stable key from timestamp+trader+type+amount', () => {
    const key = U.tradeKey({ timestamp: '2024-01-01', trader: '0xabc', type: 'buy', amount: 100 });
    assert.equal(key, '2024-01-01|0xabc|buy|100');
  });
  it('produces different keys for different amounts', () => {
    const k1 = U.tradeKey({ timestamp: 't', trader: 'w', type: 'buy', amount: 1 });
    const k2 = U.tradeKey({ timestamp: 't', trader: 'w', type: 'buy', amount: 2 });
    assert.notEqual(k1, k2);
  });
});
