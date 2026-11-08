// Analog Atlas: context from published NASA / ESA analog programmes and other public sources.
// Sites listed in analysis/config/benchmark_sites.yaml are also scored (see sites.json -> benchmarks);
// the others are described only. `approx: true` marks a region-level point.

import type { Localized } from '../types';

export type Category = 'desert' | 'polar' | 'volcanic' | 'cave' | 'impact' | 'serpentine' | 'salt' | 'relief' | 'habitat' | 'astrobio';
export type Body = 'mars' | 'moon';

export interface AtlasSite {
  id: string;
  name: Localized;
  place: Localized;
  lat: number;
  lon: number;
  approx?: boolean;
  categories: Category[];
  bodies: Body[];
  /** Programme or agency that uses the site. */
  programme: Localized;
  what: Localized;
  source: { label: string; url: string };
}

export const CATEGORIES: Category[] = ['desert', 'polar', 'volcanic', 'cave', 'impact', 'serpentine', 'salt', 'relief', 'habitat', 'astrobio'];

/** Which challenge categories each scored Omani site covers (from its card description). */
export const OMAN_SCORED_CATEGORIES: Record<string, Category[]> = {
  samail_ophiolite: ['serpentine'],
  umm_as_samim: ['salt', 'desert'],
  sharqiya_sands: ['desert'],
  dhofar_amadee18: ['desert', 'habitat'],
  jebel_shams: ['relief'],
};

