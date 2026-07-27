// 豁免标记的识别与过滤。opt-in:CLI 只在消费方 rawLint.exempt === true 时调用本模块。
//
// 与「迁移进度白名单」的区别(这条界线是本机制成立的前提):
//   白名单说"这句还没来得及迁"——本该随迁移完成清空,实际会越拖越长;
//   豁免说"这句根本不是用户可见文案"——稳定事实,不因工作做完而消失。
// 四条反退化约束:① 标记写在文件/行自己头上,不是配置里的一份清单(改一行就能躲检查);
// ② 理由必填,空理由不生效;③ 每次检查打印豁免全量清单;④ 能机械校验处就校验。

// [^\S\n] 是"不含换行的空白"。这里不能用 \s:\s 含换行,会把**下一行**的内容
// 当成理由,于是"空理由不生效"这条约束被悄悄绕过(Photoman 改造时踩过一次)。
const FILE_HTML_RE = /^[^\S\n]*<!--[^\S\n]*i18n-exempt:[^\S\n]*(.*?)[^\S\n]*-->/m;
const FILE_JS_RE = /^[^\S\n]*\/\/[^\S\n]*i18n-exempt:[^\S\n]*(.*)$/m;

// 只认最前三行:.html 第一行要留给 <!doctype html>(注释挤在它前面会让老 IE 进怪异模式),
// 标记只能写在其后。三行的上限也不至于让文件深处一句无关注释误开整份豁免。
export function fileExemptReason(src) {
  const head = String(src).split('\n').slice(0, 3).join('\n');
  const m = FILE_HTML_RE.exec(head) || FILE_JS_RE.exec(head);
  if (!m) return null;
  const reason = m[1].trim();
  return reason || null;
}

// 行级只做「与命中同行」这一种形态。两种语法都认:模板区写 <!-- -->,脚本区写 //。
const LINE_HTML_RE = /<!--[^\S\n]*i18n-exempt-line:[^\S\n]*(.*?)[^\S\n]*-->/;
const LINE_JS_RE = /\/\/[^\S\n]*i18n-exempt-line:[^\S\n]*(.*)$/;

export function collectLineExemptions(src) {
  const map = new Map();
  String(src).split('\n').forEach((line, idx) => {
    const m = LINE_HTML_RE.exec(line) || LINE_JS_RE.exec(line);
    if (!m) return;
    const reason = m[1].trim();
    if (reason) map.set(idx + 1, reason);
  });
  return map;
}

// 命中行挂着带理由的标记就挪进 exempt(仍要被打印出来,不是静默丢弃)。
export function splitByLineExemption(src, hits) {
  const map = collectLineExemptions(src);
  const kept = [], exempt = [];
  for (const h of hits) {
    const reason = map.get(h.line);
    if (reason) exempt.push({ ...h, reason });
    else kept.push(h);
  }
  return { hits: kept, exempt };
}
