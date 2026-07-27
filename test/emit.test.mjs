import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModuleText } from '../src/emit.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_SRC = fs.readFileSync(path.join(REPO, 'src', 'core.js'), 'utf8');

test('产物自包含:表与取词逻辑都在,且 core 是逐字内联', () => {
  const text = buildModuleText({
    tables: { zh: { 'site.hi': '你好' } },
    locales: ['zh'],
    coreSrc: CORE_SRC,
    stamp: '2026-07-27T00:00:00.000Z',
  });
  assert.match(text, /export const MESSAGES/);
  assert.match(text, /export const LOCALES/);
  assert.match(text, /export const I18N_STAMP = "2026-07-27T00:00:00\.000Z"/);
  assert.ok(text.includes(CORE_SRC.trim()), 'core 必须逐字内联,不得手抄改写');
  assert.match(text, /勿手改/, '必须带"勿手改"提示');
  assert.match(text, /你好/);
});

test('产物是合法 ESM 且导出可用:makeT 能取词、能插值、能回退', async () => {
  const text = buildModuleText({
    tables: { zh: { 'a.hi': '你好 {name}', 'a.only': '仅中文' }, en: { 'a.hi': 'Hi {name}' } },
    locales: ['zh', 'en'],
    coreSrc: CORE_SRC,
    stamp: 's',
  });
  const dir = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'wkwk-emit-'));
  const file = path.join(dir, 'generated.js');
  fs.writeFileSync(file, text, 'utf8');
  try {
    const m = await import(new URL(`file:///${file.replace(/\\/g, '/')}`).href);
    let loc = 'en';
    const t = m.makeT(m.MESSAGES, () => loc, () => {});
    assert.equal(t('a.hi', { name: '甲' }), 'Hi 甲');
    assert.equal(t('a.only'), '仅中文', '英文缺失回退中文');
    loc = 'zh';
    assert.equal(t('a.hi', { name: '乙' }), '你好 乙');
    assert.equal(m.FALLBACK_LOCALE, 'zh');
    assert.deepEqual(m.LOCALES, ['zh', 'en']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
