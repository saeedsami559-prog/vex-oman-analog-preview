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
