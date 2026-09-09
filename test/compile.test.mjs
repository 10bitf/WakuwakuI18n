// 编译器与取词纯逻辑的契约。
//
// 这两件是 2026-09-09 加的（设计见 docs/specs/2026-09-09-icu-compile-design.md）。
// 它们**纯新增**：`load` 与 `i18next-preset` 一个字没动，所以没有消费方被迫升级。
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTable, compileTables, flattenTable } from '../src/compile.js';
import { makeT } from '../src/make-t.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

test.after(() => rmSync(join(process.cwd(), '.test-tmp'), { recursive: true, force: true }));

// 把编译出来的模块源码变成可调用的表。
//
// ⚠️ **不能用 `data:` URL**：产物里 `import { plural } from "@messageformat/runtime"`
// 是**裸导入**，而 data: 模块解析不了裸导入（没有所属目录，找不到 node_modules）。
// 所以写到仓内临时文件再 import —— 位置决定了裸导入能不能解析，这不是小事。
const tmpDir = join(tmpdir(), 'wakuwaku-i18n-test');
let seq = 0;
const evalModule = async (src) => {
  // 写在**仓库内**（node_modules 的兄弟层级），裸导入才解析得到
  mkdirSync(join(process.cwd(), '.test-tmp'), { recursive: true });
  const f = join(process.cwd(), '.test-tmp', `m${seq++}.mjs`);
  writeFileSync(f, src, 'utf8');
  return (await import(pathToFileURL(f).href)).default;
};

test('flattenTable：命名空间当前缀，点分到底', () => {
  assert.deepEqual(flattenTable({ a: { b: '甲', c: { d: '乙' } } }, 'app'),
    { 'app.a.b': '甲', 'app.a.c.d': '乙' });
});

test('简单插值：现有文案不用改写就能编', async () => {
  // 🔴 这条是整个方案成立的前提：`{n} 站` 本身就是合法 ICU（`{n}` 是简单参数）。
  // 2026-09-09 拿 Racing 真实 926 条实测，926 条全过。
  const t = makeT(await evalModule(compileTable({ 'a.n': '还剩 {n} 站' }, 'zh')));
  assert.equal(t('a.n', { n: 3 }), '还剩 3 站');
});

test('复数：变量名写在消息里，没有魔法 count', async () => {
  // i18next 的复数选择只认 `count` 这个特定选项名，而消费方的占位符叫 `{n}`——
  // 加复数那天没传 count 的调用点会渲染成空白。ICU 没有这个坑。
  const t = makeT(await evalModule(
    compileTable({ 'a.r': '{n, plural, one{{n} race} other{{n} races}}' }, 'en')));
  assert.equal(t('a.r', { n: 1 }), '1 race');
  assert.equal(t('a.r', { n: 5 }), '5 races');
});

test('一条消息里多个复数 —— i18next 做不到的那件事', async () => {
  const t = makeT(await evalModule(compileTable(
    { 'a.m': '{races, plural, other{{races} races}} · {drivers, plural, other{{drivers} drivers}}' }, 'en')));
  assert.equal(t('a.m', { races: 1, drivers: 20 }), '1 races · 20 drivers');
});

test('序数：英语的 1st/2nd/3rd/11th', async () => {
  const t = makeT(await evalModule(compileTable(
    { 'a.p': '{n, selectordinal, one{{n}st} two{{n}nd} few{{n}rd} other{{n}th}}' }, 'en')));
  assert.equal([1, 2, 3, 11].map((n) => t('a.p', { n })).join(' '), '1st 2nd 3rd 11th');
});

test('阿拉伯语六种复数类别都编得出来', async () => {
  const t = makeT(await evalModule(compileTable(
    { 'a.n': '{n, plural, zero{零} one{一} two{二} few{少} many{多} other{其他}}' }, 'ar')));
  assert.equal([0, 1, 2, 3, 11].map((n) => t('a.n', { n })).join(' '), '零 一 二 少 多');
});

test('🔴 用 {n} 写法的产物不碰 Intl —— 安卓微信基础库没有 Intl', () => {
  // 这一条是整个「为什么编译而不是运行时」的地基。它错了，方案对小程序就是死的。
  for (const loc of ['zh', 'en', 'de', 'ar']) {
    const src = compileTable({ 'a.n': `{n, plural, other{{n} x}}` }, loc);
    assert.ok(!/number/.test(src), `${loc} 的产物引了 number（它内部是 Intl.NumberFormat）`);
  }
});

