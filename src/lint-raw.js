// 「禁止裸中文」检查纯逻辑。tools/lint-raw.mjs 是薄 CLI 入口,这里是可被 node --test 直测的库。
//
// 架构:区域感知等长遮蔽,脚本区为单趟词法扫描(tokenizer)。
// 按文件扩展名把内容切成不同区域,各区域只遮蔽"确定不是用户可见文案"的部分,遮蔽用等长空格
// 逐字符替换而不是删除——原文行号与列偏移全程不变。遮蔽完之后用 findRawHan 逐行找汉字即可。
//
// 区域划分:
//   frontmatter(.astro 文件开头的 ---\n…\n---)  按脚本区处理
//   <script>…</script>                          按脚本区处理
//   <style>…</style>                             只遮蔽 CSS 注释(content:"中文" 是真文案,留着)
//   其余(模板区,默认)                            只遮蔽 HTML 注释(// 绝不当模板区的注释起点)
// 非标签类文件(.js/.ts/.mjs/.cjs)整个文件按脚本区处理;扩展名未知时按模板区保守处理。
//
// 脚本区管线(单趟 tokenizer,不是多趟各自分词):
//   1. 一次逐字符扫描产出 token 序列:string(单双引号与模板串字面段,模板 ${} 内部按代码
//      递归处理)、comment(行/块)、regex(正则字面量)、code(其余)。每个 token 标注 [start, end)。
//   2. 注释与正则的遮蔽直接由 token 得出——不再用正则去原文里找。
//   3. t()/console() 实参与 import/export 路径的搜索只在"骨架视图"(字符串/注释/正则全部
//      置空格后的纯代码结构)上进行——字符串内部的 "t(" / "import" / 括号不可能触发遮蔽。
// 早期 pass 不再可能破坏后期 pass 才懂的语法结构:所有遮蔽共享同一份词法事实。
//
// Fail-safe 原则(必须保持):本检查是硬卡,漏检=未翻译文案静默上线(无人察觉),
// 误报=构建失败(有人看见、能修)。因此所有"拿不准"的分支一律落在「不遮蔽」侧——
// 宁可多报,不可少报。具体:括号不闭合的 t()/console() 放弃遮蔽;块注释不闭合当代码;
// 字符串不闭合止于行尾;正则行内不闭合当除法;import/export 语句形状看不懂就不遮路径。

const SCRIPT_ONLY_EXTS = new Set(['.js', '.ts', '.mjs', '.cjs']);

const mask = (s) => s.replace(/[^\n]/g, ' ');

// ---------- 脚本区单趟 tokenizer ----------

// 正则 vs 除法:看前一个有意义 token(按词判断,不是按尾字符)。
// 标识符/数字/字符串/正则等"值"之后、以及 ) ] } 之后按除法;
// 下列关键字、以及运算符与 ( [ { , ; => 之后按正则。
const REGEX_PREV_KEYWORDS = new Set([
  'return', 'case', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
  'void', 'throw', 'do', 'else', 'yield', 'await',
]);

function regexAllowed(prev) {
  if (prev === null) return true; // 区域起点即表达式起点
  if (prev.kind === 'value') return false;
  if (prev.kind === 'word') return REGEX_PREV_KEYWORDS.has(prev.text);
  return !(prev.text === ')' || prev.text === ']' || prev.text === '}');
}

// 从 i(指向 '/')尝试识别正则字面量,返回 token 结束位置(含 flags);
// 行内未闭合返回 -1——正则字面量不能跨行,拿不准就当除法,不遮蔽(fail-safe)。
function scanRegexLiteral(code, i) {
  const n = code.length;
  let j = i + 1;
  let inClass = false;
  while (j < n) {
    const c = code[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '\n') return -1;
    if (c === '[') { inClass = true; j++; continue; }
    if (c === ']') { inClass = false; j++; continue; }
    if (c === '/' && !inClass) {
      j++;
      while (j < n && /[a-zA-Z]/.test(code[j])) j++; // flags
      return j;
    }
    j++;
  }
  return -1;
}

const WORD_CHAR = /[A-Za-z0-9_$]/;

