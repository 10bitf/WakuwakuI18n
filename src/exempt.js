// 豁免标记的识别与过滤。opt-in:CLI 只在消费方 rawLint.exempt === true 时调用本模块。
//
// 与「迁移进度白名单」的区别(这条界线是本机制成立的前提):
//   白名单说"这句还没来得及迁"——本该随迁移完成清空,实际会越拖越长;
//   豁免说"这句根本不是用户可见文案"——稳定事实,不因工作做完而消失。
// 四条反退化约束:① 标记写在文件/行自己头上,不是配置里的一份清单(改一行就能躲检查);
// ② 理由必填,空理由不生效;③ 每次检查打印豁免全量清单;④ 能机械校验处就校验。
//
// 第五条约束:标记必须写在**真注释**里才生效,不是随便一处文本里出现这行字就算数——
// 四条正则本身不感知词法上下文(字符串字面量 vs 注释 vs 伪装成注释的模板文本),
// 单靠正则会被"字符串里恰好写了这行字"「自己给自己开后门」。校验办法不新写一套分词器,
// 而是复用 lint-raw.js 已经算好的 masked(区域感知等长遮蔽结果):真注释在遮蔽后会变成
// 空白;字符串字面量里的同形文本遮蔽后原样保留、非空白。可选参数 masked 就是干这个的——
// 省略时(纯逻辑单测)行为与之前完全一致,不做词法校验。

// [^\S\n] 是"不含换行的空白"。这里不能用 \s:\s 含换行,会把**下一行**的内容
// 当成理由,于是"空理由不生效"这条约束被悄悄绕过(Photoman 改造时踩过一次)。
const FILE_HTML_RE = /^[^\S\n]*<!--[^\S\n]*i18n-exempt:[^\S\n]*(.*?)[^\S\n]*-->/m;
const FILE_JS_RE = /^[^\S\n]*\/\/[^\S\n]*i18n-exempt:[^\S\n]*(.*)$/m;

// 标记的整段匹配([start, end))在 masked 的同一区间必须全是空白,才算「确实写在真注释里」。
// masked 与 src 等长且逐字符位置对齐(lint-raw.js 的遮蔽契约),两种正则的匹配本身都不跨行,
// 直接按字符偏移去 masked 上取同一段来看即可。
function markerInComment(masked, src, start, end) {
  if (masked == null) return true; // 未传 masked:向后兼容,不做词法校验
  // 位置核验的前提是两串逐字符对齐。长度不一致说明调用方传错了(遮蔽契约是等长),
  // 此时**必须抛错而不是退回宽松**——静默降级只会让豁免更容易生效,方向正好错在
  // 最不该错的地方(豁免误开=给漏检开后门)。
  if (String(masked).length !== String(src).length) {
    throw new Error('exempt: masked 与 src 长度不一致,无法核验标记位置(遮蔽必须等长)');
  }
  return /^\s*$/.test(String(masked).slice(start, end));
}

// 只认最前三行:.html 第一行要留给 <!doctype html>(注释挤在它前面会让老 IE 进怪异模式),
// 标记只能写在其后。三行的上限也不至于让文件深处一句无关注释误开整份豁免。
export function fileExemptReason(src, masked) {
  const s = String(src);
  const head = s.split('\n').slice(0, 3).join('\n');
  const m = FILE_HTML_RE.exec(head) || FILE_JS_RE.exec(head);
  if (!m) return null;
  if (!markerInComment(masked, s, m.index, m.index + m[0].length)) return null; // 标记躲在字符串/伪注释里:不生效
  const reason = m[1].trim();
  return reason || null;
}

// 行级只做「与命中同行」这一种形态。两种语法都认:模板区写 <!-- -->,脚本区写 //。
const LINE_HTML_RE = /<!--[^\S\n]*i18n-exempt-line:[^\S\n]*(.*?)[^\S\n]*-->/;
const LINE_JS_RE = /\/\/[^\S\n]*i18n-exempt-line:[^\S\n]*(.*)$/;

export function collectLineExemptions(src, masked) {
  const s = String(src);
  const map = new Map();
  let offset = 0;
  s.split('\n').forEach((line, idx) => {
    const m = LINE_HTML_RE.exec(line) || LINE_JS_RE.exec(line);
    if (m) {
      const reason = m[1].trim();
      const start = offset + m.index;
      const end = start + m[0].length;
      if (reason && markerInComment(masked, s, start, end)) map.set(idx + 1, reason);
    }
    offset += line.length + 1; // +1 补回 split 吃掉的 '\n';末行会多算一位,但已无后续行可用,无副作用
  });
  return map;
}

// 命中行挂着带理由的标记就挪进 exempt(仍要被打印出来,不是静默丢弃)。
export function splitByLineExemption(src, hits, masked) {
  const map = collectLineExemptions(src, masked);
  const kept = [], exempt = [];
  for (const h of hits) {
    const reason = map.get(h.line);
    if (reason) exempt.push({ ...h, reason });
    else kept.push(h);
  }
  return { hits: kept, exempt };
}
