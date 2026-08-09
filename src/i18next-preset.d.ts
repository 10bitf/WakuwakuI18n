export declare const PRESET: Readonly<{
  nsSeparator: false;
  keySeparator: '.';
  interpolation: Readonly<{ escapeValue: boolean; prefix: string; suffix: string }>;
}>;

export declare function withPreset<T extends object>(options?: T): T & typeof PRESET;
