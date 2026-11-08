import type { Localized } from '../types';

/**
 * NASA images shown on site pages. Each entry is a real item of the NASA Image and Video Library
 * (images.nasa.gov): the id is the library's nasa_id, the file is the size that exists for it, and the
 * caption is written from the library's own description. NASA imagery is generally not subject to
 * copyright in the United States; the credit line is the one the library gives.
 */
export interface SitePhoto {
  nasaId: string;
  /** Size suffix that exists in the library for this item. */
  file: '~medium.jpg' | '~large.jpg' | '~small.jpg' | '~orig.jpg';
  credit: string;
  caption: Localized;
}

export const photoUrl = (p: SitePhoto) => `https://images-assets.nasa.gov/image/${p.nasaId}/${p.nasaId}${p.file}`;
/** Web-sized copy stored with the site (public/photos), so the photo shows even when images-assets.nasa.gov is unreachable. */
export const photoLocal = (siteId: string) => `${import.meta.env.BASE_URL}photos/${siteId}.jpg`;
export const photoPage = (p: SitePhoto) => `https://images.nasa.gov/details/${encodeURIComponent(p.nasaId)}`;

export const SITE_PHOTOS: Record<string, SitePhoto> = {
  sau008_on_mars: {
    nasaId: 'PIA26520',
    file: '~medium.jpg',
    credit: 'NASA/JPL-Caltech',
    caption: {
      en: 'On Mars: the SHERLOC calibration target on NASA\'s Perseverance rover, photographed by its WATSON camera. The speckled disc, third from the left in the top row, is a slice of the Martian meteorite Sayh al Uhaymir 008, found in Oman.',
      ar: 'على المريخ: هدف معايرة جهاز SHERLOC على المسبار Perseverance التابع لناسا، صوّرته كاميرا WATSON. القرص المرقّط، الثالث من اليسار في الصف العلوي، شريحة من النيزك المريخي صيح العهيمر 008 الذي عُثر عليه في عُمان.',
    },
  },
  dhofar_amadee18: {
    nasaId: 'iss069e003275',
    file: '~medium.jpg',
    credit: 'NASA',
    caption: {
      en: 'Oman and its Dhofar mountains on the Arabian Sea coast, photographed from the International Space Station by UAE astronaut Sultan Alneyadi (13 April 2023).',
      ar: 'عُمان وجبال ظفار على ساحل بحر العرب، صوّرها من محطة الفضاء الدولية رائد الفضاء الإماراتي سلطان النيادي (13 أبريل 2023).',
    },
  },
  atacama: {
    nasaId: 'PIA23420',
    file: '~medium.jpg',
    credit: 'NASA/METI/AIST/Japan Space Systems, and U.S./Japan ASTER Science Team',
    caption: {
      en: "Salar de Atacama in Chile's Atacama Desert, which receives about 2 mm of rain a year, seen by the ASTER instrument on NASA's Terra satellite.",
      ar: 'سبخة أتاكاما في صحراء أتاكاما بتشيلي، التي يسقط عليها نحو 2 مم من المطر سنوياً، كما رصدها جهاز ASTER على قمر Terra التابع لناسا.',
    },
  },
  black_point: {
    nasaId: 'jsc2008e138809',
    file: '~medium.jpg',
    credit: 'NASA/Regan Geeseman',
    caption: {
      en: "NASA's Lunar Electric Rover during the 2008 Desert RATS field test at Black Point Lava Flow, Arizona.",
      ar: 'المركبة القمرية الكهربائية التابعة لناسا خلال اختبار Desert RATS الميداني عام 2008 في تدفق بلاك بوينت البركاني بأريزونا.',
    },
  },
  lanzarote: {
    nasaId: 'PIA23526',
    file: '~medium.jpg',
    credit: 'NASA/METI/AIST/Japan Space Systems, and U.S./Japan ASTER Science Team',
    caption: {
      en: 'Los Volcanes Natural Park on Lanzarote, used by NASA and ESA for astronaut training and Mars rover testing, seen by ASTER on NASA’s Terra satellite.',
      ar: 'منتزه لوس فولكانيس الطبيعي في لانزاروتي، الذي تستخدمه ناسا ووكالة الفضاء الأوروبية لتدريب الرواد واختبار مركبات المريخ، كما رصده جهاز ASTER على قمر Terra التابع لناسا.',
    },
  },
  hiseas: {
    nasaId: 'PIA01304',
    file: '~medium.jpg',
    credit: 'NASA/JPL',
    caption: {
      en: 'Spaceborne imaging radar view of Mauna Loa volcano, Hawaii, mapping its lava flows.',
      ar: 'صورة رادارية من الفضاء لبركان ماونا لوا في هاواي، ترسم تدفقات الحمم فيه.',
    },
  },
  death_valley: {
    nasaId: 'PIA26676',
    file: '~medium.jpg',
    credit: 'NASA/JPL-Caltech',
    caption: {
      en: 'A JPL research drone flies over Mars Hill in Death Valley National Park (September 2025); its rubbly volcanic rocks have served as a Mars-like test area since the Viking missions.',
      ar: 'طائرة بحثية مسيّرة من مختبر JPL تحلّق فوق تل المريخ في متنزه وادي الموت الوطني (سبتمبر 2025)؛ صخوره البركانية المفتّتة تُستخدم كمنطقة اختبار شبيهة بالمريخ منذ بعثات فايكنغ.',
    },
  },
  rio_tinto: {
    nasaId: 'PIA13365',
    file: '~medium.jpg',
    credit: 'NASA/GSFC/METI/ERSDAC/JAROS, and U.S./Japan ASTER Science Team',
    caption: {
      en: 'The red Río Tinto river in south-western Spain, rising in the Sierra Morena of Andalusia, seen by ASTER on NASA’s Terra satellite.',
      ar: 'نهر ريو تينتو الأحمر في جنوب غرب إسبانيا، الذي ينبع من جبال سييرا مورينا في الأندلس، كما رصده جهاز ASTER على قمر Terra التابع لناسا.',
    },
  },
  pilbara: {
    nasaId: 'PIA23551',
    file: '~medium.jpg',
    credit: 'NASA/JPL-Caltech',
    caption: {
      en: "Scientists from NASA's Mars 2020 and ESA's ExoMars projects study stromatolites in the Pilbara, Western Australia (19 August 2019).",
      ar: 'علماء من مشروعي Mars 2020 التابع لناسا وExoMars التابع لوكالة الفضاء الأوروبية يدرسون الستروماتوليت في بيلبارا بغرب أستراليا (19 أغسطس 2019).',
    },
  },
  meteor_crater: {
    nasaId: 'iss074e0208832',
    file: '~large.jpg',
    credit: 'NASA',
    caption: {
      en: 'Meteor Crater, Arizona, about 4,000 feet across and about 50,000 years old, photographed from the International Space Station (26 January 2026).',
      ar: 'فوهة النيزك في أريزونا، بعرض نحو 4,000 قدم وعمر نحو 50 ألف سنة، مصوّرة من محطة الفضاء الدولية (26 يناير 2026).',
    },
  },
  cinder_lake: {
    nasaId: 'S70-53300',
    file: '~medium.jpg',
    credit: 'NASA',
    caption: {
      en: 'Apollo 15 crew members ride a Lunar Roving Vehicle simulator during geology training at the Cinder Lake crater field, Arizona (2–3 November 1970).',
      ar: 'من طاقم أبولو 15 على محاكي المركبة القمرية الجوالة خلال التدريب الجيولوجي في حقل فوهات سيندر ليك بأريزونا (2–3 نوفمبر 1970).',
    },
  },
  ries: {
    nasaId: 'PIA23851',
    file: '~orig.jpg',
    credit: 'NASA/METI/AIST/Japan Space Systems, and U.S./Japan ASTER Science Team',
    caption: {
      en: 'Nördlingen, the walled town built inside the Ries impact crater in southern Germany, seen by ASTER on NASA’s Terra satellite.',
      ar: 'نوردلينغن، المدينة المسوّرة المبنية داخل فوهة ريس الارتطامية جنوب ألمانيا، كما رصدها جهاز ASTER على قمر Terra التابع لناسا.',
    },
  },
  craters_of_the_moon: {
    nasaId: 'PIA26501',
    file: '~medium.jpg',
    credit: 'NASA/METI/AIST/Japan Space Systems, and U.S./Japan ASTER Science Team',
    caption: {
      en: 'Craters of the Moon National Monument on the Snake River Plain, Idaho, seen by ASTER on NASA’s Terra satellite.',
      ar: 'نصب كريترز أوف ذا مون الوطني في سهل نهر سنيك بأيداهو، كما رصده جهاز ASTER على قمر Terra التابع لناسا.',
    },
  },
  jezero_crater: {
    nasaId: 'PIA25350',
    file: '~medium.jpg',
    credit: 'NASA/JPL-Caltech/ASU',
    caption: {
      en: "Part of the north-east of Jezero Crater, seen by THEMIS on NASA's 2001 Mars Odyssey; Perseverance works on the crater's north-west side, near the delta.",
      ar: 'جزء من شمال شرق فوهة Jezero كما رصده جهاز THEMIS على مسبار Mars Odyssey التابع لناسا؛ تعمل Perseverance في الجهة الشمالية الغربية من الفوهة قرب الدلتا.',
    },
  },
  nili_fossae: {
    nasaId: 'PIA06388',
    file: '~small.jpg',
    credit: 'NASA/JPL/Arizona State University',
    caption: { en: "Nili Fossae, seen by NASA's 2001 Mars Odyssey.", ar: 'منطقة Nili Fossae كما رصدها مسبار Mars Odyssey التابع لناسا.' },
  },
  terra_sirenum_chlorides: {
    nasaId: 'PIA21289',
    file: '~medium.jpg',
    credit: 'NASA/JPL-Caltech/ASU',
    caption: {
      en: "An unnamed crater in Terra Sirenum with gullies on its rim and small dunes on its floor, seen by NASA's 2001 Mars Odyssey.",
      ar: 'فوهة غير مسمّاة في Terra Sirenum بأخاديد على حافتها وكثبان صغيرة في قاعها، كما رصدها مسبار Mars Odyssey التابع لناسا.',
    },
  },
  nili_patera_dunes: {
    nasaId: 'PIA12382',
    file: '~medium.jpg',
    credit: 'NASA/JPL/ASU',
    caption: { en: "The Nili Patera dunes, seen by NASA's 2001 Mars Odyssey.", ar: 'كثبان Nili Patera كما رصدها مسبار Mars Odyssey التابع لناسا.' },
  },
};