// 单趟逐字符扫描,产出 { type: 'string'|'comment'|'regex'|'code', start, end } 序列。
// token 首尾相接覆盖全文;模板串的字面段是 string,${} 内部是正常代码(可含嵌套一切)。
function tokenize(code) {
  const n = code.length;
  const tokens = [];
  const push = (type, start, end) => {
    if (end > start) tokens.push({ type, start: Math.max(0, start), end: Math.min(end, n) });
  };

  const tplStack = []; // 每层是一个 ${} 表达式的花括号深度计数
  let prev = null;     // 前一个有意义 token:{ kind: 'word'|'punct'|'value', text? }
  let i = 0;
  let codeStart = 0;

  // 模板字面段:从 from(指向 ` 或结束 ${} 的 })扫到 ` 收尾或下一个 ${。
  const lexTemplateChunk = (from) => {
    let j = from + 1;
    while (j < n) {
      const c = code[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') { push('string', from, j + 1); prev = { kind: 'value' }; return j + 1; }
      if (c === '$' && code[j + 1] === '{') {
        push('string', from, j + 2); // 字面段含 ${ 结尾
        tplStack.push({ depth: 0 });
        prev = { kind: 'punct', text: '(' }; // ${ 之后是表达式起点,允许正则
        return j + 2;
      }
      j++;
    }
    push('string', from, n); // 模板未闭合:字面段止于文件尾,不吞更多结构
    prev = { kind: 'value' };
    return n;
  };

  while (i < n) {
    const c = code[i];
    const c2 = code[i + 1];

    if (c === '/' && c2 === '/') { // 行注释(字符串/正则内的 // 到不了这里)
      push('code', codeStart, i);
      let j = i + 2;
      while (j < n && code[j] !== '\n') j++;
      push('comment', i, j);
      i = j; codeStart = i;
      continue; // 注释不改变 prev
    }

    if (c === '/' && c2 === '*') {
      let j = i + 2;
      while (j < n && !(code[j] === '*' && code[j + 1] === '/')) j++;
      if (j < n) {
        push('code', codeStart, i);
        push('comment', i, j + 2);
        i = j + 2; codeStart = i;
        continue;
      }
      // 块注释不闭合:保守放弃,按普通代码字符继续(fail-safe:不遮蔽)
      prev = { kind: 'punct', text: '/' };
      i++;
      continue;
    }

    if (c === '\'' || c === '"') {
      push('code', codeStart, i);
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === c) { j++; break; }
        if (code[j] === '\n') break; // 字符串不闭合:止于行尾,不吞后续行(fail-safe)
        j++;
      }
      push('string', i, j);
      i = Math.min(j, n); codeStart = i;
      prev = { kind: 'value' };
      continue;
    }

    if (c === '`') {
      push('code', codeStart, i);
      i = lexTemplateChunk(i);
      codeStart = i;
      continue;
    }

    if (c === '}' && tplStack.length && tplStack[tplStack.length - 1].depth === 0) {
      // ${} 表达式结束,回到模板字面段
      push('code', codeStart, i);
      tplStack.pop();
      i = lexTemplateChunk(i);
      codeStart = i;
      continue;
    }

    if (c === '/') { // 上面排除了 // 与 /*,这里只剩正则或除法
      if (regexAllowed(prev)) {
        const end = scanRegexLiteral(code, i);
        if (end !== -1) {
          push('code', codeStart, i);
          push('regex', i, end);
          i = end; codeStart = i;
          prev = { kind: 'value' };
          continue;
        }
      }
      prev = { kind: 'punct', text: '/' };
      i++;
      continue;
    }

    if (WORD_CHAR.test(c)) {
      let j = i + 1;
      while (j < n && WORD_CHAR.test(code[j])) j++;
      prev = { kind: 'word', text: code.slice(i, j) };
      i = j;
      continue;
    }

    if (!/\s/.test(c)) {
      if (c === '{' && tplStack.length) tplStack[tplStack.length - 1].depth++;
      else if (c === '}' && tplStack.length) tplStack[tplStack.length - 1].depth--;
      if (c === '=' && c2 === '>') { prev = { kind: 'punct', text: '=>' }; i += 2; }
      else { prev = { kind: 'punct', text: c }; i++; }
      continue;
    }

    i++; // 空白:prev 不变
  }
  push('code', codeStart, n);
  return tokens;
}

