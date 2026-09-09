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
    const files = fs.readdirSync(path.join(i18nDir, loc)).filter((f) => f.endsWith('.json')).sort();
    for (const f of files) {
      const ns = f.slice(0, -'.json'.length);
      const obj = JSON.parse(fs.readFileSync(path.join(i18nDir, loc, f), 'utf8'));
      assertStringLeaves(obj, `${loc}/${f}`, ns);
      // flat: key 里已经带前缀了，再 flatten 一次会把前缀加两遍
      // flat: key 里已经带前缀了,再 flatten 一次会把前缀加两遍。
      // 但 `_` 开头的说明键仍要跳过 —— 与 flatten 同一条规矩,漏了它 `_note` 会被当成一条真文案。
      Object.assign(table, opts.format === 'flat'
        ? Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_')))
        : flatten(obj, ns));
    }
    tables[loc] = table;
  }
  return tables;
}
