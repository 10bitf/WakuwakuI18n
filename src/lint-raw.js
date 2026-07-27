// 「禁止裸中文」检查纯逻辑。tools/lint-raw.mjs 是薄 CLI 入口,这里是可被 node --test 直测的库。
//
// 架构:区域感知等长遮蔽。按文件扩展名把内容切成不同区域,各区域只遮蔽"确定不是用户可见文案"
// 的部分(注释、正则字面量、import/export 路径、t()/console() 的整个实参……),遮蔽用等长空格
// 逐字符替换而不是删除——原文行号与列偏移全程不变。遮蔽完之后用 findRawHan 逐行找汉字即可。
//
// 区域划分:
//   frontmatter(.astro 文件开头的 ---\n…\n---)  按脚本区处理
//   <script>…</script>                          按脚本区处理
//   <style>…</style>                             只遮蔽 CSS 注释(content:"中文" 是真文案,留着)
//   其余(模板区,默认)                            只遮蔽 HTML 注释(// 绝不当模板区的注释起点)
// 非标签类文件(.js/.ts/.mjs/.cjs)整个文件按脚本区处理;扩展名未知时按模板区保守处理。
//
// 脚本区遮蔽管线(逐字符状态机,不是"整文一把正则"):
//   1. 字符串字面量('/"/`,含 \ 转义)整体跳过——字符串内部的 // 和 /* */ 不是注释起点(D1 根治点)。
//   2. 真注释(// 到行尾、/* */ 跨行)遮蔽。
//   3. 正则字面量 /…/flags 遮蔽(D3)——靠"/ 前一个非空白字符"启发式区分正则与除法。
//   4. import/export 的路径字面量遮蔽(D5)。
//   5. t(...) 与 console.*(...) 的整个实参遮蔽(D4)——括号深度匹配,期间跳过字符串。

const SCRIPT_ONLY_EXTS = new Set(['.js', '.ts', '.mjs', '.cjs']);

const mask = (s) => s.replace(/[^\n]/g, ' ');

