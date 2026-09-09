// 读 i18n/<locale>/<ns>.json → 展平文案表。命名空间取自文件名,加载时加为 key 第一段,
// 「key 第一段 = 文件名」由构造保证。值只能是字符串——数组/数字在这里就地拦下,
// 不让 flatten 的 String() 强转把 "3"/"a,b" 悄悄打给用户。
import fs from 'node:fs';
import path from 'node:path';

// 嵌套对象 → 点分 key 表。以 _ 开头的键是给人看的说明(如 _note),不入表。
// 2026-07-28 从退役的 core.js 折进来:取词逻辑全交给 i18next 后,core 只剩这一个
// 还有人用的函数,为它留一个模块不值当。
export function flatten(obj, prefix = '', out = {}) {
  for (const k of Object.keys(obj || {})) {
    if (k.startsWith('_')) continue;
    const key = prefix ? prefix + '.' + k : k;
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

function assertStringLeaves(obj, srcLabel, prefix) {
  for (const k of Object.keys(obj || {})) {
    if (k.startsWith('_')) continue;
    const key = prefix ? prefix + '.' + k : k;
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) assertStringLeaves(v, srcLabel, key);
    else if (typeof v !== 'string') {
      throw new Error(`文案值必须是字符串: ${srcLabel} 的 ${key} 是 ${Array.isArray(v) ? 'array' : typeof v}`);
    }
  }
}

/**
 * 扁平表的同一道闸。**不能复用上面那个** —— 它是按嵌套表写的,遇到对象会**递归下去**,
 * 于是扁平表里混进来的一个子树（摊平没做干净时的残留形态）每个叶子都是字符串,
 * 被它一声不吭地放行。
 *
 * 后果是安静的:那个对象进了文案表,下游 `placeholders(String(v))` 拿到
 * `"[object Object]"`,占位符比对**静默变空操作**;`plugin-icu1` 那边则是「编出 0 条,不报错」。
 * 而 `{"a.n": 3}` 这种是能拦住的 —— **看着在工作,只是嵌套那个方向没防**,本仓最怕的那类失效。
 *
 * 扁平表的判据很简单:**顶层每个值都必须是字符串**,没有第二层。
 */
function assertFlatStrings(obj, srcLabel) {
  for (const k of Object.keys(obj || {})) {
    if (k.startsWith('_')) continue;
    const v = obj[k];
    if (typeof v === 'string') continue;
    const what = v && typeof v === 'object' && !Array.isArray(v)
      ? 'object（扁平表里不该有嵌套子树，是摊平没做干净的残留？跑 tools/flatten-tables.mjs）'
      : (Array.isArray(v) ? 'array' : typeof v);
    throw new Error(`文案值必须是字符串: ${srcLabel} 的 ${k} 是 ${what}`);
  }
}

/**
 * 读 `i18n/<locale>/<ns>.json` → 每语种一张扁平表。
 *
 * 两种表形状（2026-09-09 迁 Paraglide 时加的第二种）：
 *
 * - `'nested'`（默认，老形状）：文件内是嵌套对象，**命名空间由文件名自动加**。
 *   `zh/app.json` 里的 `nav.data` → `app.nav.data`。
 * - `'flat'`：文件内已经是扁平的、**前缀写在 key 里**（`"app.nav.data": "赛季"`），这里就不能再加一次，
 *   否则变成 `app.app.nav.data`。
 *
 * 为什么会有第二种：`@inlang/plugin-icu1` 只读扁平 JSON（嵌套的话它编出 0 条），
 * 而迁到 Paraglide 之后文案表就是那个形状。**key 字符串两种形状下逐字相同**，
 * 变的只是「前缀写在文件名里还是写在 key 里」。
 *
 * ⚠️ **不做自动识别。** 嵌套表的顶层也可以直接是字符串（`{"brand": "kuwakuwa"}`），
 * 与扁平表在结构上分不开 —— 猜错的后果是整表 key 前缀错位，而那种错很难一眼看出来。
 * 所以由消费方在 `i18n.config.mjs` 里显式声明 `tableFormat`。
 *
 * @param {string} i18nDir
 * @param {{ format?: 'nested' | 'flat' }} [opts]
 */
export function loadTables(i18nDir, opts = {}) {
  if (!fs.existsSync(i18nDir)) throw new Error(`i18n 目录不存在: ${i18nDir}`);
  const locales = fs.readdirSync(i18nDir)
    .filter((d) => fs.statSync(path.join(i18nDir, d)).isDirectory()).sort();
  if (!locales.length) throw new Error(`i18n 下没有任何语言目录: ${i18nDir}`);
  const tables = {};
  for (const loc of locales) {
    const table = {};
    // `_` 开头的文件不是文案表（`_notes.json` 是给人看的说明档）。
    // 与 `_` 开头的**键**同一条约定，只是提到了文件这一级 —— 因为 plugin-icu1 不认键那一级的约定。
    const files = fs.readdirSync(path.join(i18nDir, loc))
      .filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
    for (const f of files) {
      const ns = f.slice(0, -'.json'.length);
      const obj = JSON.parse(fs.readFileSync(path.join(i18nDir, loc, f), 'utf8'));
      if (opts.format === 'flat') {
        assertFlatStrings(obj, `${loc}/${f}`);
        // key 里已经带前缀了,再 flatten 一次会把前缀加两遍(site.site.brand)。
        // `_` 开头的说明键仍要跳过 —— 与 flatten 同一条规矩,漏了它 `_note` 会被当成一条真文案。
        for (const [k, v] of Object.entries(obj)) {
          if (k.startsWith('_')) continue;
          // 扁平表的前缀写在 key 里,于是嵌套模式那个**构造保证**没了 ——
          // 那边前缀由文件名生成,「key 第一段 = 文件名」在结构上不可能被违反。这里换成显式断言。
          //
          // 它同时把「跨文件撞 key」也堵死了:ns 取自文件名、同目录下各不相同,
          // 每个 key 都必须以自己文件的 ns 打头,两个文件就产不出同一个 key。
          // 所以**不需要再写一道重复检查** —— 那会是一道够不到的死守卫,而死守卫是噪声。
          if (!k.startsWith(ns + '.')) {
            throw new Error(`扁平表的 key 必须以文件名开头: ${loc}/${f} 的 '${k}' 不以 '${ns}.' 开头`);
          }
          table[k] = v;
        }
      } else {
        assertStringLeaves(obj, `${loc}/${f}`, ns);
        Object.assign(table, flatten(obj, ns));
      }
    }
    tables[loc] = table;
  }
  return tables;
}
