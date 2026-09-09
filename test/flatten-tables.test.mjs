// `tools/flatten-tables.mjs` 的端到端契约。
//
// 这个工具 2026-09-09 写的当天被我弄坏两次，两次都是**幂等性**：
//
// 1. 「已经扁平但说明键还在」被判成没做完 → 整个重跑 → **前缀加第二遍**（`site.site.brand`）
// 2. 第二遍跑的时候把自己写出来的 `_notes.json` 当成一张表又摊了一次
//
// 两次都是同一类错：**它做两件独立的事（摊平、挪说明），却用一个合并的判据决定跳不跳。**
// 所以这里直接跑真 CLI、跑三遍、比字节 —— 逻辑测不到的那半（文件遍历、跳过规则）正是出事的那半。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'flatten-tables.mjs');

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wkwk-flatten-'));
  for (const [rel, obj] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(obj, null, 2), 'utf8');
  }
  return dir;
}

const run = (cwd, ...args) => execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
const snapshot = (dir) => Object.fromEntries(
  fs.readdirSync(dir, { recursive: true })
    .filter((f) => String(f).endsWith('.json'))
    .map((f) => [String(f).replace(/\\/g, '/'), fs.readFileSync(path.join(dir, String(f)), 'utf8')]));

test('摊平：命名空间前缀写进 key，说明键挪去 _notes.json', () => {
  const dir = fixture({
    'i18n/zh/app.json': { _note: '说明', nav: { data: '赛季' }, race: { left: '还剩 {n} 站' } },
    'i18n/zh/common.json': { state: { retry: '重试' } },
    'i18n/en/app.json': { nav: { data: 'Season' }, race: { left: '{n, plural, one{{n} race} other{{n} races}}' } },
    'i18n/en/common.json': { state: { retry: 'Retry' } },
  });
  try {
    run(dir, '--write');
    const zhApp = JSON.parse(fs.readFileSync(path.join(dir, 'i18n/zh/app.json'), 'utf8'));
    assert.deepEqual(zhApp, { 'app.nav.data': '赛季', 'app.race.left': '还剩 {n} 站' });
    assert.equal('_note' in zhApp, false, '说明键不许留在表里：plugin-icu1 会把它当成一条真文案');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'i18n/zh/_notes.json'), 'utf8')),
      { app: { 'app._note': '说明' } });
    // common.json 没有说明键 —— 不该凭空生出一个 _notes 条目
    assert.equal('common' in JSON.parse(fs.readFileSync(path.join(dir, 'i18n/zh/_notes.json'), 'utf8')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('🔴 幂等：跑三遍与跑一遍逐字节相同（前缀不许加第二遍）', () => {
  const dir = fixture({
    'i18n/zh/site.json': { _note: '说明', brand: 'kuwakuwa', tag: { voice: '语音' } },
    'i18n/en/site.json': { brand: 'kuwakuwa', tag: { voice: 'voice' } },
  });
  try {
    run(dir, '--write');
    const after1 = snapshot(path.join(dir, 'i18n'));
    assert.ok('zh/site.json' in after1);
    assert.match(after1['zh/site.json'], /"site\.brand"/);
    assert.doesNotMatch(after1['zh/site.json'], /site\.site\./, '前缀加了两遍');

    run(dir, '--write');
    run(dir, '--write');
    assert.deepEqual(snapshot(path.join(dir, 'i18n')), after1, '第二、三遍改动了文件');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('不加 --write 只预览，一个字节都不改', () => {
  const dir = fixture({ 'i18n/zh/site.json': { brand: 'kuwakuwa' } });
  try {
    const before = snapshot(path.join(dir, 'i18n'));
    const out = run(dir);
    assert.match(out, /预览/);
    assert.deepEqual(snapshot(path.join(dir, 'i18n')), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('值不是字符串就抛错，并指明文件与 key', () => {
  const dir = fixture({ 'i18n/zh/site.json': { hero: { count: 3 } } });
  try {
    assert.throws(() => run(dir, '--write'), /site\.hero\.count/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
