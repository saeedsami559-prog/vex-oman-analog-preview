import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './en.json';
import ar from './ar.json';
import type { Lang, Localized } from '../types';

const dictionaries: Record<Lang, unknown> = { en, ar };
const STORAGE_KEY = 'oae-lang';

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), dict);
}

function readStoredLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en'; // English first: judging and NASA submission are in English
  }
}

interface I18n {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  tl: (key: string) => string[];
  loc: (value: Localized) => string;
  num: (n: number, digits?: number) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage unavailable: language just won't persist */
    }
  }, [lang, dir]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const value = lookup(dictionaries[lang], key) ?? lookup(dictionaries.en, key);
      let text = typeof value === 'string' ? value : key;
      if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
      return text;
    },
    [lang],
  );

  const value = useMemo<I18n>(
    () => ({
      lang,
      dir,
      setLang: setLangState,
      toggle: () => setLangState((l) => (l === 'en' ? 'ar' : 'en')),
      t,
      tl: (key) => {
        const v = lookup(dictionaries[lang], key);
        return Array.isArray(v) ? (v as string[]) : [];
      },
      loc: (v) => v[lang] ?? v.en,
      // Western digits in both languages keep numbers consistent with charts and data tables.
      num: (n, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }),
    }),
    [lang, dir, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
