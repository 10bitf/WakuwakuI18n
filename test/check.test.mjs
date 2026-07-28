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

// 占位符校验按**出现次数**比,不是只比名字集合。
// 这一条是冲着 AI 翻译来的:它的典型翻车里,"重复占位符丢了一个" 用集合比对完全看不出来。
test('analyze:占位符按出现次数比对——AI 翻译的四种翻车都要拦下', () => {
  const run = (zh, en) => analyze({
    defined: { zh: { 'app.x': zh }, en: { 'app.x': en } },
    used: ['app.x'],
    locales: ['zh', 'en'],
  }).errors.filter((e) => e.includes('占位符不一致'));

  assert.equal(run('进入{title}', 'Enter {标题}').length, 1, '占位符被译成中文');
  assert.equal(run('{n} 项,{n} 处该改', '{n} items to fix').length, 1, '重复占位符丢了一个(集合比对漏检的那种)');
  assert.equal(run('共 {n} 项', '{n} of {total} items').length, 1, '凭空多出占位符');
  assert.equal(run('机位 {n}', 'Spot').length, 1, '占位符整个丢掉');

  // 正常翻译不许误报 —— 尤其语序调换,那是翻译的常态
  assert.equal(run('机位 {n}', 'Spot {n}').length, 0);
  assert.equal(run('{version} · 更新 {updated}', 'Updated {updated} · {version}').length, 0, '语序调换要放行');
});

test('analyze:报错信息带出次数差,而不是只说"不一致"', () => {
  const r = analyze({
    defined: { zh: { 'app.x': '{n} 项,{n} 处' }, en: { 'app.x': '{n} items' } },
    used: ['app.x'],
    locales: ['zh', 'en'],
  });
  assert.match(r.errors[0], /n\(2→1\)/, '要能一眼看出少了几次');
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
