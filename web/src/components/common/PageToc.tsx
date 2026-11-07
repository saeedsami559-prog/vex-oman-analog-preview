import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';

/**
 * "On this page" list for long pages, read from the page's own h2 headings after render.
 * Buttons scroll instead of #anchors, because the site uses hash routing.
 */
export default function PageToc({ deps = [] }: { deps?: unknown[] }) {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<{ text: string; el: HTMLElement }[]>([]);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const hs = Array.from(document.querySelectorAll<HTMLElement>('main .page h2'));
      setItems(hs.filter((h) => !h.closest('.continue')).map((el) => ({ text: el.innerText.trim(), el })));
    });
    return () => cancelAnimationFrame(id);
  }, [lang, ...deps]);
  if (items.length < 4) return null;
  return (
    <nav className="page-toc" aria-label={t('common.onThisPage')}>
      <span className="muted small">{t('common.onThisPage')}</span>
      <ul>
        {items.map((i) => (
          <li key={i.text}>
            <button type="button" className="linklike" onClick={() => i.el.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              {i.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
