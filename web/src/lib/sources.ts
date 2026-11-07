import type { Body, Localized } from '../types';

export interface DataSource {
  id: string;
  name: string;
  body: Body;
  criterion: 'terrain' | 'mineralogy' | 'surface';
  resolution: string;
  provider: string;
  url: string;
  use: Localized;
}

export const DATA_SOURCES: DataSource[] = [
  { id: 'NASADEM', name: 'NASADEM', body: 'earth', criterion: 'terrain', resolution: '30 m', provider: 'NASA LP DAAC', url: 'https://www.earthdata.nasa.gov/data/catalog/lpcloud-nasadem-hgt-001', use: { en: 'Elevation → slope, roughness, relief', ar: 'الارتفاع ← الانحدار والخشونة والتضاريس' } },
  { id: 'COPDEM', name: 'Copernicus DEM GLO-30', body: 'earth', criterion: 'terrain', resolution: '30 m', provider: 'ESA', url: 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM', use: { en: 'Backup elevation model', ar: 'نموذج ارتفاع احتياطي' } },
  { id: 'EMIT', name: 'EMIT L2A Reflectance', body: 'earth', criterion: 'mineralogy', resolution: '60 m', provider: 'NASA JPL / LP DAAC', url: 'https://earth.jpl.nasa.gov/emit/', use: { en: 'Imaging spectroscopy → serpentine, carbonate, chloride', ar: 'التحليل الطيفي ← السربنتين والكربونات والكلوريد' } },
  { id: 'ASTER', name: 'ASTER (VNIR/SWIR/TIR)', body: 'earth', criterion: 'mineralogy', resolution: '15–90 m', provider: 'NASA / METI', url: 'https://asterweb.jpl.nasa.gov/', use: { en: 'Multispectral mineral mapping (gap filler)', ar: 'رسم المعادن متعدد الأطياف (سد الفجوات)' } },
  { id: 'MODIS', name: 'MODIS MCD43A3 / MOD11A1', body: 'earth', criterion: 'surface', resolution: '500 m – 1 km', provider: 'NASA LP DAAC', url: 'https://modis.gsfc.nasa.gov/', use: { en: 'Albedo and day/night temperature → thermal inertia', ar: 'الألبيدو وحرارة الليل والنهار ← القصور الحراري' } },
  { id: 'MOLA', name: 'MGS MOLA DEM', body: 'mars', criterion: 'terrain', resolution: '463 m', provider: 'NASA / USGS', url: 'https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m', use: { en: 'Global elevation (common comparison scale)', ar: 'الارتفاع العالمي (مقياس المقارنة الموحّد)' } },
  { id: 'HIRISE', name: 'MRO HiRISE DTM', body: 'mars', criterion: 'terrain', resolution: '1 m', provider: 'NASA / Univ. of Arizona', url: 'https://www.uahirise.org/dtm/', use: { en: 'Local high-resolution terrain detail', ar: 'تفاصيل تضاريس محلية عالية الدقة' } },
  { id: 'CRISM', name: 'MRO CRISM', body: 'mars', criterion: 'mineralogy', resolution: '18–36 m', provider: 'NASA / JHU APL (PDS)', url: 'https://pds-geosciences.wustl.edu/missions/mro/crism.htm', use: { en: 'Hydrated minerals: serpentine, carbonate', ar: 'المعادن المائية: السربنتين والكربونات' } },
  { id: 'TES', name: 'MGS TES', body: 'mars', criterion: 'surface', resolution: '3 km', provider: 'NASA / ASU', url: 'https://tes.asu.edu/', use: { en: 'Albedo and global thermal inertia', ar: 'الألبيدو والقصور الحراري العالمي' } },
  { id: 'THEMIS', name: 'Mars Odyssey THEMIS', body: 'mars', criterion: 'surface', resolution: '100 m', provider: 'NASA / ASU', url: 'https://themis.asu.edu/', use: { en: 'Thermal inertia; chloride detection', ar: 'القصور الحراري ورصد الكلوريد' } },
  { id: 'LOLA', name: 'LRO LOLA DEM', body: 'moon', criterion: 'terrain', resolution: '5–20 m (polar)', provider: 'NASA GSFC', url: 'https://pgda.gsfc.nasa.gov/products/90', use: { en: 'South-pole elevation → slope, roughness, relief', ar: 'ارتفاع القطب الجنوبي ← الانحدار والخشونة والتضاريس' } },
  { id: 'DIVINER', name: 'LRO Diviner', body: 'moon', criterion: 'surface', resolution: '~250 m', provider: 'NASA / UCLA', url: 'https://www.diviner.ucla.edu/', use: { en: 'Future: albedo and thermal inertia (not scored yet)', ar: 'لاحقاً: الألبيدو والقصور الحراري (غير محتسب حالياً)' } },
];
