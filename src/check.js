// 文案防错检查纯逻辑。tools/check.mjs 是薄 CLI 入口,这里是可被 node --test 直测的库。
import fs from 'node:fs';
import path from 'node:path';

const FALLBACK = 'zh';
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'i18n', '.git', '.astro', 'unpackage']);
// 占位符 → 出现次数。**计次而不是只看有没有**:翻译(尤其是 AI 翻译)会把
// "{n} 项,{n} 处该改" 译成 "{n} items to fix" —— 名字集合没变,少了一次出现。
// 只用 Set 比对这种翻车会漏检,而它恰是 AI 翻译的典型失败模式之一。
export const placeholders = (s) => {
  const counts = new Map();
  for (const m of String(s).matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  return counts;
};
export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const STATUSES = new Set(['draft', 'released']);

// locales 的两种写法归一成 { code, status }。'zh' 与 { code:'zh' } 等价,status 缺省 draft
// —— 这保证既有消费方(Wakuwaku / Photoman 都写 ['zh'])一行都不用改。
//
// status 打错**立刻抛错,不静默当 draft**:静默降级的后果是「以为守着、其实没守」,
// 那正是 USAGE 第 7 节坑① 记的那类事故——检查静默变空操作,比检查失败危险得多。
export function normalizeLocales(locales) {
  return (locales || []).map((l) => {
    const o = typeof l === 'string' ? { code: l } : l;
    if (!o || !o.code) throw new Error(`locales 项缺 code: ${JSON.stringify(l)}`);
    const status = o.status ?? 'draft';
    if (!STATUSES.has(status)) {
      throw new Error(`locales '${o.code}' 的 status 只能是 draft / released,收到 '${status}'`);
    }
    return { code: o.code, status };
  });
}

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
  for (const { code: loc, status } of normalizeLocales(locales)) {
    if (loc === FALLBACK) continue;
    const tbl = defined[loc] || {};
    const missing = Object.keys(base).filter((k) => !(k in tbl));
    if (missing.length) {
      const list = `${loc} 缺 ${missing.length} 条: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`;
      // draft 是「边翻边上」,缺条目运行时回退中文,只提示。
      // released 是已经对外的语言,回退中文 = 英文用户看到中文,必须拦在出包之前。
      if (status === 'released') errors.push(`${list}（已发布语言，缺条目会回退到 ${FALLBACK}）`);
      else info.push(list);
    }
    for (const k of Object.keys(base)) {
      if (!(k in tbl)) continue;
      const a = placeholders(base[k]), b = placeholders(tbl[k]);
      // 比出现次数,不只比有没有 —— 见 placeholders 上方注释
      const diff = [...new Set([...a.keys(), ...b.keys()])]
        .filter((p) => (a.get(p) || 0) !== (b.get(p) || 0))
        .map((p) => `${p}(${a.get(p) || 0}→${b.get(p) || 0})`);
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
