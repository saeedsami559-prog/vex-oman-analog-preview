import type { Localized } from '../types';

export interface Mineral {
  id: string;
  name: Localized;
  formula: string;
  /** Feature in sites.json, when the platform scores this mineral. */
  feature?: string;
  what: Localized;
  forms: Localized;
  mars: Localized;
  detect: Localized;
  oman: Localized;
  uses: Localized[];
  caution?: Localized;
  /** Ids from lib/references.ts. */
  refs: string[];
}

export const MINERALS: Mineral[] = [
  {
    id: 'serpentine',
    name: { en: 'Serpentine', ar: 'السربنتين' },
    formula: 'Mg₃Si₂O₅(OH)₄',
    feature: 'serpentine_index',
    what: {
      en: 'A green, often scaly group of minerals (antigorite, lizardite, chrysotile) made when water alters mantle rock.',
      ar: 'مجموعة معادن خضراء غالباً ذات ملمس حرشفي (أنتيغوريت، ليزارديت، كريسوتيل) تتكوّن عندما يغيّر الماء صخور الوشاح.',
    },
    forms: {
      en: 'Serpentinization: olivine and pyroxene react with water at low to moderate temperature. The reaction releases hydrogen, a possible energy source for microbes.',
      ar: 'التسربنت: يتفاعل الأوليفين والبيروكسين مع الماء في درجات حرارة منخفضة إلى متوسطة، ويُطلق التفاعل الهيدروجين، وهو مصدر طاقة محتمل للميكروبات.',
    },
    mars: {
      en: 'Found by orbit around Nili Fossae and Isidis. It proves that liquid water once reacted with Martian rock, in places that could have supported life.',
      ar: 'رُصد من المدار حول Nili Fossae وIsidis، ويثبت أن ماءً سائلاً تفاعل يوماً مع صخور المريخ في أماكن ربما كانت صالحة للحياة.',
    },
    detect: {
      en: 'Mg-OH absorption near 2.32 µm in reflected sunlight (CRISM on Mars, EMIT over Oman). The platform uses the same band on both.',
      ar: 'امتصاص Mg-OH قرب 2.32 ميكرومتر في ضوء الشمس المنعكس (CRISM على المريخ وEMIT فوق عُمان)، والمنصة تستخدم الحزمة نفسها في الجهتين.',
    },
    oman: {
      en: 'The Samail Ophiolite holds one of the largest exposures of serpentinized mantle rock on Earth.',
      ar: 'ألفيوليت سمائل من أكبر مكاشف صخور الوشاح المتسربنتة على الأرض.',
    },
    uses: [
      { en: 'Feedstock for carbon capture by mineralization', ar: 'مادة لاحتجاز الكربون بالتمعدن' },
      { en: 'Decorative and building stone', ar: 'حجر زينة وبناء' },
      { en: 'Source of magnesium and nickel', ar: 'مصدر للمغنيسيوم والنيكل' },
    ],
    caution: {
      en: 'Chrysotile is a form of asbestos; dust from it is a serious health hazard.',
      ar: 'الكريسوتيل أحد أشكال الأسبستوس، وغباره خطر صحي جسيم.',
    },
    refs: ['ehlmann2010', 'kelemen2008'],
  },
  {
    id: 'carbonate',
    name: { en: 'Carbonate (Mg-carbonate)', ar: 'الكربونات (كربونات المغنيسيوم)' },
    formula: 'MgCO₃ · CaCO₃',
    feature: 'carbonate_index',
    what: {
      en: 'Minerals built around the CO₃ group: magnesite, calcite, dolomite. On Mars the important one is Mg-rich carbonate.',
      ar: 'معادن مبنية حول مجموعة CO₃ مثل المغنيسيت والكالسيت والدولوميت، والأهم على المريخ هي الكربونات الغنية بالمغنيسيوم.',
    },
    forms: {
      en: 'CO₂ dissolved in water reacts with rock and precipitates as solid carbonate, locking carbon away for millions of years.',
      ar: 'يذوب ثاني أكسيد الكربون في الماء ويتفاعل مع الصخر فيترسّب كربوناتٍ صلبة تحبس الكربون ملايين السنين.',
    },
    mars: {
      en: 'Found in Nili Fossae and in the Jezero delta, where Perseverance is collecting samples. Carbonate means the water was not strongly acidic, and it can preserve signs of past life.',
      ar: 'وُجدت في Nili Fossae وفي دلتا Jezero حيث تجمع Perseverance العينات. وجود الكربونات يعني أن الماء لم يكن شديد الحموضة، ويمكنها حفظ آثار حياة قديمة.',
    },
    detect: {
      en: 'Two absorptions near 2.3 and 2.5 µm. Requiring both separates carbonate from serpentine, which has no 2.5 µm band.',
      ar: 'امتصاصان قرب 2.3 و2.5 ميكرومتر، واشتراط وجودهما معاً يفصل الكربونات عن السربنتين الذي ليس له حزمة 2.5.',
    },
    oman: {
      en: 'White carbonate veins and travertine terraces form today where Samail peridotite meets groundwater.',
      ar: 'تتكوّن اليوم عروق كربونات بيضاء ومدرجات ترافرتين حيث يلتقي بيريدوتيت سمائل بالمياه الجوفية.',
    },
    uses: [
      { en: 'Magnesite: refractory bricks for steel furnaces, magnesium oxide', ar: 'المغنيسيت: طوب حراري لأفران الصلب وأكسيد المغنيسيوم' },
      { en: 'Limestone: cement and lime', ar: 'الحجر الجيري: الإسمنت والجير' },
      { en: 'Permanent CO₂ storage', ar: 'تخزين دائم لثاني أكسيد الكربون' },
    ],
    refs: ['ehlmann2008', 'goudge2015', 'kelemen2008'],
  },
  {
    id: 'chloride',
    name: { en: 'Chloride salts', ar: 'أملاح الكلوريد' },
    formula: 'NaCl · KCl · MgCl₂',
    feature: 'chloride_index',
    what: {
      en: 'Salts such as halite (rock salt) left behind when salty water evaporates.',
      ar: 'أملاح مثل الهاليت (ملح الصخر) تبقى بعد تبخّر الماء المالح.',
    },
    forms: {
      en: 'In closed basins with no outlet, groundwater or lakes evaporate and leave salt crusts layer by layer.',
      ar: 'في الأحواض المغلقة بلا مَخرج يتبخّر الماء الجوفي أو البحيرات تاركاً قشور ملح طبقة بعد طبقة.',
    },
    mars: {
      en: 'About 200 chloride deposits sit in low spots of the southern highlands, such as Terra Sirenum: the last traces of evaporating water.',
      ar: 'نحو 200 رواسب كلوريد في منخفضات المرتفعات الجنوبية مثل Terra Sirenum: آخر آثار ماء يتبخّر.',
    },
    detect: {
      en: 'Chlorides have no diagnostic absorption between 0.4 and 2.5 µm. On Mars they were found in thermal infrared (THEMIS). We have no cited calibration for a chloride index, so the platform does not compute one.',
      ar: 'ليس للكلوريد امتصاص مميّز بين 0.4 و2.5 ميكرومتر، وقد رُصد على المريخ بالأشعة تحت الحمراء الحرارية (THEMIS). لا نملك معايرة موثّقة لمؤشر الكلوريد، لذلك لا تحسبه المنصة.',
    },
    oman: {
      en: 'Umm as Samim, on the western edge of Oman, is one of the largest salt flats in Arabia.',
      ar: 'أم السميم على الحدود الغربية لعُمان من أكبر السبخات الملحية في الجزيرة العربية.',
    },
    uses: [
      { en: 'Chlor-alkali industry: chlorine and caustic soda', ar: 'صناعة الكلور والقلويات: الكلور والصودا الكاوية' },
      { en: 'Food salt and preservation', ar: 'ملح الطعام والحفظ' },
      { en: 'Potash (KCl) fertiliser', ar: 'سماد البوتاس (كلوريد البوتاسيوم)' },
    ],
    refs: ['osterloo2008', 'usgs1982'],
  },
  {
    id: 'olivine',
    name: { en: 'Olivine', ar: 'الأوليفين' },
    formula: '(Mg,Fe)₂SiO₄',
    what: {
      en: 'An olive-green mineral that makes up most of Earth’s upper mantle and is common in Martian basalt.',
      ar: 'معدن أخضر زيتوني يشكّل معظم الوشاح العلوي للأرض وشائع في بازلت المريخ.',
    },
    forms: {
      en: 'Crystallises from hot magma. It weathers quickly in water, so where it survives, water was scarce or short-lived.',
      ar: 'يتبلور من الصهارة الساخنة ويتحلّل بسرعة في الماء، فحيث يبقى سليماً كان الماء قليلاً أو قصير الأمد.',
    },
    mars: {
      en: 'The parent rock of serpentine and carbonate around Nili Fossae and the floor of Jezero.',
      ar: 'الصخر الأم للسربنتين والكربونات حول Nili Fossae وفي قاع Jezero.',
    },
    detect: {
      en: 'Broad absorption around 1 µm. The platform does not score olivine; it is shown here because the other minerals form from it.',
      ar: 'امتصاص عريض حول 1 ميكرومتر. لا تحتسبه المنصة في المؤشر، ويُعرض هنا لأن المعادن الأخرى تتكوّن منه.',
    },
    oman: {
      en: 'Samail peridotite (harzburgite, dunite) is mostly olivine.',
      ar: 'بيريدوتيت سمائل (هارزبورجيت ودونيت) مكوّن في معظمه من الأوليفين.',
    },
    uses: [
      { en: 'Gemstone (peridot)', ar: 'حجر كريم (الزبرجد)' },
      { en: 'Foundry sand and refractories', ar: 'رمل المسابك والمواد الحرارية' },
      { en: 'Enhanced weathering to remove CO₂', ar: 'التجوية المعزّزة لإزالة ثاني أكسيد الكربون' },
    ],
    refs: ['ehlmann2008', 'goudge2015'],
  },
];