// ---------- 脚本区 1+2:字符串边界感知 + 真注释遮蔽 ----------
function maskComments(code) {
  let out = '';
  const n = code.length;
  let i = 0;
  while (i < n) {
    const c = code[i], c2 = code[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && code[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      out += '  '; i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
        out += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c;
      out += c; i++;
      while (i < n) {
        if (code[i] === '\\') { out += code[i] + (code[i + 1] || ''); i += 2; continue; }
        if (code[i] === q) { out += code[i]; i++; break; }
        out += code[i]; i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

// ---------- 脚本区 3:正则字面量遮蔽,区分正则与除法 ----------
// 只在"/ 前一个有意义字符"处于明确不可能是除法左操作数结尾的位置时才当正则解析;
// 标识符/数字/)/] 之后一律当除法,不解析——宁可漏遮蔽也不误伤除法表达式。
function maskRegexLiterals(code) {
  const REGEX_OK_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', ';', '{', '}', '+', '-', '*', '%', '<', '>', '\n', '']);
  const out = code.split('');
  const n = code.length;
  let i = 0;
  let prevSig = '';
  while (i < n) {
    const c = code[i];
    if (c === '\'' || c === '"' || c === '`') {
      const q = c; i++;
      while (i < n) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === q) { i++; break; }
        i++;
      }
      prevSig = q;
      continue;
    }
    if (c === '/' && REGEX_OK_PREV.has(prevSig)) {
      let j = i + 1, inClass = false, closed = false;
      while (j < n) {
        const cj = code[j];
        if (cj === '\\') { j += 2; continue; }
        if (cj === '\n') break; // 未闭合,不是正则,回退当普通字符处理
        if (cj === '[') { inClass = true; j++; continue; }
        if (cj === ']') { inClass = false; j++; continue; }
        if (cj === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed && j > i + 1) {
        let k = j + 1;
        while (k < n && /[a-zA-Z]/.test(code[k])) k++; // 吞掉 flags
        for (let m = i; m < k; m++) out[m] = code[m] === '\n' ? '\n' : ' ';
        i = k; prevSig = '/';
        continue;
      }
    }
    out[i] = c;
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.join('');
}

// ---------- 脚本区 4:import/export 路径字面量遮蔽 ----------
// import 覆盖 `import ... from "路径"`、`import "路径"`、`import("路径")`;
// export 额外要求出现 from,避免把 `export const s = "中文导出值"` 这种真文案误当路径遮蔽掉。
function maskImportPaths(code) {
  const maskLit = (full, q, val) => {
    const head = full.slice(0, full.length - (val.length + 2));
    return head + q + mask(val) + q;
  };
  return code
    .replace(/\bimport\b[^;\n'"`]*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g, maskLit)
    .replace(/\bexport\b[^;\n'"`]*\bfrom\b[^;\n'"`]*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g, maskLit);
}

// ---------- 脚本区 5:t(...) / console.*(...) 整个实参遮蔽,括号深度匹配,期间跳过字符串 ----------
function maskCallArgs(code, calleeRe) {
  const re = new RegExp(calleeRe.source, 'g');
  const out = code.split('');
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(code))) {
    const openIdx = m.index + m[0].length - 1; // '(' 的位置
    let depth = 1, j = openIdx + 1;
    while (j < code.length && depth > 0) {
      const c = code[j];
      if (c === '\'' || c === '"' || c === '`') {
        const q = c; j++;
        while (j < code.length) {
          if (code[j] === '\\') { j += 2; continue; }
          if (code[j] === q) { j++; break; }
          j++;
        }
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') depth--;
      j++;
    }
    for (let k = m.index; k < j && k < out.length; k++) {
      out[k] = out[k] === '\n' ? '\n' : ' ';
    }
  }
  return out.join('');
}

const T_CALL_RE = /\bt\(/;
const CONSOLE_CALL_RE = /\bconsole\s*\.\s*\w+\s*\(/;

function maskScriptRegion(code) {
  let out = maskComments(code);
  out = maskRegexLiterals(out);
  out = maskImportPaths(out);
  out = maskCallArgs(out, T_CALL_RE);
  out = maskCallArgs(out, CONSOLE_CALL_RE);
  return out;
}

// ---------- 模板区:只遮蔽 HTML 注释 ----------
function maskHtmlComments(code) {
  return code.replace(/<!--[\s\S]*?-->/g, mask);
}

// ---------- <style> 区:只遮蔽 CSS 注释 ----------
function maskStyleCssComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, mask);
}

// ---------- .astro:frontmatter + <script> 按脚本区处理,<style> 只遮蔽 CSS 注释,其余模板区只遮蔽 HTML 注释 ----------
function maskAstro(src) {
  const regions = []; // { start, end, type: 'script' | 'style' }

  const fm = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/d.exec(src);
  if (fm && fm.indices && fm.indices[1]) {
    const [s, e] = fm.indices[1];
    regions.push({ start: s, end: e, type: 'script' });
  }

  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gid;
  let sm;
  while ((sm = scriptRe.exec(src))) {
    const [s, e] = sm.indices[1];
    regions.push({ start: s, end: e, type: 'script' });
  }

  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gid;
  let ym;
  while ((ym = styleRe.exec(src))) {
    const [s, e] = ym.indices[1];
    regions.push({ start: s, end: e, type: 'style' });
  }

  regions.sort((a, b) => a.start - b.start);

  let result = '';
  let cursor = 0;
  for (const r of regions) {
    if (r.start < cursor) continue; // 防御:异常重叠(不应发生)时跳过,不越界重算
    result += maskHtmlComments(src.slice(cursor, r.start));
    const body = src.slice(r.start, r.end);
    result += r.type === 'script' ? maskScriptRegion(body) : maskStyleCssComments(body);
    cursor = r.end;
  }
  result += maskHtmlComments(src.slice(cursor));
  return result;
}

// ---------- 对外接口:按扩展名把内容交给对应管线 ----------
export function maskNonProse(src, ext) {
  const code = String(src);
  const e = String(ext || '').toLowerCase();
  if (SCRIPT_ONLY_EXTS.has(e)) return maskScriptRegion(code);
  if (e === '.astro') return maskAstro(code);
  return maskHtmlComments(code); // 扩展名未知(或其它未识别类型):模板区保守处理
}

export function findRawHan(src) {
  const hits = [];
  String(src).split('\n').forEach((text, i) => {
    if (/[一-鿿]/.test(text)) hits.push({ line: i + 1, text: text.trim() });
  });
  return hits;
}
