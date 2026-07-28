// 三端共用的 i18next 配置。**这不是取词逻辑,是配置常量** —— 取词仍然全交给 i18next,
// 本框架只保证「所有消费方用同一套解析规则」。
//
// 为什么必须集中:下面三条配错了症状都不明显 ——
//   nsSeparator 不关 → 'app.nav.x' 被当成 ns:key 拆开,取不到词
//   keySeparator 不给 → 点分路径失效
//   interpolation 的花括号不给 → i18next 默认双花括号,我们的 {name} **不报错、只是原样不替换**
// 三个消费方各写一份的话,哪天有人只改一处,两端就悄悄分叉,而且不会报错。
// (2026-07-28 曾一度就是各写一份,本模块是为消灭那个隐患而加的。)

/** 必须三端一致的部分。消费方不要单独复制这几行,用 withPreset()。 */
export const PRESET = Object.freeze({
  nsSeparator: false,   // 关掉冒号命名空间解析:我们的 key 是点分的 'ns.x.y'
  keySeparator: '.',
  interpolation: Object.freeze({
    escapeValue: false, // 转义由消费方按自己的上下文管(Astro / 小程序都不需要 i18next 再转一次)
    prefix: '{',        // 我们的文案表用单花括号
    suffix: '}',
  }),
});

/**
 * 把 PRESET 与消费方自己的选项合并,交给 i18next.init()。
 *
 * **用这个而不是展开 PRESET**:`{ ...PRESET, interpolation: {...} }` 会整个替换掉
 * interpolation,悄悄丢掉 prefix/suffix —— 那正是「不报错、只是不替换」的那类静默故障。
 * 这里对 interpolation 做一层合并,把那个坑堵死。
 *
 * @param {object} options 消费方特有的:lng / fallbackLng / resources / parseMissingKeyHandler 等
 * @returns {object} 可直接传给 i18next.init()
 */
export function withPreset(options = {}) {
  return {
    ...PRESET,
    ...options,
    interpolation: { ...PRESET.interpolation, ...(options.interpolation || {}) },
  };
}
