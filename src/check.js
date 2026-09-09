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

// i18next 的复数类别(JSON v4)。取自 Intl.PluralRules,不同语言用到的子集不同:
// **中文只有 other**、英德是 one/other、**阿拉伯语六种全用**。
// 序数另有一层 `_ordinal_`(英语的 1st/2nd/3rd/11th)。
// 这份表是 2026-09-08 在 i18next 26.3.6 上实跑确认的,不是照记忆写的。
const PLURAL_CATS = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * 一个 base key 在目标语种里**可能的实现名**:本名 + 复数变体 + 序数变体。
 *
 * # 为什么需要它
 *
 * 中文没有单复数,所以 `zh` 里 `{n} 站` 是**一条** key;到了英语要拆成
 * `k_one`/`k_other`,到阿拉伯语要拆成六条。只按 `k in tbl` 判的话:
 *
 *   ① **假阳性**:那些语种会被判成「缺条目」,而 released 语种的缺条目是 error,
 *      于是一个完全正常的复数写法会**挡住出包**;
 *   ② **假阴性且静默**:紧接着的 `if (!(k in tbl)) continue` 把占位符比对整个跳过,
 *      于是**复数键的占位符完全不受检查** —— 而占位符漂移正是这道检查存在的唯一理由,
 *      且源码注释点名的高危来源就是 AI 翻译。
 *
 * ②比①危险得多:①会红、会被发现,②是安静的。
 */
export function variantsOf(key, tbl) {
  const out = [];
  if (key in tbl) out.push(key);
  for (const c of PLURAL_CATS) {
    if (`${key}_${c}` in tbl) out.push(`${key}_${c}`);
    if (`${key}_ordinal_${c}` in tbl) out.push(`${key}_ordinal_${c}`);
  }
  return out;
}

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
  const baseKeys = Object.keys(base);
  // 动态拼 key 的两种写法都算「用了那一族」:t('a.b.' + x) 收进来是带尾点的 'a.b.',
  // 状态表里存 'a.b.k1' 后面再接 '.t' 收进来是不带尾点的前缀。两者都不是完整 key,
  // 旧逻辑会把它报成未定义,同时把真正的叶子报成没人用 —— 同一个事实判两次相反的罪。
  //
  // 判据:前缀名下**至少有一个已定义的叶子**才算数,一个都没有仍然报未定义。
  // 所以拼错的前缀照样抓得住,这条规则比旧的更严,不是更松。
  // 段必须整段对齐(比 `前缀 + '.'`),否则 'app.scout.wa' 会白白盖住 wait 一族。
  const covered = new Set();
  for (const raw of usedSet) {
    const bare = raw.replace(/\.+$/, '');
    // 尾点是「后面还要接段」的明证,那就永远拼不出 bare 自己,不许精确命中
    if (!/\.$/.test(raw) && bare in base) { covered.add(bare); continue; }
    const kids = baseKeys.filter((k) => k.startsWith(`${bare}.`));
    if (kids.length) for (const k of kids) covered.add(k);
    else errors.push(`用了未定义的文案 key: ${raw}（代码里在用，i18n/${FALLBACK}/ 里没有）`);
  }
  for (const k of baseKeys) {
    if (!covered.has(k)) warnings.push(`定义了但没人用: ${k}`);
  }
  for (const { code: loc, status } of normalizeLocales(locales)) {
    if (loc === FALLBACK) continue;
    const tbl = defined[loc] || {};
    const missing = [];
    const claimed = new Set();
    for (const k of Object.keys(base)) {
      // 复数/序数变体也算「这条有了」—— 见 variantsOf 的头注
      const impl = variantsOf(k, tbl);
      if (!impl.length) { missing.push(k); continue; }
      const a = placeholders(base[k]);
      for (const vk of impl) {
        claimed.add(vk);
        const b = placeholders(tbl[vk]);
        // 比出现次数,不只比有没有 —— 见 placeholders 上方注释。
        // **每个复数变体都要单独比**:AI 翻译很可能只在 _other 里保住占位符,
        // 而 _one 写成 "one item" 把 {n} 丢了 —— 只比其中一条是漏得掉的。
        const diff = [...new Set([...a.keys(), ...b.keys()])]
          .filter((p) => (a.get(p) || 0) !== (b.get(p) || 0))
          .map((p) => `${p}(${a.get(p) || 0}→${b.get(p) || 0})`);
        if (diff.length) {
          const where = vk === k ? k : `${vk}（${FALLBACK} 的 ${k}）`;
          errors.push(`占位符不一致 ${where}（${FALLBACK} vs ${loc}）: ${diff.join(', ')}`);
        }
      }
    }
    if (missing.length) {
      const list = `${loc} 缺 ${missing.length} 条: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`;
      // draft 是「边翻边上」,缺条目运行时回退中文,只提示。
      // released 是已经对外的语言,回退中文 = 英文用户看到中文,必须拦在出包之前。
      if (status === 'released') errors.push(`${list}（已发布语言，缺条目会回退到 ${FALLBACK}）`);
      else info.push(list);
    }
    // 反向:目标语种里有、却不属于任何 base key 的条目。
    // **复数后缀打错(`k_ones`)时正向检查完全看不见** —— 那一条永远不会被取到,
    // 而 `k` 又因为还有 `k_other` 而不算缺,于是两头都不报。只报 warning:
    // 有些项目会在某个语种里放它自己的补充条目,那不算错。
    const orphans = Object.keys(tbl).filter((k) => !claimed.has(k));
    if (orphans.length) {
      warnings.push(`${loc} 有 ${orphans.length} 条不属于任何 ${FALLBACK} key（复数后缀打错的话会长这样）: ${orphans.slice(0, 10).join(', ')}${orphans.length > 10 ? ' …' : ''}`);
    }
  }
  return { errors, warnings, info };
}