/** Analog sites used by NASA and ESA programmes (benchmarks for the Omani sites). */
export const BENCHMARKS: AtlasSite[] = [
  {
    id: 'atacama',
    name: { en: 'Atacama Desert', ar: 'صحراء أتاكاما' },
    place: { en: 'Chile', ar: 'تشيلي' },
    lat: -24.1, lon: -70.02, approx: true,
    categories: ['desert', 'astrobio'], bodies: ['mars'],
    programme: { en: 'NASA science field research', ar: 'أبحاث ميدانية علمية لناسا' },
    what: { en: 'Extreme dryness and preserved ancient microbes, studied to understand conditions on Mars.', ar: 'جفاف شديد وميكروبات قديمة محفوظة، تُدرس لفهم الظروف على المريخ.' },
    source: { label: 'NASA Science: 10 things to know about planetary analogs', url: 'https://science.nasa.gov/solar-system/planetary-analogs/10-things-to-know-about-planetary-analogs' },
  },
  {
    id: 'haughton',
    name: { en: 'Haughton Crater, Devon Island', ar: 'فوهة هوتون، جزيرة ديفون' },
    place: { en: 'Canadian Arctic', ar: 'القطب الشمالي الكندي' },
    lat: 75.38, lon: -89.68, approx: true,
    categories: ['polar', 'impact'], bodies: ['mars'],
    programme: { en: 'Haughton-Mars Project (NASA-supported)', ar: 'مشروع هوتون-المريخ (بدعم ناسا)' },
    what: { en: 'A meteorite impact crater in a cold, dry, unvegetated landscape used to practise Martian EVAs and robots.', ar: 'فوهة ارتطام نيزكي في بيئة باردة وجافة بلا نبات، تُستخدم للتدرّب على الأنشطة خارج المركبة والروبوتات على المريخ.' },
    source: { label: 'NASA Science: 10 things to know about planetary analogs', url: 'https://science.nasa.gov/solar-system/planetary-analogs/10-things-to-know-about-planetary-analogs' },
  },
  {
    id: 'black_point',
    name: { en: 'Black Point Lava Flow & Cinder Lake', ar: 'تدفق بلاك بوينت البركاني وبحيرة سيندر' },
    place: { en: 'San Francisco Volcanic Field, Arizona, USA', ar: 'حقل سان فرانسيسكو البركاني، أريزونا، الولايات المتحدة' },
    lat: 35.6878, lon: -111.3599,
    categories: ['volcanic', 'desert'], bodies: ['moon', 'mars'],
    programme: { en: 'NASA Desert RATS', ar: 'برنامج Desert RATS التابع لناسا' },
    what: { en: 'Rover and spacewalk operations over basalt flows and cinder fields with moon-like geology.', ar: 'عمليات المركبات الجوالة والسير خارج المركبة فوق تدفقات البازلت وحقول الرماد ذات الجيولوجيا الشبيهة بالقمر.' },
    source: { label: 'NASA Technical Reports Server: analog field tests (Desert RATS 2007)', url: 'https://ntrs.nasa.gov/api/citations/20080010736/downloads/20080010736.pdf' },
  },
  {
    id: 'iceland',
    name: { en: 'Icelandic volcanic terrain', ar: 'التضاريس البركانية في آيسلندا' },
    place: { en: 'Iceland', ar: 'آيسلندا' },
    lat: 64.9, lon: -18.5, approx: true,
    categories: ['volcanic'], bodies: ['moon'],
    programme: { en: 'Artemis astronaut geology training (NASA)', ar: 'تدريب رواد Artemis على الجيولوجيا (ناسا)' },
    what: { en: 'Basalts and breccias like lunar rocks; used for astronaut geology training since Apollo.', ar: 'بازلت وبريشيا تشبه صخور القمر، وتُستخدم لتدريب الرواد على الجيولوجيا منذ برنامج أبولو.' },
    source: { label: 'Popular Science: where astronauts train (quotes NASA Artemis geology team)', url: 'https://popsci.com/science/where-do-astronauts-train' },
  },
  {
    id: 'hiseas',
    name: { en: 'HI-SEAS, Mauna Loa', ar: 'محطة HI-SEAS، ماونا لوا' },
    place: { en: 'Hawaii, USA', ar: 'هاواي، الولايات المتحدة' },
    lat: 19.6024, lon: -155.4872,
    categories: ['volcanic', 'habitat'], bodies: ['moon', 'mars'],
    programme: { en: 'NASA-funded HI-SEAS missions (2013–2018)', ar: 'بعثات HI-SEAS بتمويل ناسا (2013–2018)' },
    what: { en: 'A habitat on a volcano for long isolation studies, with a communication delay like Earth–Mars.', ar: 'موئل على بركان لدراسات العزلة الطويلة، مع تأخير اتصال يشبه تأخير الأرض والمريخ.' },
    source: { label: 'Wikipedia: Terrestrial analogue site', url: 'https://en.wikipedia.org/wiki/Terrestrial_analogue_site' },
  },
  {
    id: 'svalbard',
    name: { en: 'Svalbard (AMASE)', ar: 'سفالبارد (AMASE)' },
    place: { en: 'Norway, Arctic', ar: 'النرويج، القطب الشمالي' },
    lat: 79.4, lon: 13.3, approx: true,
    categories: ['polar'], bodies: ['mars'],
    programme: { en: 'Arctic Mars Analog Svalbard Expedition', ar: 'بعثة سفالبارد القطبية المماثلة للمريخ' },
    what: { en: 'Exceptional rock exposures in the High Arctic, used to test Mars instruments and train crews in field geology.', ar: 'انكشافات صخرية استثنائية في أقصى القطب الشمالي، تُستخدم لاختبار أجهزة المريخ وتدريب الطواقم على الجيولوجيا الميدانية.' },
    source: { label: 'NASA Technical Reports Server: analog field tests (AMASE 2007)', url: 'https://ntrs.nasa.gov/api/citations/20080010736/downloads/20080010736.pdf' },
  },
  {
    id: 'dry_valleys',
    name: { en: 'McMurdo Dry Valleys', ar: 'الوديان الجافة في ماكموردو' },
    place: { en: 'Victoria Land, Antarctica', ar: 'أرض فيكتوريا، القارة القطبية الجنوبية' },
    lat: -77.5, lon: 161.5, approx: true,
    categories: ['polar', 'desert'], bodies: ['mars'],
    programme: { en: 'NASA Mars Phoenix analog studies', ar: 'دراسات ناسا المماثلة لمهمة فينيكس على المريخ' },
    what: { en: 'The largest ice-free area of Antarctica, extremely cold and dry, with dry permafrost; NASA calls it perhaps the landscape most like Mars and the best Earth analog for the Phoenix landing site.', ar: 'أكبر منطقة خالية من الجليد في القارة القطبية الجنوبية، شديدة البرودة والجفاف مع تربة متجمدة جافة؛ تصفها ناسا بأنها ربما أشبه المناظر بالمريخ وأفضل نظير أرضي لموقع هبوط فينيكس.' },
    source: { label: 'NASA NTRS: McMurdo Dry Valleys, a Mars Phoenix mission analog (2010)', url: 'https://ntrs.nasa.gov/citations/20100003844' },
  },
  {
    id: 'supramonte',
    name: { en: 'Supramonte karst caves', ar: 'كهوف سوبرامونتي الكارستية' },
    place: { en: 'Sardinia, Italy', ar: 'سردينيا، إيطاليا' },
    lat: 40.2, lon: 9.5, approx: true,
    categories: ['cave'], bodies: ['moon', 'mars'],
    programme: { en: 'ESA CAVES astronaut training', ar: 'تدريب الرواد CAVES التابع لوكالة الفضاء الأوروبية' },
    what: { en: 'Astronauts from several agencies spend days underground in limestone caves to train teamwork and exploration.', ar: 'يقضي رواد من عدة وكالات أياماً تحت الأرض في كهوف جيرية للتدرّب على العمل الجماعي والاستكشاف.' },
    source: { label: 'ESA: Underground for outer space with CAVES', url: 'https://www.esa.int/content/view/full/500470' },
  },
  {
    id: 'lanzarote',
    name: { en: 'Cueva de los Verdes lava tube', ar: 'أنبوب الحمم كويفا دي لوس فيرديس' },
    place: { en: 'Lanzarote, Spain', ar: 'لانزاروتي، إسبانيا' },
    lat: 29.157, lon: -13.44,
    categories: ['cave', 'volcanic'], bodies: ['moon', 'mars'],
    programme: { en: 'ESA Pangaea-X geology campaign', ar: 'حملة Pangaea-X الجيولوجية التابعة لوكالة الفضاء الأوروبية' },
    what: { en: 'One of the largest lava-tube systems (~8 km), mapped as an analog for lunar and Martian lava tubes.', ar: 'من أكبر أنظمة أنابيب الحمم (نحو 8 كم)، رُسمت خرائطه كنظير لأنابيب الحمم على القمر والمريخ.' },
    source: { label: 'ESA: CAVES and Pangaea videos', url: 'https://www.esa.int/ESA_Multimedia/Videos/2013/09/CAVES_2013_Discovery' },
  },
  {
    id: 'mdrs',
    name: { en: 'Mars Desert Research Station', ar: 'محطة أبحاث المريخ الصحراوية' },
    place: { en: 'Utah, USA', ar: 'يوتا، الولايات المتحدة' },
    lat: 38.4065, lon: -110.7919,
    categories: ['desert', 'habitat'], bodies: ['mars'],
    programme: { en: 'Mars Society analog station', ar: 'محطة مماثلة تابعة لجمعية المريخ' },
    what: { en: 'A habitat in red sedimentary desert where crews rehearse Mars field days.', ar: 'موئل في صحراء رسوبية حمراء تتدرّب فيه الطواقم على أيام العمل الميداني على المريخ.' },
    source: { label: 'Groemer & Ozdemir 2020, Frontiers in Astronomy and Space Sciences', url: 'https://www.frontiersin.org/articles/10.3389/fspas.2020.00032/pdf' },
  },
  {
    id: 'death_valley',
    name: { en: 'Death Valley (Ubehebe Crater, Mars Hill)', ar: 'وادي الموت (فوهة أوبيهيبي وتل المريخ)' },
    place: { en: 'California, USA', ar: 'كاليفورنيا، الولايات المتحدة' },
    lat: 37.0097, lon: -117.4503,
    categories: ['desert', 'volcanic'], bodies: ['mars'],
    programme: { en: 'NASA / JPL Mars hardware tests since Viking', ar: 'اختبارات معدات المريخ لدى ناسا وJPL منذ فايكنغ' },
    what: { en: 'Where NASA tested the Lander Vision System that guided Perseverance (2019) and Mars drone navigation (2025).', ar: 'هنا اختبرت ناسا نظام الرؤية الذي وجّه هبوط Perseverance (2019) وملاحة طائرات المريخ المسيّرة (2025).' },
    source: { label: 'National Park Service: NASA in Death Valley', url: 'https://www.nps.gov/deva/nasa.htm' },
  },
  {
    id: 'rio_tinto',
    name: { en: 'Río Tinto headwaters (Peña de Hierro)', ar: 'منابع ريو تينتو (بينيا دي إييرو)' },
    place: { en: 'Andalusia, Spain', ar: 'الأندلس، إسبانيا' },
    lat: 37.7255, lon: -6.5556,
    categories: ['astrobio'], bodies: ['mars'],
    programme: { en: 'NASA MARTE drilling experiment (Ames)', ar: 'تجربة الحفر MARTE التابعة لناسا (مركز أميس)' },
    what: { en: 'Acidic, iron-rich waters over a sulfide deposit; NASA drilled here to rehearse searching for life below the Martian surface.', ar: 'مياه حمضية غنية بالحديد فوق رواسب كبريتيدية؛ حفرت ناسا هنا للتدرّب على البحث عن الحياة تحت سطح المريخ.' },
    source: { label: 'NASA Astrobiology: Drilling for Weird Life (MARTE)', url: 'https://astrobiology.nasa.gov/news/drilling-for-weird-life/' },
  },
  {
    id: 'pilbara',
    name: { en: 'Pilbara stromatolites (Dresser Formation)', ar: 'ستروماتوليت بيلبارا (تكوين دريسر)' },
    place: { en: 'Western Australia', ar: 'غرب أستراليا' },
    lat: -21.1518, lon: 119.4373,
    categories: ['astrobio'], bodies: ['mars'],
    programme: { en: 'NASA Mars 2020 + ESA ExoMars science field trip (2019)', ar: 'رحلة ميدانية لعلماء Mars 2020 التابع لناسا وExoMars (2019)' },
    what: { en: 'About 3.48-billion-year-old rocks with some of the oldest fossil life on Earth, used to train the eyes of Perseverance scientists.', ar: 'صخور عمرها نحو 3.48 مليار سنة تضم بعضاً من أقدم آثار الحياة على الأرض، استُخدمت لتدريب علماء Perseverance.' },
    source: { label: 'NASA JPL: Scientists explore Outback as testbed for Mars', url: 'https://www.jpl.nasa.gov/news/scientists-explore-outback-as-testbed-for-mars' },
  },
  {
    id: 'meteor_crater',
    name: { en: 'Meteor Crater (Barringer)', ar: 'فوهة النيزك (بارينجر)' },
    place: { en: 'Arizona, USA', ar: 'أريزونا، الولايات المتحدة' },
    lat: 35.0281, lon: -111.0233,
    categories: ['impact'], bodies: ['moon'],
    programme: { en: 'Apollo astronaut geology training (NASA)', ar: 'تدريب رواد أبولو على الجيولوجيا (ناسا)' },
    what: { en: 'A well-preserved 1.2 km impact crater visited by Gemini and Apollo astronauts from 1963 onward.', ar: 'فوهة ارتطام محفوظة بعرض 1.2 كم زارها رواد جيميني وأبولو منذ 1963.' },
    source: { label: 'NASA Apollo Lunar Surface Journal: astronaut geology training record', url: 'https://www.nasa.gov/wp-content/uploads/static/history/alsj/AstronautGeologyTraining.pdf' },
  },
  {
    id: 'cinder_lake',
    name: { en: 'Cinder Lake crater field', ar: 'حقل فوهات سيندر ليك' },
    place: { en: 'Near Flagstaff, Arizona, USA', ar: 'قرب فلاغستاف، أريزونا، الولايات المتحدة' },
    lat: 35.3197, lon: -111.5171,
    categories: ['volcanic', 'impact'], bodies: ['moon'],
    programme: { en: 'Apollo training (USGS / NASA)', ar: 'تدريب أبولو (هيئة المسح الجيولوجي الأمريكية / ناسا)' },
    what: { en: 'A full-scale copy of an Apollo landing area, blasted into volcanic cinders in 1967 for crew traverses.', ar: 'نسخة بالحجم الطبيعي من منطقة هبوط لأبولو، فُجّرت في الرماد البركاني عام 1967 لتدريب الطواقم على التنقل.' },
    source: { label: 'USGS: Cinder Lake Crater Field data release', url: 'https://www.usgs.gov/data/cinder-lake-crater-field-uncrewed-aerial-system-derived-digital-elevation-models-2023-and-2024' },
  },
  {
    id: 'kilbourne_hole',
    name: { en: 'Kilbourne Hole', ar: 'كيلبورن هول' },
    place: { en: 'New Mexico, USA', ar: 'نيو مكسيكو، الولايات المتحدة' },
    lat: 31.9719, lon: -106.9647,
    categories: ['volcanic'], bodies: ['moon'],
    programme: { en: 'Apollo 12–17 training; Artemis geology training', ar: 'تدريب أبولو 12–17؛ وتدريب Artemis الجيولوجي' },
    what: { en: 'A 3 km volcanic maar crater where Apollo crews trained, and where NASA now trains Artemis astronauts.', ar: 'فوهة ماار بركانية بطول 3 كم تدرّبت فيها طواقم أبولو، وتدرّب فيها ناسا الآن رواد Artemis.' },
    source: { label: 'NASA NTRS: Artemis geology training 2023 (LPSC 2024)', url: 'https://ntrs.nasa.gov/api/citations/20230018695/downloads/LPSC2024_Evans_draft2.pdf' },
  },
  {
    id: 'ries',
    name: { en: 'Ries impact crater', ar: 'فوهة ريس الارتطامية' },
    place: { en: 'Bavaria, Germany', ar: 'بافاريا، ألمانيا' },
    lat: 48.8833, lon: 10.5667,
    categories: ['impact'], bodies: ['moon'],
    programme: { en: 'Apollo 14 training; ESA PANGAEA (Artemis)', ar: 'تدريب أبولو 14؛ ودورة PANGAEA الأوروبية (Artemis)' },
    what: { en: 'A 25 km, roughly 15-million-year-old impact crater where Apollo 14 astronauts and today\'s Artemis-era crews train.', ar: 'فوهة ارتطامية بعرض 25 كم وعمر نحو 15 مليون سنة، تدرّب فيها رواد أبولو 14 وطواقم عصر Artemis.' },
    source: { label: 'ESA: A geological puzzle (PANGAEA at the Ries crater)', url: 'https://www.esa.int/ESA_Multimedia/Images/2024/09/A_geological_puzzle' },
  },
  {
    id: 'sudbury',
    name: { en: 'Sudbury impact structure', ar: 'بنية سدبري الارتطامية' },
    place: { en: 'Ontario, Canada', ar: 'أونتاريو، كندا' },
    lat: 46.6, lon: -81.1833,
    categories: ['impact'], bodies: ['moon'],
    programme: { en: 'Apollo 16 and 17 geology training (NASA)', ar: 'تدريب أبولو 16 و17 على الجيولوجيا (ناسا)' },
    what: { en: 'An ancient, deeply eroded impact basin whose shocked rocks Apollo 16 and 17 crews studied before the Moon.', ar: 'حوض ارتطامي قديم شديد التآكل، درس طاقما أبولو 16 و17 صخوره المصدومة قبل الذهاب إلى القمر.' },
    source: { label: 'NASA Apollo Lunar Surface Journal: astronaut geology training record', url: 'https://www.nasa.gov/wp-content/uploads/static/history/alsj/AstronautGeologyTraining.pdf' },
  },
  {
    id: 'craters_of_the_moon',
    name: { en: 'Craters of the Moon lava field', ar: 'حقل حمم كريترز أوف ذا مون' },
    place: { en: 'Idaho, USA', ar: 'أيداهو، الولايات المتحدة' },
    lat: 43.4617, lon: -113.5627,
    categories: ['volcanic', 'cave'], bodies: ['moon', 'mars'],
    programme: { en: 'NASA FINESSE (SSERVI, Ames)', ar: 'مشروع FINESSE التابع لناسا (SSERVI، مركز أميس)' },
    what: { en: 'Young basalt flows, cones and lava tubes studied by NASA as analogs for lunar volcanism.', ar: 'تدفقات بازلتية حديثة ومخاريط وأنابيب حمم درستها ناسا كنظائر للبراكين على القمر.' },
    source: { label: 'NASA NTRS: FINESSE overview (2015)', url: 'https://ntrs.nasa.gov/citations/20150023448' },
  },
];

