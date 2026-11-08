import { describe, expect, it } from 'vitest';
import { decide, decodeTerrarium, ranksFor, safeShare, scoreOf, slopeClass, slopeField, toKml, toLatLon, type ScoutCell } from './scout';

const cell = (over: Partial<ScoutCell> = {}): ScoutCell => ({
  id: 'c', lat: 23, lon: 58, land_frac: 1, slope_deg: 5, roughness_m: 10, relief_m: 200,
  elev_min: 0, elev_max: 100, elev_mean: 50, built_pct: 0.2, crop_pct: 0.1, km_muscat: 100,
  mars: {}, mars_best: null, mars_score: 0.8, moon_score: 0.7, mars_rank: 3, moon_rank: 80, heightmap: null,
  ...over,
});

describe('terrarium decode', () => {
  it('reads the encoding the pipeline writes', () => {
    // 1234.5 m -> v = 34002.5 -> R 132, G 210, B 128
    expect(decodeTerrarium([132, 210, 128, 255], 1)[0]).toBeCloseTo(1234.5, 3);
  });
});

describe('slope', () => {
  it('is zero on flat ground and 45 deg on a 1:1 ramp', () => {
    const px = 4;
    const flat = new Float32Array(px * px).fill(100);
    expect(Math.max(...slopeField(flat, px, 10))).toBe(0);
    const ramp = new Float32Array(px * px).map((_, i) => (i % px) * 10);
    expect(slopeField(ramp, px, 10)[5]).toBeCloseTo(45, 5);
  });
  it('classes and safe share', () => {
    expect(slopeClass(5)).toBe('pass');
    expect(slopeClass(15)).toBe('warn');
    expect(slopeClass(40)).toBe('fail');
    expect(safeShare(new Float32Array([1, 1, 30, 30]), 2, 10)).toBe(0.5);
  });
});

describe('decision rules', () => {
  it('GO when every criterion passes', () => {
    expect(decide(cell(), 3, 100, 0.6).verdict).toBe('go');
  });
  it('CONDITIONAL with a warning and no failure', () => {
    expect(decide(cell({ km_muscat: 800 }), 3, 100, 0.6).verdict).toBe('conditional');
  });
  it('NO-GO on steep ground, a low rank or a built-up cell', () => {
    expect(decide(cell(), 3, 100, 0.05).verdict).toBe('nogo');
    expect(decide(cell(), 80, 100, 0.6).verdict).toBe('nogo');
    expect(decide(cell({ built_pct: 6 }), 3, 100, 0.6).verdict).toBe('nogo');
  });
  it('ranks by the chosen target', () => {
    const a = cell({ id: 'a', mars: { x: 0.9, y: 0.1 }, mars_score: 0.9, moon_score: 0.2 });
    const b = cell({ id: 'b', mars: { x: 0.5, y: 0.8 }, mars_score: 0.8, moon_score: 0.6 });
    expect(ranksFor([a, b], 'mars').get('a')).toBe(1);
    expect(ranksFor([a, b], 'mars', 'y').get('b')).toBe(1);
    expect(ranksFor([a, b], 'moon').get('b')).toBe(1);
    expect(scoreOf(b, 'mars', 'y')).toBe(0.8);
  });
});

describe('geo and export', () => {
  it('converts local metres to degrees', () => {
    const [lat, lon] = toLatLon({ lat: 0, lon: 0 }, 111_320, 111_320);
    expect(lat).toBeCloseTo(1, 6);
    expect(lon).toBeCloseTo(1, 6);
  });
  it('writes KML with escaped names, path and markers', () => {
    const k = toKml('A & B', [{ lat: 1, lon: 2, altM: 100 }, { lat: 1.1, lon: 2.1, altM: 120 }], [{ lat: 1, lon: 2, label: '<x>' }]);
    expect(k).toContain('<name>A &amp; B</name>');
    expect(k).toContain('2.000000,1.000000,100 2.100000,1.100000,120');
    expect(k).toContain('&lt;x&gt;');
  });
});