export function collectUsedKeys({ root, scan, namespaces }) {
  const keys = new Set();
  const nsAlt = namespaces.map(escapeRe).join('|');
  // key 里允许连字符:`project.trash-talk.name` 这种是真实存在的
  // (2026-09-09 在 WakuwakuDark 上发现:带连字符的 key 一直被报成「没人用」,
  //  因为字符类里没有 `-`。这是个一直在的漏检,迁 Paraglide 才把它照出来。)
  const SEG = '[A-Za-z0-9_-]+';
  // ② 形如 key 的裸字符串字面量(状态表等动态取词的 key 不经 t('...') 出现,靠这条认出来)
  const keyLit = new RegExp(`['"]((?:${nsAlt})\\.${SEG}(?:\\.${SEG})+)['"]`, 'g');
  // ③ 模板 {{ns.x.y}} 占位。前缀限定与②一致,防止 Vue/Astro 花括号插值同形误报。
  const tplLit = new RegExp(`\\{\\{((?:${nsAlt})\\.${SEG}(?:\\.${SEG})+)\\}\\}`, 'g');
  // ④ 方括号取词:`m['ns.a.b']()`。**Paraglide 编译产物只有字符串名导出**
  //    (key 里带点号时它不生成合法标识符的具名导出),所以迁过去之后取词长这样。
  //    要求方括号是关键:它把这条与「碰巧长得像 key 的字符串」分开,
  //    于是可以放宽到 `ns.x` 只有一段 —— `m['site.brand']` 是取词,而裸的 `'site.json'` 不是。
  const bracketLit = new RegExp(`\\[\\s*['"]((?:${nsAlt})\\.${SEG}(?:\\.${SEG})*)['"]\\s*\\]`, 'g');
  const walk = (dir, exts) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (SKIP_DIRS.has(f)) continue;
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) { walk(fp, exts); continue; }
      if (!exts.includes(path.extname(f))) continue;
      const src = fs.readFileSync(fp, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*['"]([A-Za-z][A-Za-z0-9_.-]*)['"]/g)) keys.add(m[1]);
      for (const m of src.matchAll(keyLit)) keys.add(m[1]);
      for (const m of src.matchAll(tplLit)) keys.add(m[1]);
      for (const m of src.matchAll(bracketLit)) keys.add(m[1]);
    }
  };
  for (const s of scan) walk(path.resolve(root, s.dir), s.exts);
  return [...keys];
}
