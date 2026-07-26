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
