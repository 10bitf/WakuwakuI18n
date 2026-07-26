export declare const FALLBACK_LOCALE: string;
export declare function flatten(obj: Record<string, unknown>, prefix?: string, out?: Record<string, string>): Record<string, string>;
export declare function interpolate(tpl: string, vars?: Record<string, unknown> | null): string;
export declare function makeT(
  tables: Record<string, Record<string, string>>,
  getLocale: () => string,
  onMissing?: (key: string, locale: string) => void
): (key: string, vars?: Record<string, unknown>) => string;
export declare function resolveLocale(
  stored: string | null | undefined,
  system: string | null | undefined,
  supported: string[],
  fallback?: string
): string;
