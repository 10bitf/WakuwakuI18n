import test from 'node:test';
import assert from 'node:assert/strict';
import { flatten, interpolate, makeT, resolveLocale, FALLBACK_LOCALE } from '../src/core.js';

test('展平:嵌套转点分、忽略 _ 开头说明键、带前缀', () => {
  assert.deepEqual(
    flatten({ _note: '说明', settings: { title: '设置', arLab: { badge: '试验中' } } }),
    { 'settings.title': '设置', 'settings.arLab.badge': '试验中' }
  );
  assert.deepEqual(flatten({ a: { _note: 'x', b: '1' } }), { 'a.b': '1' });
  assert.deepEqual(flatten({ brand: { name: '引界' } }, 'common'), { 'common.brand.name': '引界' });
});

test('插值:按名字、缺失原样、非标识符不动、零值不丢、null/undefined 不当真文案', () => {
  assert.equal(interpolate('积分不足(需 {cost} 分)', { cost: 8 }), '积分不足(需 8 分)');
  assert.equal(interpolate('{a} 和 {b}', { b: '乙', a: '甲' }), '甲 和 乙');
  assert.equal(interpolate('无变量', { x: 1 }), '无变量');
  assert.equal(interpolate('缺变量 {gone}', { other: 1 }), '缺变量 {gone}');
  assert.equal(interpolate('花括号 {不是标识符} 原样', {}), '花括号 {不是标识符} 原样');
  assert.equal(interpolate('零值也要填 {n}', { n: 0 }), '零值也要填 0');
  assert.equal(interpolate('需 {cost} 分', { cost: undefined }), '需 {cost} 分');
  assert.equal(interpolate('需 {cost} 分', { cost: null }), '需 {cost} 分');
});

test('取词:回退链、缺失不露 key、切换生效、带变量', () => {
  const tables = {
    zh: { 'app.hello': '你好', 'app.only': '仅中文有', 'app.cost': '需 {cost} 分' },
    en: { 'app.hello': 'Hello' },
  };
  let cur = 'en';
  const missed = [];
  const t = makeT(tables, () => cur, (k, l) => missed.push(k + '@' + l));
  assert.equal(t('app.hello'), 'Hello');
  assert.equal(t('app.only'), '仅中文有');
  assert.equal(t('app.nope'), '');
  assert.deepEqual(missed, ['app.nope@en']);
  cur = 'zh';
  assert.equal(t('app.hello'), '你好');
  assert.equal(t('app.cost', { cost: 12 }), '需 12 分');
});

test('语言解析:存储优先、地区码命中、非法值忽略', () => {
  const sup = ['zh', 'en'];
  assert.equal(resolveLocale('en', 'zh_CN', sup), 'en');
  assert.equal(resolveLocale('', 'zh_CN', sup), 'zh');
  assert.equal(resolveLocale('', 'en-US', sup), 'en');
  assert.equal(resolveLocale('', 'ja_JP', sup), 'zh');
  assert.equal(resolveLocale('fr', 'en_US', sup), 'en');
  assert.equal(resolveLocale('', '', sup), 'zh');
  assert.equal(FALLBACK_LOCALE, 'zh');
});
