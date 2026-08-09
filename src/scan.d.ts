/** 一处裸中文命中。line 为 1-based;text 是遮蔽后该行的 trim 结果。 */
export interface ScanHit {
  line: number;
  text: string;
  /** 相对 scanFiles 的 root 的路径 */
  rel: string;
}

export interface ScanResult {
  /** 未被豁免的命中 */
  hits: ScanHit[];
  /** 文件级豁免:整份跳过,但理由要能读出来 */
  fileExempt: Array<{ rel: string; reason: string }>;
  /** 行级豁免:被豁免掉的命中,附理由。仍要被打印,不是静默丢弃 */
  lineExempt: Array<ScanHit & { reason: string }>;
}

export declare function scanFiles(options: {
  root: string;
  dirs: string[];
  exts: string[];
  /** 对应消费方 i18n.config.mjs 的 rawLint.exempt === true。关闭时豁免标记完全不生效 */
  exempt?: boolean;
}): ScanResult;
