// node test/run.mjs — accuracy/robustness checks on synthetic meshes with known mirror planes.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const S = require('../symcore.js');

let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails++; };
const deg = r => (r * 180) / Math.PI;

function planeError(c, nT, dT) {
  const dp = c.n[0] * nT[0] + c.n[1] * nT[1] + c.n[2] * nT[2];
  return { ang: deg(Math.acos(Math.min(1, Math.abs(dp)))), off: Math.abs(c.d - Math.sign(dp) * dT) };
}

function posed(tris, seed) {
  let a = seed * 2654435761 >>> 0;
  const r = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  const R = S.rotationXYZ(r() * 2 * Math.PI, (r() - 0.5) * Math.PI, r() * 2 * Math.PI);
  const t = [(r() - 0.5) * 400, (r() - 0.5) * 400, (r() - 0.5) * 400];
  const nT = [R[0], R[3], R[6]];
  return { tris: S.rigid(tris, R, t), nT, dT: nT[0] * t[0] + nT[1] * t[1] + nT[2] * t[2] };
}

function box(B, x0, x1, y0, y1, z0, z1) {
  const q = (a, b, c, d) => B.push(...a, ...b, ...c, ...a, ...c, ...d);
  q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
  q([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
  q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
}

console.log('# primitives');
{
  const crc = S.crc32(new TextEncoder().encode('123456789'));
  check(crc === 0xcbf43926, `crc32 check value ${crc.toString(16)}`);
  const t = S.seatPost({ seg: 24, nz: 3 });
  const back = S.parseSTL(S.writeSTL(t));
  check(back.length === t.length && back.every((v, i) => v === t[i]), `binary STL round trip (${t.length / 9} tris)`);
  const ascii = 'solid x\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1.5e0 0\n  endloop\n endfacet\nendsolid x\n';
  const a = S.parseSTL(new TextEncoder().encode(ascii).buffer);
  check(a.length === 9 && a[7] === 1.5, 'ASCII STL parse');
  const { closestPtTri, CP } = S._internal;
  closestPtTri(0.2, 0.2, 5, 0, 0, 0, 1, 0, 0, 0, 1, 0);
  check(Math.abs(CP[0] - 0.2) < 1e-12 && Math.abs(CP[1] - 0.2) < 1e-12 && CP[2] === 0, 'closest point, face region');
  closestPtTri(2, -1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0);
  check(CP[0] === 1 && CP[1] === 0, 'closest point, vertex region');
}

async function run(name, tris, nT, dT, expect) {
  const t0 = Date.now();
  const an = await S.analyse(tris);
  const ms = Date.now() - t0;
  const c = an.candidates[0];
  const e = planeError(c, nT, dT);
  console.log(`  ${name}: ${tris.length / 9} tris, ${ms} ms | ang ${e.ang.toExponential(2)}° off ${e.off.toExponential(2)} | median ${c.median.toExponential(2)} p95 ${c.p95.toExponential(2)} match ${(100 * c.match).toFixed(1)}% | cands ${an.candidates.length}`);
  if (expect) {
    check(e.ang < expect.ang, `${name}: angle error < ${expect.ang}°`);
    check(e.off < expect.off, `${name}: offset error < ${expect.off}`);
  }
  return { an, c, e };
}

console.log('# seat post, random poses (logo = real one-sided asymmetry)');
for (let s = 1; s <= 6; s++) {
  const p = posed(S.seatPost(), s);
  await run(`pose ${s}`, p.tris, p.nT, p.dT, { ang: 0.01, off: 0.01 });
}

console.log('# small clamp head (half size) — tube dominates, rotation about axis weakly constrained');
for (let s = 7; s <= 9; s++) {
  const p = posed(S.seatPost({ head: 0.5 }), s);
  await run(`small head ${s}`, p.tris, p.nT, p.dT, { ang: 0.02, off: 0.01 });
}

console.log('# high-res tessellation (timing)');
{
  const p = posed(S.seatPost({ seg: 360, nz: 120 }), 21);
  await run('hi-res', p.tris, p.nT, p.dT, { ang: 0.01, off: 0.01 });
}

console.log('# mixed triangle winding (every 3rd triangle flipped)');
{
  const t = S.seatPost();
  for (let i = 0; i < t.length / 9; i += 3) {
    const b = 9 * i;
    for (let k = 0; k < 3; k++) { const x = t[b + 3 + k]; t[b + 3 + k] = t[b + 6 + k]; t[b + 6 + k] = x; }
  }
  const p = posed(t, 31);
  const r = await run('mixed winding', p.tris, p.nT, p.dT, { ang: 0.02, off: 0.02 });
  check(r.c.unoriented === true, 'mixed winding: fell back to unoriented normals');
}

console.log('# box 100x60x30 (three planes): must return one of them');
{
  const B = []; box(B, -50, 50, -30, 30, -15, 15);
  const p = posed(new Float32Array(B), 41);
  const an = await S.analyse(p.tris);
  const R = S.rotationXYZ(0, 0, 0);
  const c = an.candidates[0];
  // Recover pose-independent check: plane must pass through box centre and be parallel to a face.
  const cen = [0, 0, 0];
  for (let i = 0; i < p.tris.length; i += 3) { cen[0] += p.tris[i]; cen[1] += p.tris[i + 1]; cen[2] += p.tris[i + 2]; }
  const nv = p.tris.length / 3; cen[0] /= nv; cen[1] /= nv; cen[2] /= nv;
  const dist = Math.abs(c.n[0] * cen[0] + c.n[1] * cen[1] + c.n[2] * cen[2] - c.d);
  check(dist < 1e-3 && c.median < 1e-3, `box: plane through centre (${dist.toExponential(2)}), median ${c.median.toExponential(2)}, ${an.candidates.length} candidates`);
  void R;
}

console.log('# asymmetric clutter: must not crash, must report poor symmetry');
{
  const B = [];
  let a = 99;
  const r = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 7; k++) {
    const x = r() * 80, y = r() * 60, z = r() * 40;
    box(B, x, x + 5 + r() * 30, y, y + 5 + r() * 20, z, z + 5 + r() * 25);
  }
  const an = await S.analyse(new Float32Array(B));
  const c = an.candidates[0];
  check(c.match < 0.9, `clutter: match ${(100 * c.match).toFixed(1)}% (poor, as expected)`);
}

console.log('# output frame: mirror plane lands on x = 0, pure rotation');
{
  const p = posed(S.seatPost(), 51);
  const an = await S.analyse(p.tris);
  for (const origin of ['bbox', 'min', 'centroid']) {
    for (const [rx, fz] of [[0, 0], [1, 0], [3, 1]]) {
      const f = S.frame(an, an.candidates[0], { origin, rx, fz });
      const R = f.R;
      const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
      const out = S.transform(p.tris, f.M);
      const an2 = await S.analyse(out);
      const c2 = an2.candidates[0];
      const e = planeError(c2, [1, 0, 0], 0);
      check(Math.abs(det - 1) < 1e-12 && e.ang < 0.01 && e.off < 0.01,
        `origin=${origin} rx=${rx} fz=${fz}: det ${det.toFixed(12)}, re-detected plane ∠${e.ang.toExponential(2)}° from YZ, x-offset ${e.off.toExponential(2)}`);
    }
  }
  const f = S.frame(an, an.candidates[0], { origin: 'bbox' });
  console.log('  extents (bbox origin):', f.ext.map(r => r.map(v => v.toFixed(3)).join(' .. ')).join(' | '));
  check(Math.abs(f.ext[1][0] + f.ext[1][1]) < 1e-9 && Math.abs(f.ext[2][0] + f.ext[2][1]) < 1e-9, 'bbox origin: symmetric Y/Z extents');
  // Tube axis should come out along ±Z with the head at +Z.
  const out = S.transform(p.tris, f.M);
  let zmax = -Infinity, ymaxAtTop = 0;
  for (let i = 0; i < out.length; i += 3) if (out[i + 2] > zmax) { zmax = out[i + 2]; ymaxAtTop = out[i + 1]; }
  check(zmax > 150, `head at +Z (z max ${zmax.toFixed(2)}, y there ${ymaxAtTop.toFixed(2)})`);
}

console.log('# free rotation: tube axis must come out exactly on Z (clean box 28 × 60 × 309)');
{
  const p = posed(S.seatPost({ logo: false }), 61);
  const an = await S.analyse(p.tris);
  const f = S.frame(an, an.candidates[0], { origin: 'min' });
  const size = f.ext.map(r => r[1] - r[0]);
  console.log('  size:', size.map(v => v.toFixed(5)).join(' × '), '| origin=min Y,Z ranges:', f.ext.slice(1).map(r => r.map(v => v.toFixed(5)).join('..')).join(', '));
  check(Math.abs(size[0] - 28) < 2e-3 && Math.abs(size[1] - 60) < 2e-3 && Math.abs(size[2] - 309) < 2e-3, 'box is 28 × 60 × 309 within 0.002');
}

console.log('# second plane (locked perpendicular to plane 1)');
{
  const B = []; box(B, -50, 50, -30, 30, -15, 15);
  const p = posed(new Float32Array(B), 71);
  const an = await S.analyse(p.tris);
  const c1 = an.candidates[0];
  const [c2] = await S.secondPlane(an, c1);
  const dp = Math.abs(c1.n[0] * c2.n[0] + c1.n[1] * c2.n[1] + c1.n[2] * c2.n[2]);
  check(dp < 1e-9 && c2.median < 1e-3 && c2.match > 0.99, `box: plane 2 ⊥ plane 1 (|n1·n2| ${dp.toExponential(1)}), median ${c2.median.toExponential(2)}, match ${(100 * c2.match).toFixed(1)}%`);
  for (const rx of [0, 1]) {
    const f = S.frame(an, c1, { origin: 'bbox', second: c2, rx });
    const out = S.transform(p.tris, f.M);
    let m = [1e9, 1e9, 1e9], M = [-1e9, -1e9, -1e9];
    for (let i = 0; i < out.length; i += 3) for (let k = 0; k < 3; k++) { m[k] = Math.min(m[k], out[i + k]); M[k] = Math.max(M[k], out[i + k]); }
    const ax = f.plane2 === 'XZ' ? 1 : 2;
    check(Math.abs(m[0] + M[0]) < 1e-3 && Math.abs(m[ax] + M[ax]) < 1e-3,
      `box rx=${rx}: plane 2 → ${f.plane2}, extents ${m.map((v, k) => v.toFixed(3) + '..' + M[k].toFixed(3)).join(' | ')}`);
  }
  const sp = posed(S.seatPost(), 72);
  const an2 = await S.analyse(sp.tris);
  const [s2] = await S.secondPlane(an2, an2.candidates[0]);
  console.log(`  seat post plane 2 (setback → should be poor): match ${(100 * s2.match).toFixed(1)}%, P95 ${s2.p95.toFixed(2)} mm`);
  check(s2.match < 0.97, 'seat post: plane 2 reported worse than plane 1');
}

console.log('# extrusion axis (in the mirror plane)');
for (const [o, seed] of [[{}, 81], [{ head: 0.5 }, 82], [{ seg: 360, nz: 120 }, 83]]) {
  const p = posed(S.seatPost(o), seed);
  const E = S.engine(); await E.analyse(p.tris);
  const ax = (await E.extrude(0)).value;
  // tube axis = posed local Z
  let a = seed * 2654435761 >>> 0; const r = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  const R = S.rotationXYZ(r() * 2 * Math.PI, (r() - 0.5) * Math.PI, r() * 2 * Math.PI), z = [R[2], R[5], R[8]];
  const ang = deg(Math.acos(Math.min(1, Math.abs(ax[0].dir[0] * z[0] + ax[0].dir[1] * z[1] + ax[0].dir[2] * z[2]))));
  check(ang < 0.01, `${JSON.stringify(o)}: axis 1 is ${ang.toExponential(2)}° from the tube axis (${(100 * ax[0].share).toFixed(1)} % of side walls, ${ax.length} candidate(s))`);
}

console.log('# flat faces (in the mirror plane)');
{
  const E = S.engine(); await E.analyse(S.seatPost({ logo: false }));
  const f = (await E.flats(0)).value;
  const ok = f.length >= 4 && f.slice(0, 4).every(p => Math.abs(Math.abs(p.dir[2]) - 1) < 1e-6 && p.rms < 1e-6);
  check(ok, `seat post clamp: ${f.length} flat faces, top 4 horizontal and exact (areas ${f.slice(0, 4).map(p => Math.round(p.area)).join(', ')} mm²)`);
  const z = f.map(p => Math.sign(p.dir[2]));
  check(z.slice(0, 4).join() === '1,-1,-1,1', `outward sides from face normals: ${z.slice(0, 4).join(', ')}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
