// Mission concept: a proposed field campaign written by the team. It is a concept, not a planned or
// funded mission; site facts (twins, distances, missing values) are read live from sites.json.

import type { Localized } from '../types';

export interface MissionLeg {
  site: string;
  days: string;
  tasks: Localized[];
  /** Missing value(s) the leg would measure on the ground, by feature id. */
  fills: string[];
}

export const MISSION_LEGS: MissionLeg[] = [
  {
    site: 'samail_ophiolite',
    days: '1–3',
    tasks: [
      { en: 'Handheld spectra of serpentine and carbonate outcrops, compared with the EMIT band depths used in the score.', ar: 'أطياف يدوية لنتوءات السربنتين والكربونات ومقارنتها بأعماق نطاقات EMIT المستخدمة في الدرجة.' },
      { en: 'Sample selection drill: pick and document the best water-altered rock, as Perseverance does at Jezero.', ar: 'تمرين اختيار العينات: انتقاء أفضل صخر متغير بالماء وتوثيقه، كما تفعل Perseverance في Jezero.' },
    ],
    fills: ['thermal_inertia'],
  },
  {
    site: 'jebel_shams',
    days: '4–5',
    tasks: [
      { en: 'Walk a traverse across slopes above 20° and compare a drone elevation model with the NASADEM slopes.', ar: 'السير في مسار عبر منحدرات تزيد على 20° ومقارنة نموذج ارتفاع من طائرة مسيّرة بانحدارات NASADEM.' },
      { en: 'Landing-hazard mapping exercise for crater-rim terrain like Shackleton.', ar: 'تمرين رسم خرائط مخاطر الهبوط لتضاريس حواف الفوهات مثل Shackleton.' },
    ],
    fills: ['thermal_inertia'],
  },
  {
    site: 'sharqiya_sands',
    days: '6–7',
    tasks: [
      { en: 'Vehicle mobility tests in loose sand; measure dune spacing and height on foot.', ar: 'اختبارات حركة المركبات في الرمال السائبة، وقياس المسافة بين الكثبان وارتفاعها سيراً.' },
    ],
    fills: ['thermal_inertia'],
  },
  {
    site: 'umm_as_samim',
    days: '8–9',
    tasks: [
      { en: 'Salt-crust sampling to identify chlorides directly, the value no satellite index on this site can provide.', ar: 'أخذ عينات من القشرة الملحية لتحديد الكلوريدات مباشرة، وهي القيمة التي لا يوفرها أي مؤشر فضائي في هذا الموقع.' },
      { en: 'Operations on a soft, flat salt surface.', ar: 'العمل على سطح ملحي مستوٍ ولين.' },
    ],
    fills: ['chloride_index', 'thermal_inertia'],
  },
];

export const MISSION_EXTENSION = 'dhofar_amadee18';

/** Optional Moon track (2 days) after the main route: rehearse what Artemis crews will face at the south pole. */
export const MOON_TRACK: MissionLeg[] = [
  {
    site: 'majlis_al_jinn',
    days: '10–11',
    tasks: [
      { en: 'Vertical entry: a 100–120 m rope descent through the roof openings, the way a crew might enter a lava-tube skylight on the Moon or Mars.', ar: 'الدخول العمودي: نزول بالحبال من 100 إلى 120 م عبر فتحات السقف، كما قد يدخل طاقم إلى فتحة سماوية لأنبوب حمم على القمر أو المريخ.' },
      { en: 'Work in total darkness with only carried lights and no GPS, a stand-in for operations inside permanently shadowed craters.', ar: 'العمل في ظلام تام بالإضاءة المحمولة فقط ومن دون GPS، بديلاً عن العمليات داخل الفوهات المظللة دائماً.' },
      { en: 'Relay radio through the shaft and log how long each message takes, to plan comms for sites out of line of sight.', ar: 'تمرير الاتصال اللاسلكي عبر الفتحة وتسجيل زمن كل رسالة، لتخطيط الاتصالات في المواقع خارج خط الرؤية.' },
    ],
    fills: ['thermal_inertia'],
  },
];
