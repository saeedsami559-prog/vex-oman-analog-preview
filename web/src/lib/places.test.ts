import { describe, expect, it } from 'vitest';
import { describePlace, inGeometry, whereIs, type Places } from './places';

const square = (x0: number, y0: number, x1: number, y1: number) => ({ type: 'Polygon' as const, coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] as [number, number][][] });
const P: Places = {
  border: square(56, 22, 59, 25),
  governorates: [{ en: 'Ad Dakhiliyah', ar: 'الداخلية', lat: 23, lon: 57.5, geometry: square(56, 22, 59, 25) }],
  towns: [['Bahla', 'بهلاء', 22.98, 57.3, 2], ['Tiny', null, 23.0, 57.0, 0]],
  note: '',
};
const t = (k: string, v?: Record<string, string | number>) => (k === 'places.near' ? `${v!.km} km from ${v!.place}` : k === 'places.at' ? String(v!.place) : k);

describe('places', () => {
  it('finds the governorate and the nearest town with people', () => {
    expect(inGeometry(57, 23, P.governorates[0].geometry)).toBe(true);
    expect(inGeometry(60, 23, P.governorates[0].geometry)).toBe(false);
    const w = whereIs(P, 23.0, 57.05);
    expect(w.gov?.en).toBe('Ad Dakhiliyah');
    expect(w.town?.[0]).toBe('Bahla'); // 'Tiny' has rank 0
  });
  it('says it in words, in both languages, and over the sea', () => {
    expect(describePlace(P, 23.08, 57.3, t, (v) => v.en)).toBe('11 km from Bahla, Ad Dakhiliyah');
    expect(describePlace(P, 22.98, 57.3, t, (v) => v.ar)).toBe('بهلاء، الداخلية');
    expect(describePlace(P, 23, 60, t, (v) => v.en, true)).toBe('scout.overSea');
  });
});
