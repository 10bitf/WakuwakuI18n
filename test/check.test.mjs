import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze, collectUsedKeys, normalizeLocales } from '../src/check.js';

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

// ── 发布状态 ──────────────────────────────────────────────
// 缺条目静默回退中文,在单语言项目里无害;多语言项目里它是「英文用户看到中文」,
// 而那是没有任何闸门会拦的线上 bug。released 语言必须把 info 升成 error。

test('normalizeLocales:字符串与对象两种写法,status 缺省 draft', () => {
  assert.deepEqual(normalizeLocales(['zh']), [{ code: 'zh', status: 'draft' }]);
  assert.deepEqual(normalizeLocales([{ code: 'en' }]), [{ code: 'en', status: 'draft' }]);
  assert.deepEqual(normalizeLocales([{ code: 'en', status: 'released' }]), [{ code: 'en', status: 'released' }]);
  assert.deepEqual(normalizeLocales(undefined), [], '不写 locales 不该炸');
  assert.deepEqual(normalizeLocales([]), []);
});

// 打错的 status 若被当成 draft 咽下去,就是「以为守着、其实没守」——
// 这个仓库对静默失败的态度是宁可炸(见 USAGE 第 7 节坑①)。
test('normalizeLocales:status 打错立刻抛错,不静默当 draft', () => {
  assert.throws(() => normalizeLocales([{ code: 'en', status: 'releases' }]), /releases/);
  assert.throws(() => normalizeLocales([{ code: 'en', status: 'RELEASED' }]), /RELEASED/, '大小写不宽容');
  assert.throws(() => normalizeLocales([{ status: 'draft' }]), /code/, '没有 code 也要炸');
});

test('analyze:draft 语言缺条目=info(不拦);released 语言缺条目=error(拦)', () => {
  const defined = {
    zh: { 'app.a': '甲', 'app.b': '乙' },
    en: { 'app.a': 'A' },              // 缺 app.b
  };
  const used = ['app.a', 'app.b'];

  const draft = analyze({ defined, used, locales: ['zh', { code: 'en', status: 'draft' }] });
  assert.equal(draft.errors.length, 0, 'draft 不许拦——边翻边上是允许的');
  assert.equal(draft.info.filter((i) => i.includes('en 缺 1 条')).length, 1);

  const released = analyze({ defined, used, locales: ['zh', { code: 'en', status: 'released' }] });
  assert.equal(released.info.filter((i) => i.includes('en 缺')).length, 0, '升成 error 后不该再重复报 info');
  assert.equal(released.errors.filter((e) => e.includes('en 缺 1 条')).length, 1);
  assert.match(released.errors.find((e) => e.includes('en 缺')), /已发布/, '报错要说清为什么这次拦了');
});

test('analyze:纯字符串 locales 行为与改动前逐字相同(向后兼容)', () => {
  const r = analyze({
    defined: { zh: { 'app.a': '甲', 'app.b': '乙' }, en: { 'app.a': 'A' } },
    used: ['app.a', 'app.b'],
    locales: ['zh', 'en'],
  });
  assert.equal(r.errors.length, 0, 'Wakuwaku / Photoman 一行都不用改');
  assert.equal(r.info.filter((i) => i.includes('en 缺 1 条')).length, 1);
});

test('analyze:released 语言条目齐全就不报——拦的是缺失,不是发布状态本身', () => {
  const r = analyze({
    defined: { zh: { 'app.a': '甲' }, en: { 'app.a': 'A' } },
    used: ['app.a'],
    locales: ['zh', { code: 'en', status: 'released' }],
  });
  assert.equal(r.errors.length, 0);
});

// ---------- 前缀式使用(动态拼 key) ----------
// 起因:Photoman 里 t('app.uilab.sc.' + s) / KNOWS=['app.scout.wait.k1'] 后接 '.t'
// 这类写法,让同一个事实被判了两次相反的罪——前缀被当成完整 key 报「未定义」,
// 真正的叶子又因为没人以完整形式引用被报「没人用」。9 条红把 push 整个卡死。

test('analyze:带尾点的前缀覆盖名下叶子——t(前缀 + 变量) 不该报未定义', () => {
  const r = analyze({
    defined: { zh: { 'app.uilab.sc.waitA': '甲', 'app.uilab.sc.waitC': '丙' } },
    used: ['app.uilab.sc.'],
    locales: ['zh'],
  });
  assert.equal(r.errors.length, 0, '前缀名下有叶子就不算未定义');
  assert.equal(r.warnings.length, 0, '叶子被前缀覆盖,不该再报没人用');
});

test('analyze:不带尾点的前缀同样覆盖——状态表里存前缀、后面再接段的写法', () => {
  const r = analyze({
    defined: { zh: { 'app.scout.wait.k1.t': '甲', 'app.scout.wait.k1.b': '乙' } },
    used: ['app.scout.wait.k1'],
    locales: ['zh'],
  });
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 0);
});

test('analyze:名下一个叶子都没有的前缀照报未定义——拼错仍然抓得住', () => {
  const r = analyze({
    defined: { zh: { 'app.scout.wait.k1.t': '甲' } },
    used: ['app.scout.wat.', 'app.scout.wa'],
    locales: ['zh'],
  });
  assert.equal(r.errors.filter((e) => e.includes('app.scout.wat.')).length, 1, '拼错的前缀要报');
  assert.equal(r.errors.filter((e) => e.includes('app.scout.wa')).length, 2,
    '半个段不算前缀:必须整段对齐(前缀+点),否则 app.scout.wa 会白白盖住 wait 一族');
});

test('analyze:精确命中优先于前缀——新规则不许把既有的严格度放松', () => {
  const r = analyze({
    defined: { zh: { 'app.a.b': '甲', 'app.a.b.c': '乙' } },
    used: ['app.a.b'],
    locales: ['zh'],
  });
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.filter((w) => w.includes('app.a.b.c')).length, 1,
    '精确写法只覆盖它自己,子孙照旧报没人用');
});

test('analyze:尾点写法永远当前缀——t("a.b." + x) 拼不出 a.b 本身', () => {
  const r = analyze({
    defined: { zh: { 'app.a.b': '甲', 'app.a.b.c': '乙' } },
    used: ['app.a.b.'],
    locales: ['zh'],
  });
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.filter((w) => w.includes('app.a.b')).length, 1);
  assert.match(r.warnings[0], /app\.a\.b$/, '被盖住的是子孙 a.b.c,a.b 自己仍然没人用');
});

test('collectUsedKeys:t(前缀 + 变量) 里的尾点字面量要被收进来(端到端)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wki18n-prefix-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.vue'),
    `<view>{{ t('app.uilab.sc.' + s) }}</view>\n`);
  const keys = collectUsedKeys({ root: dir, scan: [{ dir: 'src', exts: ['.vue'] }], namespaces: ['app'] });
  assert.ok(keys.includes('app.uilab.sc.'), `尾点字面量要收进来,实收 ${JSON.stringify(keys)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
