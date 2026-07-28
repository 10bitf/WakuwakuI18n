// 这套测试盯的是「三端解析规则不许分叉」那件事,不是 i18next 本身。
import test from 'node:test';
import assert from 'node:assert';
import { PRESET, withPreset } from '../src/i18next-preset.js';

test('PRESET 锁住三条必须一致的解析规则', () => {
  assert.strictEqual(PRESET.nsSeparator, false, 'nsSeparator 必须为 false,否则点分 key 会被当成 ns:key 拆开');
  assert.strictEqual(PRESET.keySeparator, '.');
  assert.strictEqual(PRESET.interpolation.prefix, '{');
  assert.strictEqual(PRESET.interpolation.suffix, '}');
});

test('PRESET 是冻结的:改不动,消费方只能通过 withPreset 覆盖', () => {
  assert.throws(() => { 'use strict'; PRESET.keySeparator = ':'; }, TypeError);
  assert.throws(() => { 'use strict'; PRESET.interpolation.prefix = '{{'; }, TypeError);
});

test('withPreset 合并消费方选项,不动三条规则', () => {
  const o = withPreset({ lng: 'zh', resources: { zh: {} } });
  assert.strictEqual(o.lng, 'zh');
  assert.strictEqual(o.nsSeparator, false);
  assert.strictEqual(o.keySeparator, '.');
  assert.strictEqual(o.interpolation.prefix, '{');
});

test('withPreset 对 interpolation 做合并而非替换 —— 这是本模块存在的主要理由', () => {
  // 消费方只想改 escapeValue。若用展开而不是合并,prefix/suffix 会被整个丢掉,
  // 而症状是「占位符不报错、只是原样不替换」,极难发现。
  const o = withPreset({ interpolation: { escapeValue: true } });
  assert.strictEqual(o.interpolation.escapeValue, true, '消费方的覆盖要生效');
  assert.strictEqual(o.interpolation.prefix, '{', '花括号不能被覆盖掉');
  assert.strictEqual(o.interpolation.suffix, '}');
});

test('withPreset 不改动 PRESET 本身(多次调用互不污染)', () => {
  withPreset({ interpolation: { escapeValue: true }, keySeparator: '/' });
  assert.strictEqual(PRESET.interpolation.escapeValue, false);
  assert.strictEqual(PRESET.keySeparator, '.');
});

test('withPreset 无参可用', () => {
  const o = withPreset();
  assert.strictEqual(o.nsSeparator, false);
  assert.strictEqual(o.interpolation.suffix, '}');
});
