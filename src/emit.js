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

// 按命名空间白名单过滤 loadTables 的结果。key 第一段即命名空间(load.js 的 flatten 用
// 文件名当 prefix 保证这一点)。namespaces 为空/未定义时原样返回——不填白名单 = 全部命名空间
// 都打进产物,这是多数端(如官网)要的默认行为;小程序等需要瘦身、避免夹带不相关文案的端
// 才显式声明白名单。白名单里写了不存在的命名空间不报错、也不产生空条目——纯字符串前缀
// 比对,查无自然为空。
export function filterNamespaces(tables, namespaces) {
  if (!namespaces || !namespaces.length) return tables;
  const allow = new Set(namespaces);
  const out = {};
  for (const loc of Object.keys(tables)) {
    const table = {};
    for (const key of Object.keys(tables[loc])) {
      const dot = key.indexOf('.');
      const ns = dot === -1 ? key : key.slice(0, dot);
      if (allow.has(ns)) table[key] = tables[loc][key];
    }
    out[loc] = table;
  }
  return out;
}
