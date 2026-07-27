// 文件遍历 + 豁免过滤的纯逻辑。tools/lint-raw.mjs 与消费方的自建刹车点脚本共用这一份实现,
// 不再各存一份会分叉的复制品。这里只做纯逻辑 + fs 读取,不打印、不 exit——
// 打印与退出码是 CLI 层(tools/lint-raw.mjs)的职责。
import fs from 'node:fs';
import path from 'node:path';
import { maskNonProse, findRawHan } from './lint-raw.js';
import { fileExemptReason, splitByLineExemption } from './exempt.js';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'i18n', '.git', '.astro', 'unpackage']);

// scanFiles({ root, dirs, exts, exempt }) → { hits, fileExempt, lineExempt }
//   root:   相对路径解析与 rel 计算的基准目录
//   dirs:   要遍历的目录列表(相对 root)
//   exts:   命中的扩展名白名单(如 ['.js', '.astro'])
//   exempt: 是否启用豁免(对应消费方 i18n.config.mjs 的 rawLint.exempt === true);
//           关闭时豁免标记完全不生效,所有命中原样进 hits(与 CLI 里 exemptEnabled=false 时一致)。
export function scanFiles({ root, dirs, exts, exempt = false }) {
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

      // 区域感知等长遮蔽:遮蔽后行号与原文完全一致。先遮蔽再判豁免——文件级豁免要靠
      // masked 校验标记是否真躲在注释里(见 exempt.js),顺序不能倒。
      const masked = maskNonProse(src, ext);
      if (exempt) {
        const reason = fileExemptReason(src, masked);
        if (reason) { fileExempt.push({ rel, reason }); continue; }   // 整份跳过,但理由要能读出来
      }
      const raw = findRawHan(masked).map((h) => ({ ...h, rel }));
      if (!exempt) { hits.push(...raw); continue; }
      const r = splitByLineExemption(src, raw, masked);
      hits.push(...r.hits);
      lineExempt.push(...r.exempt);
    }
  };
  for (const d of dirs) walk(path.resolve(root, d));
  return { hits, fileExempt, lineExempt };
}
