// 「禁止裸中文」检查纯逻辑。tools/lint-raw.mjs 是薄 CLI 入口,这里是可被 node --test 直测的库。
// 注释不扫(中文注释是资产不是问题);检测对象是汉字,假名/拉丁装饰词放行。
export function stripComments(src) {
  return String(src)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');   // 保住 https:// 之类,牺牲极少数行首 // 场景
}

export function findRawHan(src) {
  const hits = [];
  String(src).split('\n').forEach((text, i) => {
    if (/[一-鿿]/.test(text)) hits.push({ line: i + 1, text: text.trim() });
  });
  return hits;
}
