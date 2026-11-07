import type { Localized } from '../types';

/**
 * One job per page. The home page directory and the "Continue exploring" links at the end of each page
 * are built from this list, so every page says what only it does and points onward instead of repeating.
 */
export type PageId = 'explorer' | 'atlas' | 'minerals' | 'methodology' | 'sources' | 'mission' | 'about' | 'present';

export interface PageInfo {
  id: PageId;
  to: string;
  job: Localized;
}

export const PAGES: PageInfo[] = [
  { id: 'explorer', to: '/explorer', job: { en: 'Compare any Omani site with any Mars or Moon target, change the weights, or start from a target and find its best Omani analog.', ar: 'قارن أي موقع عُماني بأي هدف على المريخ أو القمر، وغيّر الأوزان، أو ابدأ من الهدف وابحث عن أقرب موقع عُماني له.' } },
  { id: 'atlas', to: '/atlas', job: { en: "Oman among the world's analog sites: challenge categories, a new cave candidate, field climate and NASA's Moon base regions.", ar: 'عُمان بين المواقع المماثلة في العالم: فئات التحدي، ومرشّح كهف جديد، ومناخ العمل الميداني، ومناطق قاعدة القمر لدى ناسا.' } },
  { id: 'minerals', to: '/minerals', job: { en: 'What serpentine, carbonate, chloride and olivine are, why they matter on Mars, and how strongly each site shows them.', ar: 'ما السربنتين والكربونات والكلوريد والأوليفين، ولماذا تهم على المريخ، وما قوة ظهورها في كل موقع.' } },
  { id: 'methodology', to: '/methodology', job: { en: 'The formula, the validation, the weight sensitivity test and the limits behind every score.', ar: 'المعادلة والتحقق واختبار حساسية الأوزان والحدود وراء كل درجة.' } },
  { id: 'sources', to: '/sources', job: { en: 'Every dataset and product ID, which values are missing and why, plus JSON and CSV downloads.', ar: 'كل مجموعة بيانات ومعرّف منتج، والقيم الناقصة وسببها، مع تنزيل JSON و CSV.' } },
  { id: 'mission', to: '/mission', job: { en: 'A nine-day field-campaign concept that tests the scores on the ground in the best season.', ar: 'تصوّر لحملة ميدانية من تسعة أيام تختبر الدرجات على الأرض في أنسب موسم.' } },
  { id: 'about', to: '/about', job: { en: 'The challenge and how each part is answered, Team VEX, use of AI, and how to cite the project.', ar: 'التحدي وكيف أجبنا عن كل جزء منه، وفريق VEX، واستخدام الذكاء الاصطناعي، وكيفية الاستشهاد بالمشروع.' } },
  { id: 'present', to: '/present', job: { en: 'The project in seven slides, ready for judges (arrow keys to move, P to print).', ar: 'المشروع في سبع شرائح جاهزة للحكّام (الأسهم للتنقل، P للطباعة).' } },
];

/** Where each page sends the reader next. Keys are page ids, plus 'site' for site pages. */
export const NEXT: Record<PageId | 'site', PageId[]> = {
  explorer: ['atlas', 'methodology'],
  atlas: ['mission', 'explorer'],
  minerals: ['explorer', 'sources'],
  methodology: ['sources', 'explorer'],
  sources: ['methodology', 'about'],
  mission: ['atlas', 'about'],
  about: ['present', 'methodology'],
  present: ['explorer', 'about'],
  site: ['mission', 'minerals'],
};

export const pageInfo = (id: PageId) => PAGES.find((p) => p.id === id)!;
