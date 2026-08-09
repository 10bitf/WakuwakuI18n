// 语言包资源校验纯逻辑。tools/check.mjs 调它;这里可被 node --test 直测。
//
// 框架原本的世界观是「一门语言 = 一个文案目录」。多语言产品的真实世界观是
// 「一门语言 = 一组完整交付物」—— 声学模型、关键词表、prompt、锚点词,
// 这些都跟着语言走,但它们不是文案:值不是字符串,进不了 loadTables
// (assertStringLeaves 会就地拦下),也不该被 t() 取。
//
// 所以分两层:i18n/<locale>/*.json 是用户读到的字,由 check 管;
// 其余交付物由本模块按 assets 声明逐条验「声明的路径是否兑现」。
//
// 一期只实现三条规则:{locale} 展开、缺失(draft→warning / released→error)、空文件→error。
// kind:'dir' 与 maxBytes 刻意不实现 —— 一期没有任何消费者用得上,先写就是照着想象设计。
import fs from 'node:fs';
import path from 'node:path';

const PLACEHOLDER = '{locale}';

/**
 * @param {object} o
 * @param {string} o.root            消费方仓库根
 * @param {Array<{name:string,path:string}>} [o.assets]
 * @param {Array<{code:string,status:string}>} o.locales  已归一的语言清单(见 check.js 的 normalizeLocales)
 * @returns {{errors:string[],warnings:string[]}}
 */
export function checkAssets({ root, assets, locales }) {
  const errors = [], warnings = [];
  if (!assets || !assets.length) return { errors, warnings };

  for (const a of assets) {
    if (!a || !a.name) throw new Error(`assets 项缺 name: ${JSON.stringify(a)}`);
    if (!a.path) throw new Error(`assets '${a.name}' 缺 path`);
    // 不带 {locale} 基本必是手误。静默按字面路径检查一次,会让人以为它在按语言校验,而它没有。
    if (!a.path.includes(PLACEHOLDER)) {
      throw new Error(`assets '${a.name}' 的 path 里没有 ${PLACEHOLDER}: ${a.path}`);
    }

    for (const { code, status } of locales) {
      const rel = a.path.split(PLACEHOLDER).join(code);
      const abs = path.resolve(root, rel);
      const where = `${a.name} · ${rel}`;

      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        // draft 是「这门语言还在翻」,缺资源只提示;released 已经对外,缺一件就不许出包。
        const msg = `语言 '${code}' 缺资源 ${where}`;
        if (status === 'released') errors.push(`${msg}（已发布语言）`);
        else warnings.push(msg);
        continue;
      }

      if (st.isDirectory()) {
        errors.push(`${where} 是目录,不是文件（一期只验文件）`);
        continue;
      }
      // 空文件比缺文件更难查:目录列出来是齐的,check 也说通过,只有运行时才发现是空的。
      // 故不分 draft/released 一律拦 —— draft 想先不管,把文件删掉即可(那只是 warning)。
      if (!fs.readFileSync(abs, 'utf8').trim()) {
        errors.push(`${where} 是空文件（要么填上，要么先删掉）`);
      }
    }
  }
  return { errors, warnings };
}
