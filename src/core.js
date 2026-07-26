// 文案取词纯逻辑。刻意不依赖 vue/uni —— 与 core 下其他模块同规矩,node 可直测。
// Vue 响应式与本地存储在 miniapp/src/i18n/index.js 里包一层,别把它们混进来。
export const FALLBACK_LOCALE = 'zh';

// 嵌套对象 → 点分 key 表。以 _ 开头的键是给人看的说明(如 _note),不入表。
export function flatten(obj, prefix = '', out = {}) {
  for (const k of Object.keys(obj || {})) {
    if (k.startsWith('_')) continue;
    const key = prefix ? prefix + '.' + k : k;
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

// {name} 按名字替换。用名字而非位置,因为英文语序常与中文不同,位置参数会错位。
// 未提供的占位符原样保留(便于一眼看出漏传),非标识符的花括号不动。
// null/undefined 视同"没提供"同样保留原样——否则会把 "undefined"/"null" 当真文案打给用户看。
export function interpolate(tpl, vars) {
  if (!vars) return tpl;
  return String(tpl).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null ? String(vars[name]) : m);
}

// tables: { [locale]: { [flatKey]: text } };getLocale 每次调用现取,故切换语言后立刻生效。
export function makeT(tables, getLocale, onMissing) {
  return function t(key, vars) {
    const loc = getLocale();
    let s = tables[loc] ? tables[loc][key] : undefined;
    if (s == null && loc !== FALLBACK_LOCALE) {
      s = tables[FALLBACK_LOCALE] ? tables[FALLBACK_LOCALE][key] : undefined;
    }
    if (s == null) {
      if (onMissing) onMissing(key, loc);
      return '';                      // 绝不把 key 原样显示给用户
    }
    return interpolate(s, vars);
  };
}

// 用户存储的选择 > 系统语言 > 缺省。系统语言可能是 zh_CN / en-US 这类带地区码的形式。
export function resolveLocale(stored, system, supported, fallback = FALLBACK_LOCALE) {
  if (stored && supported.includes(stored)) return stored;
  if (system) {
    const norm = String(system).toLowerCase().replace(/_/g, '-');
    const hit = supported.find((l) => norm === l || norm.startsWith(l + '-'));
    if (hit) return hit;
  }
  return fallback;
}
