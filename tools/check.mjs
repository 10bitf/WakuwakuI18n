// 文案防错检查。在消费项目根目录执行:node node_modules/wakuwaku-i18n/tools/check.mjs
// 语义与 Photoman tools/i18n-check.mjs 一致;扫描范围来自项目根的 i18n.config.mjs。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTables } from '../src/load.js';
import { analyze, collectUsedKeys } from '../src/check.js';

const FALLBACK = 'zh';

async function main() {
  const root = process.cwd();
  const cfgPath = path.join(root, 'i18n.config.mjs');
  if (!fs.existsSync(cfgPath)) { console.error(`✗ 缺 ${cfgPath}`); process.exit(1); }
  const cfg = (await import(pathToFileURL(cfgPath).href)).default;
  const defined = loadTables(path.join(root, 'i18n'));
  const locales = Object.keys(defined);
  const namespaces = [...new Set(Object.keys(defined[FALLBACK] || {}).map((k) => k.split('.')[0]))];
  const used = collectUsedKeys({ root, scan: cfg.scan, namespaces });
  const { errors, warnings, info } = analyze({ defined, used, locales });
  // cfg.locales 是声明清单;真值以 i18n/ 目录为准,这里做交叉校验——声明了却没建目录必须报错。
  if (cfg.locales) {
    for (const loc of cfg.locales) {
      if (!(loc in defined)) errors.push(`声明了语言 '${loc}' 但 i18n/${loc}/ 不存在`);
    }
  }
  for (const s of info) console.log('  · ' + s);
  for (const s of warnings) console.log('  \x1b[33m!\x1b[0m ' + s);
  for (const s of errors) console.log('  \x1b[31m✗\x1b[0m ' + s);
  if (errors.length) { console.log(`\x1b[31m✗ i18n 检查未通过（${errors.length} 项）\x1b[0m`); process.exit(1); }
  console.log(`\x1b[32m✓\x1b[0m i18n 检查通过（${Object.keys(defined[FALLBACK] || {}).length} 条文案，${warnings.length} 项提示）`);
}

main().catch((e) => { console.error('✗ ' + (e && e.message || e)); process.exit(1); });