test('🔴 复数块里写 `#` 要在编译期被拦 —— 它会走 Intl.NumberFormat', () => {
  // 2026-09-09 测出来的：`#` 编译成 number(lc, …)，而 @messageformat/runtime 的
  // number() 内部是 new Intl.NumberFormat(lc)。于是「不依赖 Intl」这个前提
  // **只在用了 # 的那一条上作废** —— 安卓微信上那一条崩、别的都好，最难查的那种。
  let err;
  try { compileTable({ 'a.n': '{n, plural, other{# 站}}' }, 'zh'); } catch (e) { err = e; }
  assert.ok(err, '写了 # 必须拦');
  assert.match(err.message, /Intl\.NumberFormat/);
  assert.match(err.message, /a\.n/, '要指出是哪一条，别让人自己翻');
});

test('🔴 文案里出现 number / count 这类英文单词，不许被当成用了 Intl 助手', async () => {
  // v0.5.0 的守卫拿正则搜**整段产物源码**，于是 Dirty 英文表里一条 "Order number"
  // 被拦下来 —— 字符串字面量里的一个英文单词而已。**误报会让人习惯性无视这道闸**，
  // 而这条闸挡的是安卓微信上的崩溃，废不起。
  // 2026-09-09 拿五个项目 2200 条真实文案跑一遍才暴露：中文表一条都碰不到。
  const table = {
    'a.n': 'Order number',
    'a.s': "That order number doesn't look right",
    'a.f': 'strictNumber and _nf are just words here',
  };
  assert.doesNotThrow(() => compileTable(table, 'en'));
  const t = makeT(await evalModule(compileTable(table, 'en')));
  assert.equal(t('a.n'), 'Order number', '文案本身不许被改动');
});

test('确定有 Intl 的环境（纯 web）可以显式放行 `#`', () => {
  const src = compileTable({ 'a.n': '{n, plural, other{# 站}}' }, 'zh', { allowIntl: true });
  assert.match(src, /number/);
});

test('编不过就抛，且一次报全 —— 别让人改一条跑一次', () => {
  let err;
  try {
    compileTable({ 'a.x': '{n, plural, one{#}}', 'a.y': '{m, plural, one{#}}', 'a.ok': '好' }, 'zh');
  } catch (e) { err = e; }
  assert.ok(err, '中文写 one 分支必须抛');
  assert.match(err.message, /2 条编不过/, '两条都要报，不是报第一条就停');
  assert.match(err.message, /a\.x/);
  assert.match(err.message, /a\.y/);
});

test('中文表误写复数分支 → 构建期就红（运行时方案给不了这个）', () => {
  assert.throws(() => compileTable({ 'a.n': '{n, plural, one{一站} other{# 站}}' }, 'zh'),
    /编不过/, '中文只有 other，写 one 应当在编译期被逮住');
});

test('compileTables：多张嵌套表合并，命名空间即键名', async () => {
  const t = makeT(await evalModule(compileTables({ app: { nav: { a: '甲' } }, common: { ok: '好' } }, 'zh')));
  assert.equal(t('app.nav.a'), '甲');
  assert.equal(t('common.ok'), '好');
});

// ── makeT 的三件兜底 ──

test('🔴 不传第二个参数不许抛 —— 消费方大量调用点是这么写的', async () => {
  const t = makeT(await evalModule(compileTable({ 'a.p': '纯文本', 'a.n': '还剩 {n} 站' }, 'zh')));
  assert.doesNotThrow(() => t('a.p'));
  assert.doesNotThrow(() => t('a.n'), '带占位符的也不许抛——编译产物拿 undefined 会炸');
});

test('缺 key 回空串 + 告警，不把 key 显示给用户', async () => {
  const warns = [];
  const t = makeT(await evalModule(compileTable({ 'a.p': '甲' }, 'zh')), { warn: (...a) => warns.push(a.join(' ')) });
  assert.equal(t('a.没有这条'), '');
  assert.ok(warns.some((w) => w.includes('missing key')));
});

test('漏传占位符留痕并告警 —— 原契约「漏传一眼可见」的延续', async () => {
  const warns = [];
  const t = makeT(await evalModule(compileTable({ 'a.n': '还剩 {n} 站' }, 'zh')),
    { warn: (...a) => warns.push(a.join(' ')), dev: true });
  const s = t('a.n', {});
  assert.ok(s.includes('undefined') || s.includes('{'), '要留痕: ' + s);
  assert.ok(warns.some((w) => w.includes('占位符没填上')));
});

test('生产模式不喊 —— 哨兵只在开发期花这份钱', async () => {
  const warns = [];
  const t = makeT(await evalModule(compileTable({ 'a.n': '还剩 {n} 站' }, 'zh')),
    { warn: (...a) => warns.push(a.join(' ')), dev: false });
  t('a.n', {});
  assert.equal(warns.length, 0);
});
