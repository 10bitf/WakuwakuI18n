// 「禁止裸中文」硬卡。在消费项目根执行:node node_modules/wakuwaku-i18n/tools/lint-raw.mjs [--summary]
// 豁免是 opt-in:仅当 i18n.config.mjs 的 rawLint.exempt === true 才生效(默认零豁免)。
// --summary 只打合计行(给 pre-push 之类每次都跑的场景,免得豁免清单刷屏到没人看),
// 命中清单任何模式下都照打——那是要拿去修的。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { maskNonProse, findRawHan } from '../src/lint-raw.js';
import { fileExemptReason, splitByLineExemption } from '../src/exempt.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'i18n', '.git', '.astro', 'unpackage']);

async function main() {
  const summaryOnly = process.argv.includes('--summary');
  const root = process.cwd();
  const cfg = (await import(pathToFileURL(path.join(root, 'i18n.config.mjs')).href)).default;
  const { dirs, exts, exempt: exemptEnabled = false } = cfg.rawLint;

  const hits = [], lineExempt = [], fileExempt = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (SKIP_DIRS.has(f)) continue;
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) { walk(fp); continue; }
      const ext = path.extname(f);
      if (!exts.includes(ext)) continue;
      const rel = path.relative(root, fp);
      const src = fs.readFileSync(fp, 'utf8');

      if (exemptEnabled) {
        const reason = fileExemptReason(src);
        if (reason) { fileExempt.push({ rel, reason }); continue; }   // 整份跳过,但理由要能读出来
      }
      // 区域感知等长遮蔽:遮蔽后行号与原文完全一致
      const raw = findRawHan(maskNonProse(src, ext)).map((h) => ({ ...h, rel }));
      if (!exemptEnabled) { hits.push(...raw); continue; }
      const r = splitByLineExemption(src, raw);
      hits.push(...r.hits);
      lineExempt.push(...r.exempt);
    }
  };
  for (const d of dirs) walk(path.resolve(root, d));

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
