// 文案防错检查纯逻辑。tools/check.mjs 是薄 CLI 入口,这里是可被 node --test 直测的库。
import fs from 'node:fs';
import path from 'node:path';

const FALLBACK = 'zh';
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'i18n', '.git', '.astro']);
export const placeholders = (s) => new Set([...String(s).matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]));
export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function analyze({ defined, used, locales }) {
  const errors = [], warnings = [], info = [];
  const base = defined[FALLBACK] || {};
  const usedSet = new Set(used);
  for (const k of usedSet) {
    if (!(k in base)) errors.push(`用了未定义的文案 key: ${k}（代码里在用，i18n/${FALLBACK}/ 里没有）`);
  }
  for (const k of Object.keys(base)) {
    if (!usedSet.has(k)) warnings.push(`定义了但没人用: ${k}`);
  }
  for (const loc of locales) {
    if (loc === FALLBACK) continue;
    const tbl = defined[loc] || {};
    const missing = Object.keys(base).filter((k) => !(k in tbl));
    if (missing.length) info.push(`${loc} 缺 ${missing.length} 条: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`);
    for (const k of Object.keys(base)) {
      if (!(k in tbl)) continue;
      const a = placeholders(base[k]), b = placeholders(tbl[k]);
      const diff = [...new Set([...a, ...b])].filter((p) => a.has(p) !== b.has(p));
      if (diff.length) errors.push(`占位符不一致 ${k}（${FALLBACK} vs ${loc}）: ${diff.join(', ')}`);
    }
  }
  return { errors, warnings, info };
}

export function collectUsedKeys({ root, scan, namespaces }) {
  const keys = new Set();
  const nsAlt = namespaces.map(escapeRe).join('|');
  // ② 形如 key 的裸字符串字面量(状态表等动态取词的 key 不经 t('...') 出现,靠这条认出来)
  const keyLit = new RegExp(`['"]((?:${nsAlt})\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+)['"]`, 'g');
  // ③ 模板 {{ns.x.y}} 占位。前缀限定与②一致,防止 Vue/Astro 花括号插值同形误报。
  const tplLit = new RegExp(`\\{\\{((?:${nsAlt})\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+)\\}\\}`, 'g');
  const walk = (dir, exts) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (SKIP_DIRS.has(f)) continue;
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) { walk(fp, exts); continue; }
      if (!exts.includes(path.extname(f))) continue;
      const src = fs.readFileSync(fp, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*['"]([A-Za-z][A-Za-z0-9_.]*)['"]/g)) keys.add(m[1]);
      for (const m of src.matchAll(keyLit)) keys.add(m[1]);
      for (const m of src.matchAll(tplLit)) keys.add(m[1]);
    }
  };
  for (const s of scan) walk(path.resolve(root, s.dir), s.exts);
  return [...keys];
}
