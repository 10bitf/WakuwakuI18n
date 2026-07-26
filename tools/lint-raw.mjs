// 「禁止裸中文」硬卡。在消费项目根执行:node node_modules/wakuwaku-i18n/tools/lint-raw.mjs
// 迁移完成后挂进构建/推送流程;无白名单——有漏网就补迁移,不加豁免。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripComments, findRawHan } from '../src/lint-raw.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'i18n', '.git', '.astro']);

async function main() {
  const root = process.cwd();
  const cfg = (await import(pathToFileURL(path.join(root, 'i18n.config.mjs')).href)).default;
  const { dirs, exts } = cfg.rawLint;
  let bad = 0;
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (SKIP_DIRS.has(f)) continue;
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) { walk(fp); continue; }
      if (!exts.includes(path.extname(f))) continue;
      // 行号按剥完注释后的文本计;跨行块注释(/* */ 与 <!-- --> 均适用)整段剥除会让其后内容的
      // 报告行号相对原文件小幅前移——行号仅供人找位置,命中判定不受影响。
      const cleaned = stripComments(fs.readFileSync(fp, 'utf8'));
      for (const h of findRawHan(cleaned)) {
        console.log(`  \x1b[31m✗\x1b[0m ${path.relative(root, fp)}:${h.line}: ${h.text}`);
        bad++;
      }
    }
  };
  for (const d of dirs) walk(path.resolve(root, d));
  if (bad) { console.log(`\x1b[31m✗ 裸中文 ${bad} 处——请入 i18n 表后经 t() 取词\x1b[0m`); process.exit(1); }
  console.log('\x1b[32m✓\x1b[0m 无裸中文');
}

main().catch((e) => { console.error('✗ ' + (e && e.message || e)); process.exit(1); });