/** New Omani candidate (not yet scored): the challenge lists caves, and Oman has one of the largest cave chambers. */
export const OMAN_CANDIDATES: AtlasSite[] = [
  {
    id: 'majlis_al_jinn',
    name: { en: 'Majlis al Jinn, Selma Plateau', ar: 'مجلس الجن، هضبة سلمى' },
    place: { en: 'Eastern Hajar, ~100 km south-east of Muscat', ar: 'الحجر الشرقي، نحو 100 كم جنوب شرق مسقط' },
    lat: 22.8806, lon: 59.1052,
    categories: ['cave'], bodies: ['moon', 'mars'],
    programme: { en: 'Candidate: not yet scored', ar: 'مرشّح: لم يُحسب بعد' },
    what: {
      en: 'A single karst chamber about 310 × 225 m with a ceiling around 120 m, entered only by a 100–120 m rope descent through holes in the roof, at about 1,380 m on the Selma Plateau. Lava tubes on the Moon and Mars are proposed as shelters; ESA already trains astronauts in limestone caves, and this chamber would add vertical-entry operations through a roof opening, like a lunar or Martian skylight.',
      ar: 'قاعة كارستية واحدة بنحو 310 × 225 م وسقف يقارب 120 م، لا يُدخل إليها إلا بالنزول بالحبال من 100 إلى 120 م عبر فتحات في السقف، على ارتفاع نحو 1,380 م في هضبة سلمى. أنابيب الحمم على القمر والمريخ مقترحة كملاجئ، ووكالة الفضاء الأوروبية تدرّب الرواد في كهوف جيرية، وهذه القاعة تضيف عمليات الدخول العمودي عبر فتحة في السقف، مثل الفتحات السماوية على القمر والمريخ.',
    },
    source: { label: 'Majlis al Jinn (Wikipedia, citing PAWR report 85-20, 1985)', url: 'https://en.wikipedia.org/wiki/Majlis_al_Jinn' },
  },
];

