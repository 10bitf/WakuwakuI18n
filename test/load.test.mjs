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

test("`_` 开头的文件不是文案表 —— `_notes.json` 不许进表", () => {
  // 摊平工具把说明键挪去 `_notes.json`(plugin-icu1 不认 `_` 前缀的键约定,
  // 留在表里译者会在 Fink 里看到一条叫 `_note` 的待翻译串)。那个文件不能再被当成表读回来。
  // 2026-09-09 漏提交这一行,WakuwakuDark 的 check 里当场多出一条叫 `site` 的假文案。
  const dir = fixture({
    'zh/site.json': { 'site.brand': '哇酷' },
    'zh/_notes.json': { site: { 'site._note': '这是说明,不是文案' } },
  });
  assert.deepEqual(loadTables(dir, { format: 'flat' }).zh, { 'site.brand': '哇酷' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("🔴 flat:混进来的嵌套子树要抛错 —— 不许复用嵌套表的递归断言", () => {
  // 嵌套表的 assertStringLeaves 遇到对象会**递归下去**,于是扁平表里混进来的一棵子树
  // (摊平没做干净时的残留形态)每个叶子都是字符串,被它一声不吭地放行。
  // 后果是安静的:那个对象进了表,下游 placeholders(String(v)) 拿到 "[object Object]",
  // 占位符比对静默变空操作。而 {"a.n": 3} 这种能拦住 —— **看着在工作,只是嵌套那个方向没防**。
  const dir = fixture({ 'zh/site.json': { 'site.brand': 'k', nav: { data: '赛季' } } });
  assert.throws(() => loadTables(dir, { format: 'flat' }), /nav 是 object/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('🔴 flat:key 必须以文件名开头 —— 换回「构造保证」丢掉的那条', () => {
  // 嵌套模式下前缀由文件名生成,「key 第一段 = 文件名」在结构上不可能被违反。
  // 扁平模式下前缀写在 key 里,那个保证没了 —— 换成显式断言。
  const dir = fixture({ 'zh/site.json': { 'totally.other.key': 'x' } });
  assert.throws(() => loadTables(dir, { format: 'flat' }), /必须以文件名开头/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('🔴 flat:前缀断言顺带堵死了跨文件撞 key', () => {
  // ns 取自文件名、同目录下各不相同,每个 key 又必须以自己文件的 ns 打头 ——
  // 于是两个文件产不出同一个 key。这正是嵌套模式那个「构造保证」的等价物。
  // (所以 load.js 里不再单写一道重复检查:那会是够不到的死守卫,而死守卫是噪声。)
  const dir = fixture({
    'zh/site.json': { 'site.brand': '甲' },
    'zh/other.json': { 'site.brand': '乙' },   // 想冒充 site 的 key
  });
  assert.throws(() => loadTables(dir, { format: 'flat' }), /必须以文件名开头/);
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