// 等长遮蔽 [s, e):除换行外全部置空格。
function maskRange(arr, code, s, e) {
  const lim = Math.min(e, arr.length);
  for (let m = Math.max(0, s); m < lim; m++) arr[m] = code[m] === '\n' ? '\n' : ' ';
}

// ---------- t(...) / console.*(...) 实参遮蔽:只在骨架上搜索与配对 ----------
// 骨架里字符串/注释/正则都是空格:字符串内部的 "t(" 匹配不到,实参字符串里的括号也不参与配对。
function maskCallArgs(skeleton, code, out, calleeRe) {
  const re = new RegExp(calleeRe.source, 'g');
  let m;
  while ((m = re.exec(skeleton))) {
    const openIdx = m.index + m[0].length - 1; // '(' 的位置
    let depth = 1;
    let j = openIdx + 1;
    while (j < skeleton.length && depth > 0) {
      const c = skeleton[j];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      j++;
    }
    if (depth === 0) maskRange(out, code, m.index, j);
    // 括号不闭合:保守放弃,不遮蔽(fail-safe:宁可误报,不可静默漏检)
  }
}

const T_CALL_RE = /\bt\(/;
const CONSOLE_CALL_RE = /\bconsole\s*\.\s*\w+\s*\(/;

// ---------- import/export 路径遮蔽:骨架上找关键字,按语句形状白名单逐字符前进 ----------
// 支持跨行(多行 import 的 `} from "…"` 形态)与动态 import("路径")。
// 白名单外的任何字符都表示"形状看不懂",立即放弃该语句,不遮蔽(fail-safe)。
// export 必须先见 from 才认路径——`export const s = "中文导出值"`、`export default "文案"`
// 是真文案,不遮。字符串位置一律以 token 表为准,不看骨架字符(骨架里字符串已是空格)。
function maskImportPaths(skeleton, code, out, stringStarts) {
  const kwRe = /\b(import|export)\b/g;
  let m;
  while ((m = kwRe.exec(skeleton))) {
    // obj.import(...) 这类属性访问不是模块语句
    let p = m.index - 1;
    while (p >= 0 && /[ \t]/.test(skeleton[p])) p--;
    if (p >= 0 && skeleton[p] === '.') continue;

    const isExport = m[1] === 'export';
    let j = m.index + m[1].length;
    let sawFrom = false;
    let sawAnything = false;
    while (j < skeleton.length) {
      const tok = stringStarts.get(j);
      if (tok) {
        // 到达字符串字面量:import 直跟字符串(副作用导入)或 from 之后的字符串才是路径
        if (isExport ? sawFrom : (sawFrom || !sawAnything)) maskRange(out, code, tok.start, tok.end);
        break;
      }
      const c = skeleton[j];
      if (/\s/.test(c)) { j++; continue; } // 空白与被遮蔽的注释都可穿过
      if (WORD_CHAR.test(c)) {
        let k = j + 1;
        while (k < skeleton.length && WORD_CHAR.test(skeleton[k])) k++;
        if (skeleton.slice(j, k) === 'from') sawFrom = true;
        sawAnything = true;
        j = k;
        continue;
      }
      if (c === '{' || c === '}' || c === ',' || c === '*') { sawAnything = true; j++; continue; }
      if (c === '(' && !isExport && !sawAnything) {
        // 动态 import("路径"):只认 ( 后紧邻(仅隔空白/已遮注释)的字符串字面量
        let k = j + 1;
        while (k < skeleton.length && !stringStarts.has(k) && /\s/.test(skeleton[k])) k++;
        const arg = stringStarts.get(k);
        if (arg) maskRange(out, code, arg.start, arg.end);
        break;
      }
      break; // 白名单外的字符:形状看不懂,保守放弃(fail-safe)
    }
  }
}

// ---------- 脚本区总装 ----------
function maskScriptRegion(code) {
  const tokens = tokenize(code);
  const out = code.split('');
  const skeletonArr = code.split('');
  const stringStarts = new Map(); // start -> token,字符串位置的唯一事实来源
  for (const t of tokens) {
    if (t.type === 'comment' || t.type === 'regex') {
      maskRange(out, code, t.start, t.end);        // 注释/正则遮蔽直接由 token 得出
      maskRange(skeletonArr, code, t.start, t.end);
    } else if (t.type === 'string') {
      maskRange(skeletonArr, code, t.start, t.end); // 骨架里字符串不可见,但产出里保留(候选文案)
      stringStarts.set(t.start, t);
    }
  }
  const skeleton = skeletonArr.join('');
  maskCallArgs(skeleton, code, out, T_CALL_RE);
  maskCallArgs(skeleton, code, out, CONSOLE_CALL_RE);
  maskImportPaths(skeleton, code, out, stringStarts);
  return out.join('');
}

// ---------- 模板区:只遮蔽 HTML 注释 ----------
function maskHtmlComments(code) {
  return code.replace(/<!--[\s\S]*?-->/g, mask);
}

// ---------- <style> 区 / 独立样式文件(.scss/.css):遮蔽注释,字符串与 url() 感知 ----------
// SCSS 有 // 行注释;但 // 也合法出现在字符串("//x")与未加引号的 url(//host/x) 里,
// 那两处若误当注释会把真文案遮进漏检侧(content:"中文" 是用户可见文案)。
// 故单趟扫描:字符串与 url(...) 内不认注释起点。fail-safe 与脚本区同向:
// 块注释不闭合当普通字符(不遮蔽);字符串不闭合止于行尾。
function maskStyleComments(code) {
  const out = code.split('');
  const n = code.length;
  const blank = (s, e) => { for (let k = s; k < e && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  let lastWord = '';
  while (i < n) {
    const c = code[i];
    const c2 = code[i + 1];
    if (c === '"' || c === '\'') {
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === c) { j++; break; }
        if (code[j] === '\n') break; // 不闭合:止于行尾,不吞后续行(fail-safe)
        j++;
      }
      i = Math.min(j, n); lastWord = ''; continue;
    }
    if (c === '(' && lastWord.toLowerCase() === 'url') {
      // url(...) 未加引号的内容可含 //(协议相对地址),不是注释;引号内容在上面的字符串分支
      let j = i + 1;
      while (j < n && code[j] !== ')' && code[j] !== '\n') {
        if (code[j] === '"' || code[j] === '\'') {
          const q = code[j]; j++;
          while (j < n && code[j] !== q && code[j] !== '\n') { if (code[j] === '\\') j++; j++; }
        }
        j++;
      }
      i = Math.min(j, n); lastWord = ''; continue;
    }
    if (c === '/' && c2 === '*') {
      let j = i + 2;
      while (j < n && !(code[j] === '*' && code[j + 1] === '/')) j++;
      if (j < n) { blank(i, j + 2); i = j + 2; lastWord = ''; continue; }
      i++; continue; // 块注释不闭合:保守放弃,不遮蔽(fail-safe)
    }
    if (c === '/' && c2 === '/') {
      let j = i + 2;
      while (j < n && code[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (/[A-Za-z-]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9-]/.test(code[j])) j++;
      lastWord = code.slice(i, j);
      i = j; continue;
    }
    if (!/\s/.test(c)) lastWord = '';
    i++;
  }
  return out.join('');
}

// ---------- .json / .jsonc:只留"值",键、注释、_ 前缀子树全遮蔽 ----------
// JSON 的键也是带引号的字符串,拿广义"任意字符串字面量"去扫会把键一并抓走,而键从不是用户可见文案。
// 注释遮蔽与键值判定放在**同一趟**里做:分趟会重蹈"各步骤分词不同步"的覆辙
// (字符串里的 // 被当注释、注释里的引号扰乱键值判定,两个方向都会静默扩大遮蔽面)。
// 与脚本区 tokenizer 同一 fail-safe 方向,三处拿不准一律不遮蔽:字符串遇换行未闭合就止步
// (不跨行吞下一句)、键位字符串其后没有冒号就当值处理(不是键就不该被遮蔽)、块注释到 EOF
// 都找不到 */ 就放弃当注释(按普通字符继续,原文照报)。
function maskJsonNonProse(src) {
  const out = src.split('');
  const blank = (s, e) => { for (let k = s; k < e; k++) if (out[k] !== '\n') out[k] = ' '; };
  const stack = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {          // JSONC 行注释
      let e = i; while (e < n && src[e] !== '\n') e++;
      blank(i, e); i = e; continue;
    }
    if (c === '/' && src[i + 1] === '*') {          // JSONC 块注释
      let e = i + 2; while (e < n && !(src[e] === '*' && src[e + 1] === '/')) e++;
      if (e < n) { blank(i, e + 2); i = e + 2; continue; }
      // 未闭合:保守放弃,按普通字符继续扫描,不遮蔽(fail-safe:宁可误报,不可静默漏检)
    }
    if (c === '{') { stack.push({ type: 'obj', key: null, expectKey: true }); i++; continue; }
    if (c === '[') { stack.push({ type: 'arr', key: null, expectKey: false }); i++; continue; }
    if (c === '}' || c === ']') { stack.pop(); i++; continue; }
    if (c === ':') { const t = stack[stack.length - 1]; if (t && t.type === 'obj') t.expectKey = false; i++; continue; }
    if (c === ',') { const t = stack[stack.length - 1]; if (t && t.type === 'obj') t.expectKey = true; i++; continue; }
    if (c === '"' || c === "'") {
      const q = c, start = i;
      i++;
      let value = '';
      let terminated = false;
      while (i < n) {
        // 转义分支要先看被转义的那个字符是不是裸换行:`\` + 换行在 JSON/JSONC 里非法,
        // 若照常 i+=2 跨过去,下面那条换行止损就够不着,又会一路吞到 EOF(漏检侧)。
        if (src[i] === '\\') {
          if (src[i + 1] === '\n' || src[i + 1] === undefined) break;
          value += src[i + 1]; i += 2; continue;
        }
        if (src[i] === q) { i++; terminated = true; break; }
        if (src[i] === '\n') break;                 // 不跨行:止于换行,不吞后续行(fail-safe,镜像脚本区 tokenizer)
        value += src[i]; i++;
      }
      if (!terminated) continue;                     // 未闭合:保守放弃,不遮蔽(fail-safe)
      const top = stack[stack.length - 1];
      if (top && top.type === 'obj' && top.expectKey) {
        let p = i;
        while (p < n && /\s/.test(src[p])) p++;
        if (src[p] === ':') { top.key = value; blank(start, i); continue; }  // 键位字符串且其后确有冒号:遮蔽
        // 其后没有冒号:不是真正的键,按值处理(落到下面)
      }
      // 值:键路径上任一段以 _ 开头(_note 这类给人看的说明)整棵跳过,与 load.js 对 _ 的口径一致
      const keyPath = stack.filter((f) => f.type === 'obj').map((f) => f.key).filter((k) => k != null);
      if (keyPath.some((k) => k.startsWith('_'))) blank(start, i);
      continue;                                     // 其余值保留,交给 findRawHan
    }
    i++;
  }
  return out.join('');
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
    result += r.type === 'script' ? maskScriptRegion(body) : maskStyleComments(body);
    cursor = r.end;
  }
  result += maskHtmlComments(src.slice(cursor));
  return result;
}

// ---------- 对外接口:按扩展名把内容交给对应管线 ----------
export function maskNonProse(src, ext) {
  const e = String(ext || '').toLowerCase();
  if (SCRIPT_ONLY_EXTS.has(e)) return maskScriptRegion(String(src));
  if (e === '.json' || e === '.jsonc') return maskJsonNonProse(String(src));
  if (e === '.scss' || e === '.css') return maskStyleComments(String(src));
  // .astro/.vue/.html 同为"模板 + <script> + <style>"结构,共用四区管线
  // (.vue/.html 没有 --- frontmatter,maskAstro 的围栏检测自然不匹配,直接复用即可)
  if (e === '.astro' || e === '.vue' || e === '.html' || e === '.htm') return maskAstro(String(src));
  return maskHtmlComments(String(src));            // 未知扩展名:保守只遮 HTML 注释
}

export function findRawHan(src) {
  const hits = [];
  String(src).split('\n').forEach((text, i) => {
    if (/[一-鿿]/.test(text)) hits.push({ line: i + 1, text: text.trim() });
  });
  return hits;
}
