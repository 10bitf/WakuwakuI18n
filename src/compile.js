// 把文案表编译成「每条一个小函数」的 ES 模块源码。
//
// 设计与实测在 docs/specs/2026-09-09-icu-compile-design.md。这里只讲要点：
//
// # 为什么是编译不是运行时
//
// 消费方里有小程序，而**安卓微信基础库没有 `Intl`**（Racing 的 `core/tz.js` 有
// plat-limit 记着：dayjs-tz / luxon / date-fns-tz 全因此不能用）。
// 所有运行时 ICU 方案（FormatJS、i18next-icu）都依赖 `Intl.PluralRules`，
// polyfill 1.7 MB 装不下。编译产物把复数规则编进函数体，不需要 `Intl`。
//
// # 它解掉的三件事
//
// 1. i18next 的复数选择只认 `count` 这个魔法变量名。ICU 把变量名写在消息里
//    （`{n, plural, one{…} other{…}}`），**没有魔法名**。
// 2. i18next 一条消息只能有一个复数。ICU 支持多个。
// 3. 序数（英语 1st/2nd/3rd/**11th**）走 `selectordinal`，不必另一套 key 后缀。
//
// # 🔴 复数块里必须写 `{n}`，不许写 `#`
//
// 这条是 2026-09-09 测出来的，不是抄文档的：`#` 会编译成 `number(lc, …)`，
// 而 `@messageformat/runtime` 的 `number()` 内部是 **`new Intl.NumberFormat(lc)`** ——
// 于是「编译期不依赖 Intl」这个前提当场作废，而且**只在用了 `#` 的那一条上作废**。
// 后果是安卓微信上那一条消息运行时崩，别的都好 —— 最难查的那种。
//
// 所以本模块**编译期就拦**（`allowIntl` 显式打开才放行）：把一次设备上的随机崩溃，
// 换成一条构建失败。写 `{n}` 与写 `#` 的产出完全一样，只是不引那个助手。
//
// # 三条不许破的性质
//
// 1. **纯函数**：喂表回源码，不碰磁盘 —— 好测，也让接线那层自由（见下）。
// 2. **编不过就抛，且一次报全**：一条一条报会让人改一条跑一次。
// 3. **key 原样保留**：编译只换「怎么取词」，不换「取哪条词」。
//
// # ⚠️ 本模块**不管「何时编、怎么热更」**
//
// 那是**接线**，归各宿主自己：uni-app 是 Vite 插件、Astro 是另一个 Vite 插件、
// Photoman 官网走 `build-site.mjs` 压根不是 Vite。硬统一的结果是一个到处是 if
// 的插件，而且哪家构建升级都可能把它弄坏（设计文档 §10.2）。
import MessageFormat from '@messageformat/core';
import compileModule from '@messageformat/core/compile-module.js';

/** 会把 `Intl` 拖进来的运行时助手。产物里 import 了它们就等于依赖 Intl。 */
const INTL_HELPERS = ['number', 'strictNumber'];

/** 嵌套表 → 扁平 `{ 'ns.a.b': '文案' }`。命名空间当前缀，与点分 key 口径一致。 */
export function flattenTable(node, prefix = '', out = {}) {
  if (typeof node === 'string') { out[prefix] = node; return out }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) flattenTable(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/**
 * 编译一张**扁平**表 → ES 模块源码。
 *
 * 产物形如：
 * ```js
 * import { plural } from "@messageformat/runtime";
 * import { en } from "@messageformat/runtime/lib/cardinals";
 * export default { "a.n": (d) => plural(d.n, 0, en, { one: …, other: … }) }
 * ```
 * 所以消费方的依赖树里要有 `@messageformat/runtime`（本包已声明，装本包就带上）。
 *
 * @param {Record<string,string>} table 扁平表
 * @param {string} locale 语种码。**它决定编出哪几个复数分支** ——
 *   中文只有 `other`，英德是 one/other，阿拉伯语六种全用。
 *   写了该语种没有的分支会在这里抛错（例：中文表里写 `one` → 构建期就红）。
 * @param {{ allowIntl?: boolean }} [opts] 显式放行 `#`（会引入 `Intl.NumberFormat`）。
 *   **只有确定目标环境有 `Intl` 时才开** —— 小程序端没有。
 */
export function compileTable(table, locale, opts = {}) {
  const mf = new MessageFormat(locale);
  // 一条一条编，为的是把**所有**编不过的一次报全（第 2 条性质）
  const errors = [];
  for (const [key, msg] of Object.entries(table)) {
    try { mf.compile(msg); } catch (e) {
      errors.push(`  ${key}\n    «${msg}»\n    ${String(e).split('\n')[0]}`);
    }
  }
  if (errors.length) {
    throw new Error(`[wakuwaku-i18n] ${locale} 有 ${errors.length} 条编不过：\n${errors.join('\n')}`);
  }

  const src = compileModule(mf, table);

  if (!opts.allowIntl) {
    const used = INTL_HELPERS.filter((h) => new RegExp(`\\b${h}\\b`).test(src));
    if (used.length) {
      // 把犯事的那几条**精确**挑出来 —— 报得清楚是这条守卫的一半价值。
      // 逐条编译再看它自己需不需要那个助手，比拿正则猜 `#` 在哪准
      // （`#` 紧跟在 `{` 后面，"猜"的写法第一版就漏了）。
      const guilty = Object.entries(table)
        .filter(([k, m]) => {
          try { return INTL_HELPERS.some((h) => new RegExp(`\\b${h}\\b`).test(compileModule(mf, { [k]: m }))) }
          catch { return false }
        })
        .map(([k, m]) => `  ${k}\n    «${m}»`);
      throw new Error(
        `[wakuwaku-i18n] ${locale} 的产物依赖 ${used.join('/')}，那会走 Intl.NumberFormat —— ` +
        `而安卓微信基础库没有 Intl。\n` +
        `复数块里把 \`#\` 改写成 \`{变量名}\`，产出完全一样但不引这个助手。\n` +
        (guilty.length ? `疑似这几条：\n${guilty.join('\n')}\n` : '') +
        `确定目标环境有 Intl（纯 web）时，用 compileTable(table, locale, { allowIntl: true }) 放行。`
      );
    }
  }
  return src;
}

/**
 * 便捷入口：喂几张**嵌套**表（`{ app: {...}, common: {...} }`）→ 模块源码。
 * 命名空间即键名，与 `loadTables` 的口径一致。
 */
export function compileTables(tables, locale, opts = {}) {
  let flat = {};
  for (const [ns, t] of Object.entries(tables)) flat = { ...flat, ...flattenTable(t, ns) };
  return compileTable(flat, locale, opts);
}
