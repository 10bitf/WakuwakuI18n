import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze, collectUsedKeys } from '../src/check.js';

test('analyze:用了未定义=错;定义未用=提示;非zh缺=清单;占位符不一致=错', () => {
  const r = analyze({
    defined: {
      zh: { 'site.a': '甲 {x}', 'site.unused': '乙', 'site.c': '丙' },
      en: { 'site.a': 'A', 'site.c': 'C' },   // site.a 漏了 {x}
    },
    used: ['site.a', 'site.c', 'site.ghost'],
    locales: ['zh', 'en'],
  });
  assert.equal(r.errors.filter((e) => e.includes('site.ghost')).length, 1, '未定义 key 报错');
  assert.equal(r.errors.filter((e) => e.includes('占位符不一致') && e.includes('site.a')).length, 1);
  assert.equal(r.warnings.filter((w) => w.includes('site.unused')).length, 1);
  assert.equal(r.info.filter((i) => i.includes('en 缺 1 条')).length, 1, 'en 缺 site.unused');
});

test('collectUsedKeys:t() 字面量、数据表 key 字面量、{{}} 模板占位;不认非命名空间前缀', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wkwk-scan-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'page.astro'),
    `---\nconst a = t('site.hero.title');\n---\n<p>{t('site.hero.sub')}</p>\n<i>{{site.tpl.slot}}</i>\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'data.ts'),
    `export const K = { ok: 'site.status.ok' };\nconst noise = 'foo.bar.baz';\nconst vue = '{{obj.prop.x}}';\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'skip.css'), `.x{content:"t('site.no.pe')"}`, 'utf8');
  const used = collectUsedKeys({
    root,
    scan: [{ dir: 'src', exts: ['.astro', '.ts'] }],
    namespaces: ['site'],
  }).sort();
  assert.deepEqual(used, ['site.hero.sub', 'site.hero.title', 'site.status.ok', 'site.tpl.slot']);
});
