// 自包含文案产物的拼装(纯文本,不碰 fs)。
//
// 为什么把 core 内联进产物,而不是让端 import 框架:小程序端(uni-app/Taro/原生)的模块解析
// 各不相同,跨目录/symlink 引用是反复踩坑的地方——Photoman 当初做生成产物正是为了躲它。
// 产物自包含之后,端只 import 这一个文件,模块解析差异一概不存在。
// core 逻辑因此会出现在每个消费方的产物里,但产物是 gitignore 的生成物、改框架重新生成即可,
// 不构成"两套源码"。
export function buildModuleText({ tables, locales, coreSrc, stamp }) {
  return [
    '// 由 wakuwaku-i18n 生成,**勿手改**。',
    '// 改文案:改本项目 i18n/<语言>/*.json 后重新生成(构建钩子通常已挂好)。',
    '// 改取词逻辑:改框架 src/core.js —— 下方那段是它的逐字拷贝,手改这里会在下次生成时丢失。',
    `export const I18N_STAMP = ${JSON.stringify(stamp)};`,
    `export const LOCALES = ${JSON.stringify(locales)};`,
    `export const MESSAGES = ${JSON.stringify(tables, null, 2)};`,
    '',
    '// ↓↓↓ 以下逐字内联自 wakuwaku-i18n/src/core.js ↓↓↓',
    coreSrc.trim(),
    '',
  ].join('\n');
}
