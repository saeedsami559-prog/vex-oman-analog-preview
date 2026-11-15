import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

const BASE = `${import.meta.env.BASE_URL}pitch/`;
/** Slide alt texts stay in English: the deck itself is in English, as the Space Apps rules require. */
const SLIDES = [
  'Oman Analog Explorer: title slide with Team VEX and the challenge name',
  'Screen analog sites before the field trip: the question, the method and one terrain shown in Mars and Oman colours',
  'Every score comes from open NASA data: 5 Omani sites, 5 targets, 449 cells, 11 NASA datasets',
  'One open formula for three worlds: four steps and the mean Mars similarity of the five Omani sites',
  'VEX Scout screens Oman, then you fly it: 25 GO, 190 CONDITIONAL and 234 NO-GO cells',
  'An AI that explains itself: k-nearest-neighbour model with its validation for the Moon and Mars',
  'Bring Moon and Mars rehearsals to Oman: impact, next step and links',
];

/** The seven-slide pitch deck (PowerPoint), shown as images with a download link. */
export default function Present() {
  const { t } = useI18n();
  const [i, setI] = useState(0);
  const n = SLIDES.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const rtl = document.documentElement.dir === 'rtl';
      if (['PageDown', ' ', rtl ? 'ArrowLeft' : 'ArrowRight'].includes(e.key)) setI((x) => Math.min(n - 1, x + 1));
      else if (['PageUp', rtl ? 'ArrowRight' : 'ArrowLeft'].includes(e.key)) setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n]);

  return (
    <div className="present">
      <div className="present-bar no-print">
        <Link to="/about" className="btn ghost small">
          {t('present.exit')}
        </Link>
        <span className="muted small">{t('present.counter', { i: i + 1, n })}</span>
        <div className="present-nav">
          <a className="btn ghost small" href={`${BASE}VEX-Oman-Analog-Explorer.pptx`} download>
            {t('present.download')}
          </a>
          <button type="button" className="btn ghost small" onClick={() => window.print()}>
            {t('present.print')}
          </button>
          <button type="button" className="btn ghost small" disabled={i === 0} onClick={() => setI(i - 1)}>
            {t('present.prev')}
          </button>
          <button type="button" className="btn primary small" disabled={i === n - 1} onClick={() => setI(i + 1)}>
            {t('present.next')}
          </button>
        </div>
      </div>
      <div className="slides">
        {SLIDES.map((alt, k) => (
          <section key={k} className={`slide deck${k === i ? ' on' : ''}`} aria-hidden={k !== i}>
            <img src={`${BASE}slide-${k + 1}.jpg`} alt={alt} loading={k === 0 ? 'eager' : 'lazy'} onClick={() => setI(Math.min(n - 1, k + 1))} />
          </section>
        ))}
      </div>
      <div className="present-dots no-print">
        {SLIDES.map((_, k) => (
          <button key={k} type="button" className={k === i ? 'on' : undefined} aria-label={t('present.counter', { i: k + 1, n })} onClick={() => setI(k)} />
        ))}
      </div>
    </div>
  );
}
