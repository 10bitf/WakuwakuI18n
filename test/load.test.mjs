import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTables } from '../src/load.js';

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wkwk-i18n-'));
  for (const [rel, obj] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(obj), 'utf8');
  }
  return dir;
}

test('加载:命名空间取自文件名并加为 key 第一段,多语言多文件合并', () => {
  const dir = fixture({
    'zh/site.json': { hero: { title: '你好' }, _note: '忽略我' },
    'zh/common.json': { brand: { name: '哇酷' } },
    'en/site.json': { hero: { title: 'Hi' } },
  });
  const tables = loadTables(dir);
  assert.deepEqual(Object.keys(tables).sort(), ['en', 'zh']);
  assert.deepEqual(tables.zh, { 'site.hero.title': '你好', 'common.brand.name': '哇酷' });
  assert.deepEqual(tables.en, { 'site.hero.title': 'Hi' });
});

test("format: 'flat' —— key 里已带前缀,不许再按文件名加一遍", () => {
  // 2026-09-09 迁 Paraglide 加的第二种表形状:plugin-icu1 只读扁平 JSON,
  // 而扁平表的前缀是**写在 key 里**的。不给这个开关的话会变成 site.site.hero.title。
  const dir = fixture({
    'zh/site.json': { 'site.hero.title': '你好', _note: '忽略我' },
    'zh/common.json': { 'common.brand.name': '哇酷' },
  });
  assert.deepEqual(loadTables(dir, { format: 'flat' }).zh,
    { 'site.hero.title': '你好', 'common.brand.name': '哇酷' });
  // 🔴 同一份表按缺省(nested)读 —— 前缀会被加两遍。这条钉的就是「不许自动识别」:
  // 两种形状在结构上分不开,只能由消费方显式声明,猜错的后果就长这样。
  assert.deepEqual(Object.keys(loadTables(dir).zh).sort(),
    ['common.common.brand.name', 'site.site.hero.title']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('值非字符串即抛错,并指明文件与 key', () => {
  const bad = fixture({ 'zh/site.json': { hero: { count: 3 } } });
  assert.throws(() => loadTables(bad), /zh[/\\]site\.json.*site\.hero\.count/);
  const arr = fixture({ 'zh/site.json': { hero: { list: ['a'] } } });
  assert.throws(() => loadTables(arr), /site\.hero\.list/);
});

test('目录不存在或没有语言目录都抛错', () => {
  assert.throws(() => loadTables(path.join(os.tmpdir(), 'wkwk-i18n-不存在')), /不存在/);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'wkwk-i18n-'));
  assert.throws(() => loadTables(empty), /语言目录/);
});
