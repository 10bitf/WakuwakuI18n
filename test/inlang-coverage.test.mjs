// inlang 工程的 pathPattern 与 i18n/ 下实际文件的交叉校验。
//
// # 这道闸为什么是必须的
//
// `@inlang/plugin-icu1` 的 `pathPattern` **不支持通配符**（schema 是
// `.*\{locale\}.*\.json$`，解析时只做一次字面替换）。所以每个命名空间都得手写一条：
// Racing 2 条、Photoman 3 条、Dirty 5 条。
//
// 于是「加了命名空间、忘了登记」**不是边缘情况，是这个动作唯一可能的失败姿态**。
// 而且它是**静默**的：`check` 按目录读表照旧绿，Paraglide 那边直接不编那个文件，
// 那一整批 key 运行时全是 `undefined`。两边各看各的真源。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkInlangCoverage } from '../src/check.js';

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wkwk-inlang-'));
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(root, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return root;
}
const settings = (patterns) => ({
  baseLocale: 'zh',
  locales: ['zh', 'en'],
  modules: ['./node_modules/@inlang/plugin-icu1/dist/index.js'],
  'plugin.inlang.icu-messageformat-1': { pathPattern: patterns },
});

test('没有 inlang 工程时整段跳过 —— 这道闸只对用它的项目生效', () => {
  const root = fixture({ 'i18n/zh/app.json': { 'app.a': '甲' } });
  try {
    assert.deepEqual(checkInlangCoverage({ root, locales: ['zh'] }), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('登记齐全就不报', () => {
  const root = fixture({
    'project.inlang/settings.json': settings(['./i18n/{locale}/app.json', './i18n/{locale}/common.json']),
    'i18n/zh/app.json': { 'app.a': '甲' }, 'i18n/zh/common.json': { 'common.ok': '好' },
    'i18n/en/app.json': { 'app.a': 'A' }, 'i18n/en/common.json': { 'common.ok': 'OK' },
  });
  try {
    assert.deepEqual(checkInlangCoverage({ root, locales: ['zh', 'en'] }), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('🔴 加了命名空间忘了登记 —— 这是唯一可能的失败姿态，而且是静默的', () => {
  const root = fixture({
    'project.inlang/settings.json': settings(['./i18n/{locale}/app.json']),
    'i18n/zh/app.json': { 'app.a': '甲' },
    'i18n/zh/common.json': { 'common.ok': '好' },   // 新加的，没登记
  });
  try {
    const p = checkInlangCoverage({ root, locales: ['zh'] });
    assert.equal(p.length, 1);
    assert.match(p[0], /common\.json/);
    assert.match(p[0], /运行时全是 undefined/, '报错要说清后果，不能只说「不一致」');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('🔴 反方向：登记了但文件不在（改名忘了同步）', () => {
  const root = fixture({
    'project.inlang/settings.json': settings(['./i18n/{locale}/app.json', './i18n/{locale}/ghost.json']),
    'i18n/zh/app.json': { 'app.a': '甲' },
  });
  try {
    const p = checkInlangCoverage({ root, locales: ['zh'] });
    assert.equal(p.length, 1);
    assert.match(p[0], /ghost\.json/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('`_` 开头的文件不算漏登记 —— 它本来就不是文案表', () => {
  // 而且 pathPattern 没有通配能力，**结构上**也不可能把 _notes.json 读进去。
  const root = fixture({
    'project.inlang/settings.json': settings(['./i18n/{locale}/site.json']),
    'i18n/zh/site.json': { 'site.a': '甲' },
    'i18n/zh/_notes.json': { site: { 'site._note': '说明' } },
  });
  try {
    assert.deepEqual(checkInlangCoverage({ root, locales: ['zh'] }), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('不写死插件块名 —— 换存储插件时这道闸不该跟着坏', () => {
  const root = fixture({
    'project.inlang/settings.json': {
      baseLocale: 'zh', locales: ['zh'], modules: [],
      'plugin.inlang.i18next': { pathPattern: './i18n/{locale}/app.json' },   // 另一个插件，字符串形式
    },
    'i18n/zh/app.json': { 'app.a': '甲' },
  });
  try {
    assert.deepEqual(checkInlangCoverage({ root, locales: ['zh'] }), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('一个 pathPattern 都没有 = 一条文案都编不出来，要报', () => {
  const root = fixture({
    'project.inlang/settings.json': { baseLocale: 'zh', locales: ['zh'], modules: [] },
    'i18n/zh/app.json': { 'app.a': '甲' },
  });
  try {
    const p = checkInlangCoverage({ root, locales: ['zh'] });
    assert.equal(p.length, 1);
    assert.match(p[0], /一条文案都编不出来/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
