/**
 * Approximate heliocentric positions from JPL's Keplerian elements
 * (Standish, "Approximate Positions of the Planets", valid 1800–2050).
 * Good to well under 1% for the Earth–Mars distance, which is all the hero needs.
 */
const DEG = Math.PI / 180;
export const AU_KM = 149_597_870.7;
export const LIGHT_KM_S = 299_792.458;

type Pair = readonly [value: number, ratePerCentury: number];
interface Elements { a: Pair; e: Pair; I: Pair; L: Pair; wbar: Pair; node: Pair }

const EARTH: Elements = {
  a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668],
  L: [100.46457166, 35999.37244981], wbar: [102.93768193, 0.32327364], node: [0, 0],
};
const MARS: Elements = {
  a: [1.52371034, 0.00001847], e: [0.0933941, 0.00007882], I: [1.84969142, -0.00813131],
  L: [-4.55343205, 19140.30268499], wbar: [-23.94362959, 0.44441088], node: [49.55953891, -0.29257343],
};

function position(el: Elements, T: number): [number, number, number] {
  const v = (p: Pair) => p[0] + p[1] * T;
  const a = v(el.a), e = v(el.e), I = v(el.I) * DEG, L = v(el.L), wbar = v(el.wbar), node = v(el.node);
  const w = (wbar - node) * DEG;
  const O = node * DEG;
  let M = (L - wbar) % 360;
  if (M > 180) M -= 360;
  if (M < -180) M += 360;
  M *= DEG;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** Straight-line Earth–Mars distance in km at the given instant. */
export function earthMarsDistanceKm(date: Date): number {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const T = (jd - 2_451_545) / 36_525;
  const [ex, ey, ez] = position(EARTH, T);
  const [mx, my, mz] = position(MARS, T);
  return Math.hypot(mx - ex, my - ey, mz - ez) * AU_KM;
}

/*
 * Earth–Moon distance (centre to centre) from Meeus, "Astronomical Algorithms",
 * 2nd ed., ch. 47 (ELP-2000/82 truncated): the leading periodic terms of Table 47.A.
 * Accurate to a few tens of km, far below the ±21,000 km the distance swings each month.
 */
// [D, M, M', F, coefficient in units of 0.001 km]
const MOON_R: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 1, 0, -20905355], [2, 0, -1, 0, -3699111], [2, 0, 0, 0, -2955968], [0, 0, 2, 0, -569925],
  [0, 1, 0, 0, 48888], [0, 0, 0, 2, -3149], [2, 0, -2, 0, 246158], [2, -1, -1, 0, -152138],
  [2, 0, 1, 0, -170733], [2, -1, 0, 0, -204586], [0, 1, -1, 0, -129620], [1, 0, 0, 0, 108743],
  [0, 1, 1, 0, 104755], [2, 0, 0, -2, 10321], [0, 0, 1, -2, 79661], [4, 0, -1, 0, -34782],
  [0, 0, 3, 0, -23210], [4, 0, -2, 0, -21636], [2, 1, -1, 0, 24208], [2, 1, 0, 0, 30824],
  [1, 0, -1, 0, -8379], [1, 1, 0, 0, -16675], [2, -1, 1, 0, -12831], [2, 0, 2, 0, -10445],
  [4, 0, 0, 0, -11650], [2, 0, -3, 0, 14403], [0, 1, -2, 0, -7003], [2, -1, -2, 0, 10056],
  [1, 0, 1, 0, 6322], [2, -2, 0, 0, -9884], [0, 1, 2, 0, 5751], [2, -2, -1, 0, -4950],
  [2, 0, 1, -2, 4130], [4, -1, -1, 0, -3958], [3, 0, -1, 0, 3258], [2, 1, 1, 0, 2616],
  [4, -1, -2, 0, -1897], [0, 2, -1, 0, -2117], [2, 2, -1, 0, 2354],
];

/** Straight-line Earth–Moon distance (centre to centre) in km at the given instant. */
export function earthMoonDistanceKm(date: Date): number {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const T = (jd - 2_451_545) / 36_525;
  const D = (297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868 - T ** 4 / 113065000) * DEG;
  const M = (357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + T ** 3 / 24490000) * DEG;
  const Mp = (134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699 - T ** 4 / 14712000) * DEG;
  const F = (93.272095 + 483202.0175233 * T - 0.0036539 * T * T - T ** 3 / 3526000 + T ** 4 / 863310000) * DEG;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  let sum = 0;
  for (const [d, m, mp, f, c] of MOON_R) {
    const k = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sum += c * k * Math.cos(d * D + m * M + mp * Mp + f * F);
  }
  return 385000.56 + sum / 1000;
}
