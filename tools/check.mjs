// 文案防错检查。在消费项目根目录执行:node node_modules/wakuwaku-i18n/tools/check.mjs
// 语义与 Photoman tools/i18n-check.mjs 一致;扫描范围来自项目根的 i18n.config.mjs。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTables } from '../src/load.js';
import { analyze, collectUsedKeys, normalizeLocales, checkInlangCoverage } from '../src/check.js';
import { checkAssets } from '../src/assets.js';

const FALLBACK = 'zh';

async function main() {
  const root = process.cwd();
  const cfgPath = path.join(root, 'i18n.config.mjs');
  if (!fs.existsSync(cfgPath)) { console.error(`✗ 缺 ${cfgPath}`); process.exit(1); }
  const cfg = (await import(pathToFileURL(cfgPath).href)).default;
  // tableFormat: 'flat' 时 key 里已带命名空间前缀（Paraglide/plugin-icu1 的表形状），
  // 不能再按文件名加一次前缀。缺省 'nested' 是老形状。
  const defined = loadTables(path.join(root, 'i18n'), { format: cfg.tableFormat });
  // 先归一 —— status 打错要在做任何检查之前就炸,不然会得到一份「看起来通过了」的报告。
  const declared = normalizeLocales(cfg.locales);
  const statusOf = new Map(declared.map((l) => [l.code, l.status]));
  // 真值以 i18n/ 下实际目录为准;发布状态取自声明,没声明的按 draft。
  const locales = Object.keys(defined).map((code) => ({ code, status: statusOf.get(code) ?? 'draft' }));
  const namespaces = [...new Set(Object.keys(defined[FALLBACK] || {}).map((k) => k.split('.')[0]))];
  const used = collectUsedKeys({ root, scan: cfg.scan, namespaces, engine: cfg.engine });
  const { errors, warnings, info } = analyze({ defined, used, locales, engine: cfg.engine });
  // cfg.locales 是声明清单,这里做反向交叉校验——声明了却没建目录必须报错。
  for (const { code } of declared) {
    if (!(code in defined)) errors.push(`声明了语言 '${code}' 但 i18n/${code}/ 不存在`);
  }
  // 语言包里的非文本交付物(模型/词表/prompt/锚点词)。未配置 assets 时整段跳过。
  // inlang 工程与 i18n/ 下实际文件的交叉校验。没有 project.inlang/ 就整段跳过。
  // 必须有:pathPattern 不支持通配,每个命名空间都得手写一条 —— 漏登记是**静默**的
  // (本检查按目录读表照旧绿,Paraglide 那边直接不编那个文件)。
  errors.push(...checkInlangCoverage({ root, locales: locales.map((l) => l.code) }));

  const av = checkAssets({ root, assets: cfg.assets, locales });
  errors.push(...av.errors);
  warnings.push(...av.warnings);
  for (const s of info) console.log('  · ' + s);
  for (const s of warnings) console.log('  \x1b[33m!\x1b[0m ' + s);
  for (const s of errors) console.log('  \x1b[31m✗\x1b[0m ' + s);
  if (errors.length) { console.log(`\x1b[31m✗ i18n 检查未通过（${errors.length} 项）\x1b[0m`); process.exit(1); }
  console.log(`\x1b[32m✓\x1b[0m i18n 检查通过（${Object.keys(defined[FALLBACK] || {}).length} 条文案，${warnings.length} 项提示）`);
}

main().catch((e) => { console.error('✗ ' + (e && e.message || e)); process.exit(1); });
