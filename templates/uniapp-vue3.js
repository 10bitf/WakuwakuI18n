// uni-app + Vue3 的取词接线模板。复制到你的项目(如 src/i18n/index.js),改三处:
//   ① STORAGE_KEY 换成你自己的(不同小程序别共用一个 key)
//   ② generated.js 的相对路径按你的目录结构调整(它由 wakuwaku-i18n 的 emit 生成)
//   ③ onMissing 的处理按需(开发期打警告即可;若希望缺 key 直接暴露,可在这里抛错)
// 取词纯逻辑不在这里——它随文案表一起内联在 generated.js 里,勿手改那个文件。
import { ref } from 'vue';
import { LOCALES, MESSAGES, I18N_STAMP, makeT, resolveLocale, FALLBACK_LOCALE } from './generated.js';

export { I18N_STAMP };

const STORAGE_KEY = 'REPLACE_ME_locale';   // ← ①

function readStored() {
  try { return uni.getStorageSync(STORAGE_KEY) || ''; } catch (e) { return ''; }
}
function readSystem() {
  try { return (uni.getSystemInfoSync() || {}).language || ''; } catch (e) { return ''; }
}

// locale 用 ref 而非普通变量:模板里凡用到 t() 的位置会订阅它,切换语言即自动重渲染。
// 用普通变量会出现"切完语言半个界面还是旧语言"。
export const locale = ref(resolveLocale(readStored(), readSystem(), LOCALES, FALLBACK_LOCALE));

export function setLocale(next) {
  if (!LOCALES.includes(next)) return false;
  locale.value = next;
  try { uni.setStorageSync(STORAGE_KEY, next); } catch (e) { /* 存不上不影响本次使用 */ }
  return true;
}

export const t = makeT(
  MESSAGES,
  () => locale.value,
  (key, loc) => { console.warn('[i18n] 缺文案:', key, '@', loc); },   // ← ③
);