/** Oman's track record as an analog host (public sources). */
export const OMAN_TRACK: { when: Localized; what: Localized; source: { label: string; url: string } }[] = [
  {
    when: { en: 'November 1999', ar: 'نوفمبر 1999' },
    what: {
      en: 'Pieces of Mars found at Sayh al Uhaymir (Al Wusta): the shergottite SaU 005 and its pairs, about 10 kg in all, described in NASA\'s Mars Meteorite Compendium.',
      ar: 'العثور على قطع من المريخ في صيح العهيمر (الوسطى): نيزك الشيرغوتيت SaU 005 وأزواجه، نحو 10 كغ إجمالاً، موصوفة في موسوعة نيازك المريخ التابعة لناسا.',
    },
    source: { label: 'NASA JSC Mars Meteorite Compendium: Sayh al Uhaymir 005 (Meyer 2012)', url: 'https://curator.jsc.nasa.gov/antmet/mmc/SaU005.pdf' },
  },
  {
    when: { en: 'January 2000', ar: 'يناير 2000' },
    what: {
      en: 'Dhofar 019, a 1.06 kg Martian basalt, found in the Dhofar desert; a NASA-hosted study found it had lain on Earth for a long time despite the hot desert.',
      ar: 'العثور على ظفار 019، بازلت مريخي وزنه 1.06 كغ، في صحراء ظفار؛ ووجدت دراسة منشورة لدى ناسا أنه بقي على الأرض زمناً طويلاً رغم حرارة الصحراء.',
    },
    source: { label: 'NASA NTRS: Exposure and terrestrial histories of Dhofar 019 Martian meteorite', url: 'https://ntrs.nasa.gov/citations/20020045902' },
  },
  {
    when: { en: '2017 onward', ar: 'منذ 2017' },
    what: {
      en: "NASA's Rock Powered Life astrobiology team sampled serpentinizing fluids in the Samail Ophiolite with the Oman Drilling Project, as an analog for early Earth and Mars.",
      ar: 'جمع فريق Rock Powered Life للأحياء الفلكية التابع لناسا عينات من سوائل التسربن في أفيوليت سمائل مع مشروع حفر عُمان، كنظير للأرض المبكرة والمريخ.',
    },
    source: { label: 'University of Colorado: Rock Powered Life, 2017 field season', url: 'https://www.colorado.edu/lab/rockpoweredlife/research/theme-i-field-investigations/samail-ophiolite-oman/2017-field-season' },
  },
  {
    when: { en: 'February 2018', ar: 'فبراير 2018' },
    what: {
      en: 'AMADEE-18: the Austrian Space Forum ran a four-week Mars simulation in the Dhofar desert near Marmul, with the Oman Astronomical Society.',
      ar: 'AMADEE-18: نفّذ المنتدى الفضائي النمساوي محاكاة للمريخ لمدة أربعة أسابيع في صحراء ظفار قرب مرمول، مع الجمعية الفلكية العُمانية.',
    },
    source: { label: 'Oman Observer: Oman to host Mars simulation experiment', url: 'https://www.omanobserver.om/article/69846/Front%20Stories/oman-to-host-mars-simulation-experiment' },
  },
  {
    when: { en: '2021', ar: '2021' },
    what: {
      en: 'Imaging spectroscopy of serpentine and carbonate at Samail was published as a Mars analog for the minerals the Mars 2020 rover explores at Jezero.',
      ar: 'نُشرت دراسة للتصوير الطيفي للسربنتين والكربونات في سمائل كنظير للمعادن التي تستكشفها مركبة Mars 2020 في Jezero.',
    },
    source: { label: 'Leask et al. 2021, Earth and Space Science, doi:10.1029/2021EA001637', url: 'https://doi.org/10.1029/2021EA001637' },
  },
  {
    when: { en: 'October 2025', ar: 'أكتوبر 2025' },
    what: {
      en: 'Oman hosted one of the habitats of a multi-continent Moon/Mars analog mission coordinated by the Austrian Space Forum (13–26 October).',
      ar: 'استضافت عُمان أحد مواقع الموائل في بعثة مماثلة للقمر والمريخ عبر عدة قارات نسّقها المنتدى الفضائي النمساوي (13–26 أكتوبر).',
    },
    source: { label: 'Oman Observer, 6 October 2025', url: 'https://www.omanobserver.om/ampArticle/1177656' },
  },
];

