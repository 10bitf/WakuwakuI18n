// 「禁止裸中文」硬卡。在消费项目根执行:node node_modules/wakuwaku-i18n/tools/lint-raw.mjs [--summary]
// 豁免是 opt-in:仅当 i18n.config.mjs 的 rawLint.exempt === true 才生效(默认零豁免)。
// --summary 只打合计行(给 pre-push 之类每次都跑的场景,免得豁免清单刷屏到没人看),
// 命中清单任何模式下都照打——那是要拿去修的。
//
// 本文件只负责:读 config、调 src/scan.js 的 scanFiles 做遍历与豁免过滤、打印、决定 exit code。
// 遍历/遮蔽/豁免判定的实际逻辑在 src/scan.js——CLI 与消费方(按包名 import 'wakuwaku-i18n/scan')
// 共用同一份实现,不再各存一份会分叉的复制品。
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanFiles } from '../src/scan.js';

async function main() {
  const summaryOnly = process.argv.includes('--summary');
  const root = process.cwd();
  const cfg = (await import(pathToFileURL(path.join(root, 'i18n.config.mjs')).href)).default;
  const { dirs, exts } = cfg.rawLint;
  const exemptEnabled = cfg.rawLint.exempt === true;

  const { hits, fileExempt, lineExempt } = scanFiles({ root, dirs, exts, exempt: exemptEnabled });

  for (const h of hits) console.log(`  \x1b[31m✗\x1b[0m ${h.rel}:${h.line}: ${h.text}`);

  if (exemptEnabled && !summaryOnly) {
    for (const e of fileExempt) console.log(`  \x1b[2m·\x1b[0m 整份豁免 ${e.rel} —— ${e.reason}`);
    for (const e of lineExempt) console.log(`  \x1b[2m·\x1b[0m 行豁免 ${e.rel}:${e.line} —— ${e.reason}`);
  }
  const exemptTail = exemptEnabled
    ? `,豁免 ${fileExempt.length} 份 + ${lineExempt.length} 行${summaryOnly ? '(清单跑不带 --summary 看)' : ''}`
    : '';

  if (hits.length) {
    console.log(`\x1b[31m✗ 裸中文 ${hits.length} 处——请入 i18n 表后经 t() 取词${exemptTail}\x1b[0m`);
    process.exit(1);
  }
  console.log(`\x1b[32m✓\x1b[0m 无裸中文${exemptTail}`);
}

main().catch((e) => { console.error('✗ ' + (e && e.message || e)); process.exit(1); });
