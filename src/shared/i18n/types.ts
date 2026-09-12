import type { Locale } from "./config";
import type { EnDictionary } from "./messages/en";

type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}.${P}`
    : never
  : never;

export type NestedKeyOf<ObjectType extends object> = {
  [Key in keyof ObjectType & (string | number)]: ObjectType[Key] extends object
    ? `${Key}` | Join<Key, NestedKeyOf<ObjectType[Key]>>
    : `${Key}`;
}[keyof ObjectType & (string | number)];

/** A secondary locale may be translated incrementally and fall back to English. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type TranslationKey = NestedKeyOf<EnDictionary>;

export type TranslationValues = Record<string, string | number>;

export type TranslateFunction = (
  key: TranslationKey | string,
  values?: TranslationValues,
) => string;

export interface I18nContextValue {
  locale: Locale;
  t: TranslateFunction;
}