/** Martian meteorites found in Oman (find coordinates as published in the Meteoritical Bulletin). */
export const OMAN_METEORITES: { id: string; name: Localized; lat: number; lon: number; source: { label: string; url: string } }[] = [
  {
    id: 'sau005', name: { en: 'Sayh al Uhaymir 005 (Martian meteorite)', ar: 'صيح العهيمر 005 (نيزك مريخي)' }, lat: 20.9960, lon: 57.3258,
    source: { label: 'NASA JSC Mars Meteorite Compendium', url: 'https://curator.jsc.nasa.gov/antmet/mmc/SaU005.pdf' },
  },
  {
    id: 'dho019', name: { en: 'Dhofar 019 (Martian meteorite)', ar: 'ظفار 019 (نيزك مريخي)' }, lat: 18.3162, lon: 54.1478,
    source: { label: 'NASA NTRS 20020045902', url: 'https://ntrs.nasa.gov/citations/20020045902' },
  },
];

/** NASA's refined Artemis III candidate landing regions (announced October 2024), in no priority order. */
export const ARTEMIS_REGIONS = [
  'Peak near Cabeus B',
  'Haworth',
  'Malapert Massif',
  'Mons Mouton Plateau',
  'Mons Mouton',
  'Nobile Rim 1',
  'Nobile Rim 2',
  'de Gerlache Rim 2',
  'Slater Plain',
];

export const ARTEMIS_SOURCES = [
  { label: 'NASA: candidate regions for landing next Americans on the Moon (2022, 13 regions)', url: 'https://www.nasa.gov/?p=142681' },
  { label: 'Space.com: NASA announces 9 possible Artemis 3 landing regions (2024)', url: 'https://www.space.com/space-exploration/artemis/nasa-announces-9-possible-moon-landing-sites-for-artemis-3-lunar-mission' },
];
