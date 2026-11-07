import type { Localized } from '../types';

/** Peer-reviewed work behind each comparison. Every DOI was checked on 2026-11-06. */
export interface Reference {
  id: string;
  cite: string;
  title: string;
  venue: string;
  url: string;
  /** Site ids this paper supports (Oman side or target side). */
  sites: string[];
  supports: Localized;
}

const doi = (d: string) => `https://doi.org/${d}`;

export const REFERENCES: Reference[] = [
  {
    id: 'kelemen2008', cite: 'Kelemen & Matter (2008)', title: 'In situ carbonation of peridotite for CO2 storage',
    venue: 'PNAS 105(45), 17295–17300', url: doi('10.1073/pnas.0805794105'), sites: ['samail_ophiolite'],
    supports: {
      en: 'Samail peridotite reacts with water and CO2 to form serpentine and carbonate veins today.',
      ar: 'بيريدوتيت سمائل يتفاعل مع الماء وثاني أكسيد الكربون مكوّناً عروق السربنتين والكربونات حتى اليوم.',
    },
  },
  {
    id: 'ehlmann2008', cite: 'Ehlmann et al. (2008)', title: 'Orbital identification of carbonate-bearing rocks on Mars',
    venue: 'Science 322(5909), 1828–1832', url: doi('10.1126/science.1164759'), sites: ['nili_fossae'],
    supports: {
      en: 'First orbital detection of Mg-carbonate on Mars, in Nili Fossae, with olivine and clays.',
      ar: 'أول رصد مداري لكربونات المغنيسيوم على المريخ في Nili Fossae مع الأوليفين والطين.',
    },
  },
  {
    id: 'ehlmann2010', cite: 'Ehlmann, Mustard & Murchie (2010)', title: 'Geologic setting of serpentine deposits on Mars',
    venue: 'Geophysical Research Letters 37, L06201', url: doi('10.1029/2010GL042596'), sites: ['nili_fossae'],
    supports: {
      en: 'Serpentine on Mars, including the olivine-rich unit near Isidis: evidence of past serpentinization.',
      ar: 'السربنتين على المريخ ومنها الوحدة الغنية بالأوليفين قرب Isidis: دليل على تسربنت قديم.',
    },
  },
  {
    id: 'goudge2015', cite: 'Goudge et al. (2015)', title: 'Assessing the mineralogy of the watershed and fan deposits of the Jezero crater paleolake system, Mars',
    venue: 'JGR Planets 120, 775–808', url: doi('10.1002/2014JE004782'), sites: ['jezero_crater'],
    supports: {
      en: 'Jezero delta holds Mg-carbonate and olivine carried in by rivers from its watershed.',
      ar: 'دلتا Jezero تحوي كربونات المغنيسيوم والأوليفين نقلتها الأنهار من حوض التصريف.',
    },
  },
  {
    id: 'osterloo2008', cite: 'Osterloo et al. (2008)', title: 'Chloride-bearing materials in the southern highlands of Mars',
    venue: 'Science 319(5870), 1651–1654', url: doi('10.1126/science.1150690'), sites: ['terra_sirenum_chlorides'],
    supports: {
      en: 'About 200 chloride deposits in the southern highlands, found with THEMIS thermal-infrared data.',
      ar: 'نحو 200 رواسب كلوريد في المرتفعات الجنوبية رُصدت ببيانات THEMIS الحرارية.',
    },
  },
  {
    id: 'usgs1982', cite: 'U.S. Geological Survey (1982)', title: 'Open-File Report 82-387 (Umm as Samim area, eastern Rub al Khali)',
    venue: 'USGS Open-File Report',url: 'https://pubs.usgs.gov/of/1982/0387/report.pdf', sites: ['umm_as_samim'],
    supports: {
      en: 'Describes Umm as Samim as one of the largest contiguous salt flats and studies its brine.',
      ar: 'يصف أم السميم كواحدة من أكبر السبخات المتصلة ويدرس محاليلها الملحية.',
    },
  },
  {
    id: 'radies2004', cite: 'Radies et al. (2004)', title: 'Eustatic and climatic controls on the development of the Wahiba Sand Sea, Sultanate of Oman',
    venue: 'Sedimentology 51(6), 1359–1385', url: doi('10.1111/j.1365-3091.2004.00678.x'), sites: ['sharqiya_sands'],
    supports: {
      en: 'How the Wahiba (Sharqiya) sand sea and its dunes formed.',
      ar: 'كيف تكوّن بحر رمال الشرقية (وهيبة) وكثبانه.',
    },
  },
  {
    id: 'silvestro2010', cite: 'Silvestro et al. (2010)', title: 'Ripple migration and dune activity on Mars: Evidence for dynamic wind processes',
    venue: 'Geophysical Research Letters 37, L20203', url: doi('10.1029/2010GL044743'), sites: ['nili_patera_dunes'],
    supports: {
      en: 'Nili Patera dunes and ripples move today under Martian winds (HiRISE).',
      ar: 'كثبان Nili Patera وتموّجاتها تتحرك اليوم بفعل رياح المريخ (HiRISE).',
    },
  },
  {
    id: 'lalla2020', cite: 'Lalla et al. (2020)', title: 'Laboratory analysis of returned samples from the AMADEE-18 Mars analog mission',
    venue: 'Astrobiology 20(11), 1303–1320', url: doi('10.1089/ast.2019.2038'), sites: ['dhofar_amadee18'],
    supports: {
      en: 'Lab analyses of 25 Dhofar samples from the 2018 mission; the authors compare Dhofar with the Eridania Basin on Mars.',
      ar: 'تحليل مخبري لـ 25 عينة من ظفار جُمعت في مهمة 2018؛ ويقارن الباحثون ظفار بحوض Eridania على المريخ.',
    },
  },
  {
    id: 'zuber2012', cite: 'Zuber et al. (2012)', title: 'Constraints on the volatile distribution within Shackleton crater at the lunar south pole',
    venue: 'Nature 486, 378–381', url: doi('10.1038/nature11216'), sites: ['moon_south_pole'],
    supports: {
      en: 'LOLA topography of Shackleton crater: steep walls, rim relief and slopes.',
      ar: 'تضاريس فوهة Shackleton من LOLA: جدران شديدة الانحدار وارتفاع الحافة.',
    },
  },
];

export function referencesFor(...siteIds: string[]): Reference[] {
  return REFERENCES.filter((r) => siteIds.some((id) => r.sites.includes(id)));
}
