import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze, collectUsedKeys, normalizeLocales, ENGINES, engineOf } from '../src/check.js';

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

test('collectUsedKeys:方括号取词与带连字符的 key', () => {
  // 迁 Paraglide 之后取词长这样:编译产物**只有字符串名导出**(key 里带点号时
  // 它不生成合法标识符的具名导出),所以调用点是 m['site.brand']()。
  // 顺带修了一个一直在的漏检:key 里的连字符不在字符类里,
  // `site.project.trash-talk.name` 一直被报成「没人用」。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wkwk-scan2-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.astro'),
    "import * as m from '../paraglide/messages.js';\n"
    + "const x = m['site.brand']({}, opt);\n"
    + "const y = m['site.project.trash-talk.name']({}, opt);\n"
    + "const z = { voice: m['site.tag.voice'] };\n"
    // 🔴 对照:长得像 key 的裸字符串**不算取词** —— 没有方括号。
    // 没有这条对照,「方括号」这个限定就白加了(放宽到 ns.x 一段之后,
    // 裸字符串规则会把 'site.json' 这种文件名也当成取词)。
    + "const p = 'site.json';\n", 'utf8');
  try {
    const used = collectUsedKeys({ root, scan: [{ dir: 'src', exts: ['.astro'] }], namespaces: ['site'], engine: 'paraglide' });
    assert.ok(used.includes('site.brand'), '方括号取词没认出来');
    assert.ok(used.includes('site.project.trash-talk.name'), '带连字符的 key 没认出来');
    assert.ok(used.includes('site.tag.voice'));
    assert.equal(used.includes('site.json'), false, '裸字符串不该算取词');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── 引擎差异表 ──────────────────────────────────────────────
// 差异只有三条,收在 ENGINES 一张表里。这几条测的是「按引擎挑」这件事本身,
// 而不是某个引擎的细节 —— 加第四个引擎时，这几条应当原样成立。

test('引擎表:缺省是 i18next —— 既有消费方都没写这个字段,默认值不许改变它们的行为', () => {
  assert.equal(engineOf(undefined), ENGINES.i18next);
  assert.throws(() => engineOf('lingui'), /未知的取词引擎/, '写错引擎名要立刻抛,不许静默当缺省');
});

test('🔴 Paraglide 下裸 key 字符串不算取词 —— 认多了会「检查绿、应用坏」', () => {
  // 数据表里的 `{ titleKey: 'site.tag.voice' }`:i18next 时代 t(act.titleKey) 真能取到词,
  // 所以那条规则那时是对的。Paraglide 下没有任何模块 import 这条消息,它会被 tree-shake 掉,
  // 运行时 m[key] 拿到 undefined。**规则从「正确」变成「误放行」。**
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wkwk-eng-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'data.js'),
    "export const ACTS = [{ titleKey: 'site.tag.voice' }];\n", 'utf8');
  try {
    const opts = { root, scan: [{ dir: 'src', exts: ['.js'] }], namespaces: ['site'] };
    assert.deepEqual(collectUsedKeys({ ...opts, engine: 'i18next' }), ['site.tag.voice'],
      'i18next 下它真的是在用');
    assert.deepEqual(collectUsedKeys({ ...opts, engine: 'compile' }), ['site.tag.voice'],
      '自建编译器同样能 t(变量)');
    assert.deepEqual(collectUsedKeys({ ...opts, engine: 'paraglide' }), [],
      'Paraglide 下它不是取词 —— 报成「没人用」才是实话');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('🔴 Paraglide 下前缀覆盖要关掉 —— m[\'site.tag\'] 是 undefined,不是取词', () => {
  const defined = { zh: { 'site.tag.voice': '语音', 'site.tag.text': '文字' } };
  const args = { defined, used: ['site.tag'], locales: ['zh'] };
  // i18next:t('site.tag.' + x) 是真能取到词的,前缀名下有叶子就算数
  assert.deepEqual(analyze({ ...args, engine: 'i18next' }).errors, []);
  // Paraglide:同一份输入必须报错 —— 那条 key 在运行时是 undefined
  const r = analyze({ ...args, engine: 'paraglide' });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /site\.tag/);
});

test('🔴 非 i18next 引擎不许把 `_one` 结尾的 key 当成复数变体', () => {
  // ICU 把复数写在消息内部,`step_one` 就是一条普通 key。按后缀解读的话它会被
  // 当成 `step` 的变体,拿去和 `step` 比占位符 —— 误报、报两遍、还拦 released 出包。
  // 夹具刻意造成:两条 key **各自**中英对齐(step 都没占位符、step_one 都有 {n})。
  // ICU 下这是一份完全正确的表,不该有任何 error;
  // 而 i18next 会把 step_one 当成 step 的变体,拿 step 的占位符(0 个)去比 step_one 的(1 个)。
  const defined = {
    zh: { 'app.step': '步骤', 'app.step_one': '第 {n} 步' },
    en: { 'app.step': 'Step', 'app.step_one': 'Step {n}' },
  };
  const args = { defined, used: ['app.step', 'app.step_one'], locales: [{ code: 'en', status: 'released' }] };

  const i18nextErrs = analyze({ ...args, engine: 'i18next' }).errors;
  assert.ok(i18nextErrs.length > 0, 'i18next 的后缀模型下它确实会报 —— 这正是要按引擎关掉的那条');
  assert.ok(i18nextErrs.some((e) => /app\.step_one（zh 的 app\.step）/.test(e)),
    '而且报的归属是错的:它把 step_one 说成 step 的变体');

  assert.deepEqual(analyze({ ...args, engine: 'compile' }).errors, [],
    'ICU 下它是两条独立的 key,各自对齐,一条都不该报');
  assert.deepEqual(analyze({ ...args, engine: 'paraglide' }).errors, []);
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

// ── i18next 复数变体（2026-09-08 补的洞）────────────────────────────
// 中文没有单复数,所以 zh 里是一条 key;英语要拆 _one/_other,阿拉伯语要拆六条。
// 补之前只按 `k in tbl` 判,于是一个假阳性 + 一个假阴性,而后者是静默的。

test('analyze:复数变体算「这条有了」—— released 语种不再误报缺条目', () => {
  const r = analyze({
    defined: {
      zh: { 'a.n': '{n} 站' },
      en: { 'a.n_one': '{n} race', 'a.n_other': '{n} races' },
    },
    used: ['a.n'],
    locales: ['zh', { code: 'en', status: 'released' }],
  });
  // 补之前:en 被判成「缺 1 条」,而 released 的缺条目是 error —— 正常写法挡住出包
  assert.equal(r.errors.filter((e) => e.includes('缺')).length, 0, '复数写法不该被判成缺条目');
  assert.equal(r.info.filter((i) => i.includes('缺')).length, 0);
});

test('analyze:**每个**复数变体的占位符都要单独比 —— 这是补之前完全没查的那块', () => {
  const r = analyze({
    defined: {
      zh: { 'a.n': '{n} 站' },
      // AI 翻译的典型翻车:_other 保住了 {n},_one 写成 "one race" 把它丢了
      en: { 'a.n_one': 'one race', 'a.n_other': '{n} races' },
    },
    used: ['a.n'],
    locales: ['zh', 'en'],
  });
  const hit = r.errors.filter((e) => e.includes('占位符不一致') && e.includes('a.n_one'));
  assert.equal(hit.length, 1, '_one 丢了 {n} 必须报');
  // 只比其中一条是漏得掉的 —— _other 是对的,不该跟着报
  assert.equal(r.errors.filter((e) => e.includes('a.n_other')).length, 0);
});

test('analyze:序数变体（_ordinal_*）同样认 —— 英语的 1st/2nd/3rd/11th', () => {
  const r = analyze({
    defined: {
      zh: { 'a.p': '第 {n} 位' },
      en: { 'a.p_ordinal_one': '{n}st', 'a.p_ordinal_two': '{n}nd', 'a.p_ordinal_few': '{n}rd', 'a.p_ordinal_other': '{n}th' },
    },
    used: ['a.p'],
    locales: ['zh', { code: 'en', status: 'released' }],
  });
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
});

test('analyze:阿拉伯语六种复数类别全认', () => {
  const cats = ['zero', 'one', 'two', 'few', 'many', 'other'];
  const ar = {};
  for (const c of cats) ar[`a.n_${c}`] = `{n} سباق`;
  const r = analyze({
    defined: { zh: { 'a.n': '{n} 站' }, ar },
    used: ['a.n'],
    locales: ['zh', { code: 'ar', status: 'released' }],
  });
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
});

test('analyze:后缀打错报 orphan —— 正向检查看不见这种', () => {
  const r = analyze({
    defined: {
      zh: { 'a.n': '{n} 站' },
      en: { 'a.n_other': '{n} races', 'a.n_ones': 'one race' },   // _ones 打错了
    },
    used: ['a.n'],
    locales: ['zh', 'en'],
  });
  // a.n 因为有 _other 不算缺,而 _ones 永远不会被取到 —— 补之前两头都不报
  assert.equal(r.warnings.filter((w) => w.includes('a.n_ones')).length, 1);
});

test('analyze:一个变体都没有才算缺 —— 别把新规则放松成什么都不报', () => {
  const r = analyze({
    defined: { zh: { 'a.n': '{n} 站', 'a.m': '甲' }, en: { 'a.n_other': '{n} races' } },
    used: ['a.n', 'a.m'],
    locales: ['zh', { code: 'en', status: 'released' }],
  });
  assert.equal(r.errors.filter((e) => e.includes('缺 1 条') && e.includes('a.m')).length, 1);
});
