// Team assessment per Omani site: what a field team could rehearse there and the resource angle.
// These are descriptive notes built on the values and card texts already on the site (and the
// minerals guide); they are labelled as an assessment in the UI and never feed a score.

import type { Localized } from '../types';

export interface FieldNotes {
  rehearse: Localized[];
  resources?: Localized;
}

export const FIELD_NOTES: Record<string, FieldNotes> = {
  samail_ophiolite: {
    rehearse: [
      {
        en: 'Mapping serpentine and carbonate from orbit-style spectra, then checking them on the ground, as CRISM did around Nili Fossae and Jezero.',
        ar: 'رسم خرائط السربنتين والكربونات من أطياف شبيهة بالمدارية ثم التحقق منها على الأرض، كما فعل CRISM حول Nili Fossae و Jezero.',
      },
      {
        en: 'Choosing and caching samples of water-altered rock, the task Perseverance is doing in the Jezero delta.',
        ar: 'اختيار عينات الصخور المتغيرة بالماء وحفظها، وهي المهمة التي تقوم بها Perseverance في دلتا Jezero.',
      },
    ],
    resources: {
      en: 'Serpentinization releases hydrogen, and carbonation locks CO2 into rock: both are studied here and both matter for producing resources from local rock on Mars.',
      ar: 'التسربن يُطلق الهيدروجين، والتكربن يحبس ثاني أكسيد الكربون في الصخر: كلاهما يُدرس هنا، وكلاهما مهم لإنتاج الموارد من الصخور المحلية على المريخ.',
    },
  },
  umm_as_samim: {
    rehearse: [
      {
        en: 'Driving and working on a flat salt crust over soft ground, like the low basins that hold chloride deposits in the Martian southern highlands.',
        ar: 'القيادة والعمل على قشرة ملحية مستوية فوق أرض لينة، مثل الأحواض المنخفضة التي تحتوي رواسب الكلوريد في المرتفعات الجنوبية للمريخ.',
      },
      {
        en: 'Testing how to find salts that reflected sunlight cannot see: on Mars, chlorides were mapped in thermal infrared.',
        ar: 'اختبار طرق رصد الأملاح التي لا يكشفها ضوء الشمس المنعكس: على المريخ رُصدت الكلوريدات بالأشعة تحت الحمراء الحرارية.',
      },
    ],
    resources: {
      en: 'Evaporating groundwater left the salts here. On Mars, chloride deposits mark where the last surface water evaporated, which makes them targets for water history and possible brines.',
      ar: 'تبخّر المياه الجوفية ترك الأملاح هنا. وعلى المريخ تدل رواسب الكلوريد على آخر مكان تبخرت فيه المياه السطحية، فهي أهداف لدراسة تاريخ الماء والمحاليل الملحية المحتملة.',
    },
  },
  sharqiya_sands: {
    rehearse: [
      {
        en: 'Rover and vehicle mobility in loose sand, between linear and star dunes.',
        ar: 'حركة المركبات الجوالة والمركبات في الرمال السائبة بين الكثبان الطولية والنجمية.',
      },
      {
        en: 'Measuring dune spacing and height from elevation data, then on foot, as planned for the Nili Patera dune field.',
        ar: 'قياس المسافة بين الكثبان وارتفاعها من بيانات الارتفاع ثم ميدانياً، كما هو مخطط لحقل كثبان Nili Patera.',
      },
    ],
  },
  dhofar_amadee18: {
    rehearse: [
      {
        en: 'A full analog mission: the Austrian Space Forum ran the AMADEE-18 Mars simulation here in 2018, so crew, logistics and experiments have already been tested on site.',
        ar: 'بعثة مماثلة كاملة: نفّذ المنتدى الفضائي النمساوي محاكاة المريخ AMADEE-18 هنا عام 2018، فالطاقم والإمداد والتجارب اختُبرت في الموقع من قبل.',
      },
      {
        en: 'Remote science with a time delay: from 1 to 28 February 2018 a field crew ran 19 experiments (geoscience, astrobiology, engineering, human factors) directed by a Mission Support Center in Innsbruck, with the Oman Astronomical Society and teams from 25 nations (Groemer et al. 2020).',
        ar: 'علم عن بُعد مع تأخير زمني: من 1 إلى 28 فبراير 2018 نفّذ طاقم ميداني 19 تجربة (علوم أرض، أحياء فلكية، هندسة، عوامل بشرية) بتوجيه من مركز دعم المهمة في إنسبروك، بالتعاون مع الجمعية الفلكية العمانية وفرق من 25 دولة (Groemer وآخرون 2020).',
      },
      {
        en: 'Sample triage before return: lab analysis of 25 sediment samples the analog astronauts collected found minerals formed by volcanism, hydrothermal activity and weathering, and the authors compare Dhofar with the Eridania Basin on Mars (Lalla et al. 2020).',
        ar: 'فرز العينات قبل إعادتها: التحليل المخبري لـ 25 عينة رواسب جمعها الرواد التناظريون كشف معادن تكوّنت بالبراكين والنشاط الحراري المائي والتجوية، ويقارن الباحثون ظفار بحوض Eridania على المريخ (Lalla وآخرون 2020).',
      },
    ],
  },
  jebel_shams: {
    rehearse: [
      {
        en: 'Traverses and landing-hazard mapping on steep slopes and high relief, the terrain of crater rims near the lunar south pole.',
        ar: 'التنقل ورسم خرائط مخاطر الهبوط على منحدرات شديدة وتضاريس مرتفعة، وهي تضاريس حواف الفوهات قرب القطب الجنوبي للقمر.',
      },
    ],
    resources: {
      en: 'No ice here: the main resource at the lunar south pole, water ice in permanently shadowed craters, has no analog at this site. It is a terrain analog only.',
      ar: 'لا يوجد جليد هنا: المورد الأهم في القطب الجنوبي للقمر، جليد الماء في الفوهات المظللة دائماً، لا نظير له في هذا الموقع. هو نظير للتضاريس فقط.',
    },
  },
};
