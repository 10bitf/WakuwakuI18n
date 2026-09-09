// 取词的**纯逻辑**：喂一张编译好的消息函数表（`compile.js` 的产物），回一个 `t`。
//
// # 为什么框架导出的是这个，而不是一个完整的取词模块
//
// 完整取词模块必然要 import 那张表，而表在各宿主里的来处不一样
// （Vite 虚拟模块 / 构建期生成的文件 / 直接 require）。其中 Vite 虚拟模块
// **Node 直接 import 会挂**（`ERR_UNSUPPORTED_ESM_URL_SCHEME`）——
// 2026-09-09 的 spike 就是这么把消费方的取词测试弄红的。
//
// 拆成「纯逻辑 + 各宿主自己的薄壳」之后，测试喂一张手搓表就能测，不必起构建。
// **这正是本框架自己的成例**（`src/check.js` 纯逻辑 + `tools/check.mjs` 薄 CLI）。
//
// # 它兜住三件编译产物不管的事
//
// 1. 🔴 **`vars` 缺省要给 `{}`**。编译出来的函数拿 `undefined` 会**抛错**
//    （`Cannot read properties of undefined`），而 `t('nav.data')` 这种不带参数的调用
//    在消费方里到处都是。不兜的话是**白屏**，不是少个字。
// 2. **缺 key 回空串 + 告警**，不把 key 显示给用户 —— 消费方的既有规矩。
// 3. **开发期哨兵**：漏传参数时编译产物输出 `undefined` 字样
//    （i18next 时代是留下 `{round}`）。两种痕迹都认。

// 漏传参数的两种痕迹：`{还没替换的}`（i18next 时代）与 `undefined`（编译产物）。
// 两个都留着：迁移期两条路会并存，而且 `undefined` 也可能是调用方自己传进来的。
const LEFTOVER = /\{[A-Za-z_][A-Za-z0-9_]*\}|undefined/

/**
 * @param {Record<string, (vars: object) => string>} table 编译产物
 * @param {{ warn?: (...a: any[]) => void, dev?: boolean }} [opts]
 *   `warn` 注入告警口（测试里好断言）；`dev` 决定哨兵开不开，
 *   缺省看 `process.env.NODE_ENV !== 'production'`。
 * @returns {(key: string, vars?: object) => string}
 */
export function makeT(table, opts = {}) {
  const warn = opts.warn || ((...a) => console.warn(...a));
  const dev = opts.dev !== undefined ? opts.dev
    : (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production');
  return (key, vars) => {
    const fn = table[key];
    if (typeof fn !== 'function') {
      warn('[i18n] missing key:', key);
      return '';
    }
    // ⚠️ `vars || {}` 不是防御性编程，是**必需** —— 见文件头第 1 条
    const s = fn(vars || {});
    if (dev && typeof s === 'string' && LEFTOVER.test(s)) {
      warn('[i18n] 占位符没填上:', key, '→', s, '| 传进来的:', vars);
    }
    return s;
  };
}
