/* symcore.js — reflective-symmetry plane detection + reorientation for STL triangle meshes.
   No dependencies. Browser: window.SymCore. Node: module.exports. */
(function (root) {
'use strict';

/* ------------------------------------------------------------------ STL I/O */

function parseSTL(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const n = u8.length;
  const cnt = n >= 84 ? dv.getUint32(80, true) : 0;
  if (cnt > 0 && 84 + cnt * 50 === n) return readBinary(dv, cnt);
  let i = 0;
  while (i < n && i < 1024 && u8[i] <= 32) i++;
  const head = String.fromCharCode.apply(null, u8.subarray(i, Math.min(n, i + 5))).toLowerCase();
  if (head === 'solid') {
    const tris = readASCII(new TextDecoder().decode(u8));
    if (tris.length) return tris;
  }
  // Some exporters append junk after the triangle block.
  if (cnt > 0 && 84 + cnt * 50 <= n) return readBinary(dv, cnt);
  throw new Error('Not a readable STL (neither binary nor ASCII).');
}

function readBinary(dv, cnt) {
  const out = new Float32Array(cnt * 9);
  for (let t = 0, o = 96, k = 0; t < cnt; t++, o += 50) {
    for (let j = 0; j < 9; j++) out[k++] = dv.getFloat32(o + 4 * j, true);
  }
  return out;
}

function readASCII(txt) {
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  const v = [];
  let m;
  while ((m = re.exec(txt)) !== null) v.push(+m[1], +m[2], +m[3]);
  return Float32Array.from(v.slice(0, v.length - (v.length % 9)));
}

function writeSTL(tris, header) {
  const n = (tris.length / 9) | 0;
  const buf = new ArrayBuffer(84 + 50 * n);
  const dv = new DataView(buf);
  const h = String(header || 'stl-reorient').slice(0, 80);
  for (let i = 0; i < h.length; i++) dv.setUint8(i, h.charCodeAt(i) & 0x7f);
  dv.setUint32(80, n, true);
  for (let t = 0, o = 84; t < n; t++, o += 50) {
    const b = 9 * t;
    const ux = tris[b + 3] - tris[b], uy = tris[b + 4] - tris[b + 1], uz = tris[b + 5] - tris[b + 2];
    const vx = tris[b + 6] - tris[b], vy = tris[b + 7] - tris[b + 1], vz = tris[b + 8] - tris[b + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true);
    dv.setFloat32(o + 4, ny / l, true);
    dv.setFloat32(o + 8, nz / l, true);
    for (let j = 0; j < 9; j++) dv.setFloat32(o + 12 + 4 * j, tris[b + j], true);
    dv.setUint16(o + 48, 0, true);
  }
  return buf;
}

/* Minimal stored (uncompressed) ZIP with one file. */
let CRC_T = null;
function crc32(u8) {
  if (!CRC_T) {
    CRC_T = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_T[i] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipOne(name, data) {
  const nm = new TextEncoder().encode(name);
  const crc = crc32(data);
  const L = 30 + nm.length, C = 46 + nm.length;
  const out = new Uint8Array(L + data.length + C + 22);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x04034b50, true);
  dv.setUint16(4, 20, true);
  dv.setUint16(12, 0x21, true); // DOS date 1980-01-01
  dv.setUint32(14, crc, true);
  dv.setUint32(18, data.length, true);
  dv.setUint32(22, data.length, true);
  dv.setUint16(26, nm.length, true);
  out.set(nm, 30);
  out.set(data, L);
  let o = L + data.length;
  const cdOff = o;
  dv.setUint32(o, 0x02014b50, true);
  dv.setUint16(o + 4, 20, true);
  dv.setUint16(o + 6, 20, true);
  dv.setUint16(o + 14, 0x21, true);
  dv.setUint32(o + 16, crc, true);
  dv.setUint32(o + 20, data.length, true);
  dv.setUint32(o + 24, data.length, true);
  dv.setUint16(o + 28, nm.length, true);
  out.set(nm, o + 46);
  o += C;
  dv.setUint32(o, 0x06054b50, true);
  dv.setUint16(o + 8, 1, true);
  dv.setUint16(o + 10, 1, true);
  dv.setUint32(o + 12, C, true);
  dv.setUint32(o + 16, cdOff, true);
  return out;
}

/* ------------------------------------------------------------------ small linear algebra */

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function mul33(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
  }
  return C;
}
const mulv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];

/* Cyclic Jacobi for symmetric 3x3 (row-major). Returns eigenpairs sorted by descending value. */
function eigSym3(m) {
  const a = m.slice(), v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const pairs = [[0, 1], [0, 2], [1, 2]];
  for (let sweep = 0; sweep < 64; sweep++) {
    const off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
    const dia = a[0] * a[0] + a[4] * a[4] + a[8] * a[8];
    if (off <= 1e-32 * dia || off < 1e-300) break;
    for (const [p, q] of pairs) {
      const apq = a[3 * p + q];
      if (Math.abs(apq) < 1e-300) continue;
      const th = (a[4 * q] - a[4 * p]) / (2 * apq);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const kp = a[3 * k + p], kq = a[3 * k + q];
        a[3 * k + p] = c * kp - s * kq; a[3 * k + q] = s * kp + c * kq;
      }
      for (let k = 0; k < 3; k++) {
        const pk = a[3 * p + k], qk = a[3 * q + k];
        a[3 * p + k] = c * pk - s * qk; a[3 * q + k] = s * pk + c * qk;
      }
      for (let k = 0; k < 3; k++) {
        const kp = v[3 * k + p], kq = v[3 * k + q];
        v[3 * k + p] = c * kp - s * kq; v[3 * k + q] = s * kp + c * kq;
      }
    }
  }
  const out = [0, 1, 2].map(i => ({ val: a[4 * i], vec: [v[i], v[3 + i], v[6 + i]] }));
  return out.sort((x, y) => y.val - x.val);
}

function solve3(H, g) {
  const [a, b, c, d, e, f, gg, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * gg), C = d * h - e * gg;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-300)) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * gg, -(a * f - c * d), C, -(a * h - b * gg), a * e - b * d];
  return [
    (inv[0] * g[0] + inv[1] * g[1] + inv[2] * g[2]) / det,
    (inv[3] * g[0] + inv[4] * g[1] + inv[5] * g[2]) / det,
    (inv[6] * g[0] + inv[7] * g[1] + inv[8] * g[2]) / det,
  ];
}

function tangentBasis(nx, ny, nz) {
  const ax = Math.abs(nx) < 0.6 ? [1, 0, 0] : Math.abs(ny) < 0.6 ? [0, 1, 0] : [0, 0, 1];
  const t1 = norm3(cross3([nx, ny, nz], ax));
  const t2 = cross3([nx, ny, nz], t1);
  return [t1[0], t1[1], t1[2], t2[0], t2[1], t2[2]];
}

/* ------------------------------------------------------------------ mesh */

/* Normalised copy: x_n = (x - c0) / L, L = bbox diagonal. Drops degenerate triangles.
   Also exact area-weighted centroid and covariance of the surface. */
function prepareMesh(tris) {
  const nt = (tris.length / 9) | 0;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < nt * 9; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (!(x1 >= x0)) throw new Error('Mesh has no finite vertices.');
  const c0 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1;
  const V = new Float32Array(nt * 9), N = new Float32Array(nt * 3), A = new Float64Array(nt), src = new Uint32Array(nt);
  let m = 0, area = 0, cx = 0, cy = 0, cz = 0;
  const S = [0, 0, 0, 0, 0, 0];
  for (let t = 0; t < nt; t++) {
    const b = 9 * t;
    const ax = (tris[b] - c0[0]) / L, ay = (tris[b + 1] - c0[1]) / L, az = (tris[b + 2] - c0[2]) / L;
    const bx = (tris[b + 3] - c0[0]) / L, by = (tris[b + 4] - c0[1]) / L, bz = (tris[b + 5] - c0[2]) / L;
    const qx = (tris[b + 6] - c0[0]) / L, qy = (tris[b + 7] - c0[1]) / L, qz = (tris[b + 8] - c0[2]) / L;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = qx - ax, vy = qy - ay, vz = qz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(l > 1e-20)) continue;
    const w = 9 * m;
    V[w] = ax; V[w + 1] = ay; V[w + 2] = az; V[w + 3] = bx; V[w + 4] = by; V[w + 5] = bz;
    V[w + 6] = qx; V[w + 7] = qy; V[w + 8] = qz;
    N[3 * m] = nx / l; N[3 * m + 1] = ny / l; N[3 * m + 2] = nz / l;
    const a = 0.5 * l;
    A[m] = a; src[m] = t; area += a;
    const sx = ax + bx + qx, sy = ay + by + qy, sz = az + bz + qz;
    cx += a * sx / 3; cy += a * sy / 3; cz += a * sz / 3;
    const k = a / 12; // ∫ x xᵀ dA over a triangle = A/12 (Σ v vᵀ + (Σv)(Σv)ᵀ)
    S[0] += k * (ax * ax + bx * bx + qx * qx + sx * sx);
    S[1] += k * (ax * ay + bx * by + qx * qy + sx * sy);
    S[2] += k * (ax * az + bx * bz + qx * qz + sx * sz);
    S[3] += k * (ay * ay + by * by + qy * qy + sy * sy);
    S[4] += k * (ay * az + by * bz + qy * qz + sy * sz);
    S[5] += k * (az * az + bz * bz + qz * qz + sz * sz);
    m++;
  }
  if (m < 4) throw new Error('Mesh has fewer than 4 non-degenerate triangles.');
  cx /= area; cy /= area; cz /= area;
  const cov = [
    S[0] / area - cx * cx, S[1] / area - cx * cy, S[2] / area - cx * cz,
    S[1] / area - cx * cy, S[3] / area - cy * cy, S[4] / area - cy * cz,
    S[2] / area - cx * cz, S[4] / area - cy * cz, S[5] / area - cz * cz,
  ];
  return {
    V: V.slice(0, 9 * m), N: N.slice(0, 3 * m), A: A.slice(0, m), src: src.slice(0, m),
    n: m, nOrig: nt, area, c0, L, centroid: [cx, cy, cz], cov,
  };
}

function rng32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Area-uniform stratified surface samples (normalised coords) with face normals. */
function sampleSurface(mesh, M, seed) {
  const rnd = rng32(seed);
  const P = new Float64Array(3 * M), Q = new Float64Array(3 * M);
  const { V, N, A, n, area } = mesh;
  let t = 0, acc = A[0];
  for (let k = 0; k < M; k++) {
    const u = ((k + rnd()) / M) * area;
    while (acc < u && t < n - 1) acc += A[++t];
    let r1 = rnd(), r2 = rnd();
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    const b = 9 * t, k3 = 3 * k, t3 = 3 * t;
    P[k3] = V[b] + r1 * (V[b + 3] - V[b]) + r2 * (V[b + 6] - V[b]);
    P[k3 + 1] = V[b + 1] + r1 * (V[b + 4] - V[b + 1]) + r2 * (V[b + 7] - V[b + 1]);
    P[k3 + 2] = V[b + 2] + r1 * (V[b + 5] - V[b + 2]) + r2 * (V[b + 8] - V[b + 2]);
    Q[k3] = N[t3]; Q[k3 + 1] = N[t3 + 1]; Q[k3 + 2] = N[t3 + 2];
  }
  return { P, N: Q, count: M };
}

/* Quickselect on an index array by coordinate `ax` of a strided array. */
function select(idx, lo, hi, k, P, stride, ax) {
  while (hi > lo) {
    const pv = P[stride * idx[(lo + hi) >> 1] + ax];
    let i = lo, j = hi;
    while (i <= j) {
      while (P[stride * idx[i] + ax] < pv) i++;
      while (P[stride * idx[j] + ax] > pv) j--;
      if (i <= j) { const t = idx[i]; idx[i] = idx[j]; idx[j] = t; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return;
  }
}

/* ------------------------------------------------------------------ KD-tree over oriented samples */

const KD_LEAF = 10;

function KDTree(S) {
  const P = S.P, Nn = S.N, count = S.count;
  const idx = new Uint32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  const axis = new Uint8Array(count);
  const st = [0, count];
  while (st.length) {
    const hi = st.pop(), lo = st.pop();
    if (hi - lo <= KD_LEAF) continue;
    let a0 = Infinity, a1 = Infinity, a2 = Infinity, b0 = -Infinity, b1 = -Infinity, b2 = -Infinity;
    for (let i = lo; i < hi; i++) {
      const j = 3 * idx[i], x = P[j], y = P[j + 1], z = P[j + 2];
      if (x < a0) a0 = x; if (x > b0) b0 = x;
      if (y < a1) a1 = y; if (y > b1) b1 = y;
      if (z < a2) a2 = z; if (z > b2) b2 = z;
    }
    const e0 = b0 - a0, e1 = b1 - a1, e2 = b2 - a2;
    const ax = e0 >= e1 && e0 >= e2 ? 0 : e1 >= e2 ? 1 : 2;
    const mid = (lo + hi) >> 1;
    select(idx, lo, hi - 1, mid, P, 3, ax);
    axis[mid] = ax;
    st.push(lo, mid, mid + 1, hi);
  }
  this.x = new Float64Array(count); this.y = new Float64Array(count); this.z = new Float64Array(count);
  this.nx = new Float64Array(count); this.ny = new Float64Array(count); this.nz = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const j = 3 * idx[i];
    this.x[i] = P[j]; this.y[i] = P[j + 1]; this.z[i] = P[j + 2];
    this.nx[i] = Nn[j]; this.ny[i] = Nn[j + 1]; this.nz[i] = Nn[j + 2];
  }
  this.axis = axis; this.count = count;
  this.cosMin = 0.5; this.unoriented = false;
  this.qx = this.qy = this.qz = this.vx = this.vy = this.vz = 0;
  this.best = 0; this.bi = -1;
}

/* Nearest sample whose normal is compatible with (vx,vy,vz); -1 if none within sqrt(maxD2). */
KDTree.prototype.nearest = function (qx, qy, qz, vx, vy, vz, maxD2) {
  this.qx = qx; this.qy = qy; this.qz = qz; this.vx = vx; this.vy = vy; this.vz = vz;
  this.best = maxD2; this.bi = -1;
  this._s(0, this.count);
  return this.bi;
};
KDTree.prototype._s = function (lo, hi) {
  if (hi - lo <= KD_LEAF) { for (let i = lo; i < hi; i++) this._t(i); return; }
  const mid = (lo + hi) >> 1, ax = this.axis[mid];
  const dd = ax === 0 ? this.qx - this.x[mid] : ax === 1 ? this.qy - this.y[mid] : this.qz - this.z[mid];
  this._t(mid);
  if (dd < 0) { this._s(lo, mid); if (dd * dd < this.best) this._s(mid + 1, hi); }
  else { this._s(mid + 1, hi); if (dd * dd < this.best) this._s(lo, mid); }
};
KDTree.prototype._t = function (i) {
  const dx = this.x[i] - this.qx, dy = this.y[i] - this.qy, dz = this.z[i] - this.qz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 < this.best) {
    const c = this.nx[i] * this.vx + this.ny[i] * this.vy + this.nz[i] * this.vz;
    if ((this.unoriented ? Math.abs(c) : c) >= this.cosMin) { this.best = d2; this.bi = i; }
  }
};

/* ------------------------------------------------------------------ BVH over triangles (exact closest point) */

const BVH_LEAF = 8;
const CP = new Float64Array(3);

/* Ericson, Real-Time Collision Detection §5.1.5. Result in CP. */
function closestPtTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { CP[0] = ax; CP[1] = ay; CP[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { CP[0] = bx; CP[1] = by; CP[2] = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    CP[0] = ax + v * abx; CP[1] = ay + v * aby; CP[2] = az + v * abz; return;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { CP[0] = cx; CP[1] = cy; CP[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    CP[0] = ax + w * acx; CP[1] = ay + w * acy; CP[2] = az + w * acz; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    CP[0] = bx + w * (cx - bx); CP[1] = by + w * (cy - by); CP[2] = bz + w * (cz - bz); return;
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  CP[0] = ax + abx * v + acx * w; CP[1] = ay + aby * v + acy * w; CP[2] = az + abz * v + acz * w;
}

/* Triangle order along a 30-bit Morton curve of the centroids: 4-pass LSD radix sort, linear time. */
function mortonOrder(C, n) {
  let a0 = Infinity, a1 = Infinity, a2 = Infinity, b0 = -Infinity, b1 = -Infinity, b2 = -Infinity;
  for (let i = 0; i < 3 * n; i += 3) {
    const x = C[i], y = C[i + 1], z = C[i + 2];
    if (x < a0) a0 = x; if (x > b0) b0 = x;
    if (y < a1) a1 = y; if (y > b1) b1 = y;
    if (z < a2) a2 = z; if (z > b2) b2 = z;
  }
  const span = Math.max(b0 - a0, b1 - a1, b2 - a2) || 1, k = 1023.999 / span;
  const spread = v => { v = (v | (v << 16)) & 0x030000ff; v = (v | (v << 8)) & 0x0300f00f; v = (v | (v << 4)) & 0x030c30c3; return (v | (v << 2)) & 0x09249249; };
  let key = new Uint32Array(n), idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    key[i] = ((spread(((C[3 * i] - a0) * k) | 0) << 2) | (spread(((C[3 * i + 1] - a1) * k) | 0) << 1) | spread(((C[3 * i + 2] - a2) * k) | 0)) >>> 0;
    idx[i] = i;
  }
  let key2 = new Uint32Array(n), idx2 = new Uint32Array(n);
  const count = new Uint32Array(256);
  for (let sh = 0; sh < 32; sh += 8) {
    count.fill(0);
    for (let i = 0; i < n; i++) count[(key[i] >>> sh) & 255]++;
    for (let i = 0, sum = 0; i < 256; i++) { const c = count[i]; count[i] = sum; sum += c; }
    for (let i = 0; i < n; i++) { const d = count[(key[i] >>> sh) & 255]++; key2[d] = key[i]; idx2[d] = idx[i]; }
    [key, key2] = [key2, key]; [idx, idx2] = [idx2, idx];
  }
  return { idx, key };
}

/* Builds over mesh triangles and permutes mesh.V/N/A/src into BVH order (saves a copy). */
function BVH(mesh) {
  const n = mesh.n, V = mesh.V;
  const C = new Float64Array(3 * n);
  for (let t = 0; t < n; t++) {
    const b = 9 * t;
    C[3 * t] = V[b] + V[b + 3] + V[b + 6];
    C[3 * t + 1] = V[b + 1] + V[b + 4] + V[b + 7];
    C[3 * t + 2] = V[b + 2] + V[b + 5] + V[b + 8];
  }
  const { idx, key } = mortonOrder(C, n);
  const cap = n + 2;
  const bmin = new Float32Array(3 * cap), bmax = new Float32Array(3 * cap);
  const left = new Int32Array(cap), start = new Uint32Array(cap), cnt = new Uint8Array(cap);
  let nn = 1;
  const st = [0, 0, n];
  const eps = 1e-6;
  while (st.length) {
    const hi = st.pop(), lo = st.pop(), nd = st.pop();
    if (hi - lo <= BVH_LEAF) { left[nd] = -1; start[nd] = lo; cnt[nd] = hi - lo; continue; }
    // Triangles are in Morton (Z-curve) order: split where the highest differing key bit flips, i.e. at a
    // spatial mid-plane (index midpoint if keys tie). Boxes are filled bottom-up below.
    let mid = (lo + hi) >> 1;
    const x = key[lo] ^ key[hi - 1];
    if (x) {
      const bit = 1 << (31 - Math.clz32(x));
      let a = lo, b = hi - 1;
      while (a < b) { const m = (a + b) >> 1; if (key[m] & bit) b = m; else a = m + 1; }
      // Keep the tree from degenerating on lopsided splits.
      if (a - lo >= (hi - lo) >> 3 && hi - a >= (hi - lo) >> 3) mid = a;
    }
    const l = nn; nn += 2;
    left[nd] = l;
    st.push(l, lo, mid, l + 1, mid, hi);
  }
  // Children are always allocated after their parent, so a reverse sweep sees children first.
  for (let nd = nn - 1; nd >= 0; nd--) {
    const b3 = 3 * nd;
    if (left[nd] < 0) {
      let a0 = Infinity, a1 = Infinity, a2 = Infinity, b0 = -Infinity, b1 = -Infinity, b2 = -Infinity;
      for (let i = start[nd], e = i + cnt[nd]; i < e; i++) {
        const b = 9 * idx[i];
        for (let k = 0; k < 9; k += 3) {
          const x = V[b + k], y = V[b + k + 1], z = V[b + k + 2];
          if (x < a0) a0 = x; if (x > b0) b0 = x;
          if (y < a1) a1 = y; if (y > b1) b1 = y;
          if (z < a2) a2 = z; if (z > b2) b2 = z;
        }
      }
      bmin[b3] = a0 - eps; bmin[b3 + 1] = a1 - eps; bmin[b3 + 2] = a2 - eps;
      bmax[b3] = b0 + eps; bmax[b3 + 1] = b1 + eps; bmax[b3 + 2] = b2 + eps;
    } else {
      const l3 = 3 * left[nd], r3 = l3 + 3;
      for (let k = 0; k < 3; k++) {
        bmin[b3 + k] = Math.min(bmin[l3 + k], bmin[r3 + k]);
        bmax[b3 + k] = Math.max(bmax[l3 + k], bmax[r3 + k]);
      }
    }
  }
  const V2 = new Float32Array(9 * n), N2 = new Float32Array(3 * n), A2 = new Float64Array(n), S2 = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const j = idx[i];
    for (let k = 0; k < 9; k++) V2[9 * i + k] = V[9 * j + k];
    N2[3 * i] = mesh.N[3 * j]; N2[3 * i + 1] = mesh.N[3 * j + 1]; N2[3 * i + 2] = mesh.N[3 * j + 2];
    A2[i] = mesh.A[j]; S2[i] = mesh.src[j];
  }
  mesh.V = V2; mesh.N = N2; mesh.A = A2; mesh.src = S2;
  this.V = V2; this.N = N2;
  this.bmin = bmin; this.bmax = bmax; this.left = left; this.start = start; this.cnt = cnt;
  this.stN = new Int32Array(256); this.stD = new Float64Array(256);
  this.cosMin = 0.5; this.unoriented = false;
  this.d2 = 0; this.t = -1; this.px = this.py = this.pz = 0;
}

BVH.prototype._bd = function (nd, qx, qy, qz) {
  const b = 3 * nd;
  let d = 0, t;
  t = this.bmin[b] - qx; if (t > 0) d += t * t; else { t = qx - this.bmax[b]; if (t > 0) d += t * t; }
  t = this.bmin[b + 1] - qy; if (t > 0) d += t * t; else { t = qy - this.bmax[b + 1]; if (t > 0) d += t * t; }
  t = this.bmin[b + 2] - qz; if (t > 0) d += t * t; else { t = qz - this.bmax[b + 2]; if (t > 0) d += t * t; }
  return d;
};

/* Closest point on any triangle with a compatible normal within sqrt(maxD2). Returns triangle or -1. */
BVH.prototype.closest = function (qx, qy, qz, vx, vy, vz, maxD2) {
  const V = this.V, N = this.N, left = this.left, stN = this.stN, stD = this.stD;
  const cosMin = this.cosMin, unor = this.unoriented;
  let best = maxD2, bt = -1, bx = 0, by = 0, bz = 0, sp = 0;
  stN[0] = 0; stD[0] = this._bd(0, qx, qy, qz); sp = 1;
  while (sp > 0) {
    sp--;
    if (stD[sp] >= best) continue;
    const nd = stN[sp], l = left[nd];
    if (l < 0) {
      for (let k = this.start[nd], e = k + this.cnt[nd]; k < e; k++) {
        const k3 = 3 * k;
        const tx = N[k3], ty = N[k3 + 1], tz = N[k3 + 2];
        const c = tx * vx + ty * vy + tz * vz;
        if ((unor ? Math.abs(c) : c) < cosMin) continue;
        const k9 = 9 * k;
        const ax = V[k9], ay = V[k9 + 1], az = V[k9 + 2];
        const pd = (qx - ax) * tx + (qy - ay) * ty + (qz - az) * tz;
        if (pd * pd >= best) continue;
        closestPtTri(qx, qy, qz, ax, ay, az, V[k9 + 3], V[k9 + 4], V[k9 + 5], V[k9 + 6], V[k9 + 7], V[k9 + 8]);
        const dx = qx - CP[0], dy = qy - CP[1], dz = qz - CP[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) { best = d2; bt = k; bx = CP[0]; by = CP[1]; bz = CP[2]; }
      }
    } else {
      const dl = this._bd(l, qx, qy, qz), dr = this._bd(l + 1, qx, qy, qz);
      if (dl <= dr) {
        if (dr < best) { stN[sp] = l + 1; stD[sp++] = dr; }
        if (dl < best) { stN[sp] = l; stD[sp++] = dl; }
      } else {
        if (dl < best) { stN[sp] = l; stD[sp++] = dl; }
        if (dr < best) { stN[sp] = l + 1; stD[sp++] = dr; }
      }
    }
  }
  this.d2 = best; this.t = bt; this.px = bx; this.py = by; this.pz = bz;
  return bt;
};

/* ------------------------------------------------------------------ symmetry search */

const TUKEY = 4.685;
const COS_MIN = 0.5;

/* Correspondence adapters. Both set r (residual along unit direction g) for the GN step. */
function kdCorr(kd) {
  const o = {
    r: 0, gx: 0, gy: 0, gz: 0,
    find(qx, qy, qz, vx, vy, vz, maxD2) {
      const i = kd.nearest(qx, qy, qz, vx, vy, vz, maxD2);
      if (i < 0) return false;
      o.gx = kd.nx[i]; o.gy = kd.ny[i]; o.gz = kd.nz[i];
      o.r = o.gx * (qx - kd.x[i]) + o.gy * (qy - kd.y[i]) + o.gz * (qz - kd.z[i]);
      return true;
    },
  };
  return o;
}

function bvhCorr(bvh) {
  const o = {
    r: 0, gx: 0, gy: 0, gz: 0,
    find(qx, qy, qz, vx, vy, vz, maxD2) {
      const t = bvh.closest(qx, qy, qz, vx, vy, vz, maxD2);
      if (t < 0) return false;
      const d = Math.sqrt(bvh.d2);
      if (d > 1e-12) { o.gx = (qx - bvh.px) / d; o.gy = (qy - bvh.py) / d; o.gz = (qz - bvh.pz) / d; }
      else { o.gx = bvh.N[3 * t]; o.gy = bvh.N[3 * t + 1]; o.gz = bvh.N[3 * t + 2]; }
      o.r = d;
      return true;
    },
  };
  return o;
}

function median(a, m) {
  if (m === 0) return 0;
  const b = Float64Array.prototype.slice.call(a, 0, m).sort();
  return m & 1 ? b[m >> 1] : 0.5 * (b[(m >> 1) - 1] + b[m >> 1]);
}

/* Robust Gauss-Newton on the reflection plane n·x = d (3 DOF: two tangent tilts + offset).
   Residual per sample: distance from its mirror image to the surface. Tukey IRLS weights with an
   annealed scale, so a small feature that alone fixes a DOF (e.g. clamp head on a round tube) is not
   rejected before it has pulled the plane into place. */
function refinePlane(n0, d0, src, corr, o) {
  let nx = n0[0], ny = n0[1], nz = n0[2], d = d0;
  const K = src.count, P = src.P, NN = src.N;
  const R = new Float64Array(K), J = new Float64Array(3 * K), ok = new Uint8Array(K), ab = new Float64Array(K);
  let sched = o.sigma0, sigma = o.sigma0, it = 0;
  for (; it < o.iters; it++) {
    let B = tangentBasis(nx, ny, nz);
    if (o.lock) { // only rotation about the locked normal: t1 = lock × n
      const t1 = norm3(cross3(o.lock, [nx, ny, nz])), t2 = cross3([nx, ny, nz], t1);
      B = [t1[0], t1[1], t1[2], t2[0], t2[1], t2[2]];
    }
    const t1x = B[0], t1y = B[1], t1z = B[2], t2x = B[3], t2y = B[4], t2z = B[5];
    const maxD = Math.min(Math.max(1.5 * TUKEY * Math.max(sigma, sched), o.minSearch), o.maxSearch || Infinity);
    const maxD2 = maxD * maxD;
    let m = 0;
    for (let i = 0; i < K; i++) {
      const i3 = 3 * i;
      const px = P[i3], py = P[i3 + 1], pz = P[i3 + 2];
      const s = nx * px + ny * py + nz * pz - d;
      const ux = NN[i3], uy = NN[i3 + 1], uz = NN[i3 + 2];
      const un = 2 * (ux * nx + uy * ny + uz * nz);
      if (!corr.find(px - 2 * s * nx, py - 2 * s * ny, pz - 2 * s * nz, ux - un * nx, uy - un * ny, uz - un * nz, maxD2)) {
        ok[i] = 0; ab[m++] = maxD; continue;
      }
      ok[i] = 1;
      const gx = corr.gx, gy = corr.gy, gz = corr.gz;
      const gn = gx * nx + gy * ny + gz * nz;
      J[i3] = -2 * ((t1x * px + t1y * py + t1z * pz) * gn + s * (gx * t1x + gy * t1y + gz * t1z));
      J[i3 + 1] = -2 * ((t2x * px + t2y * py + t2z * pz) * gn + s * (gx * t2x + gy * t2y + gz * t2z));
      J[i3 + 2] = 2 * gn;
      R[i] = corr.r;
      ab[m++] = Math.abs(corr.r);
    }
    sigma = Math.max(1.4826 * median(ab, m), o.sigmaMin);
    const c = TUKEY * Math.max(sigma, sched);
    let h00 = 0, h01 = 0, h02 = 0, h11 = 0, h12 = 0, h22 = 0, g0 = 0, g1 = 0, g2 = 0, ws = 0;
    for (let i = 0; i < K; i++) {
      if (!ok[i]) continue;
      const u = R[i] / c;
      if (u >= 1 || u <= -1) continue;
      const w = (1 - u * u) * (1 - u * u);
      const a = J[3 * i], b = J[3 * i + 1], e = J[3 * i + 2], r = R[i];
      h00 += w * a * a; h01 += w * a * b; h02 += w * a * e;
      h11 += w * b * b; h12 += w * b * e; h22 += w * e * e;
      g0 += w * a * r; g1 += w * b * r; g2 += w * e * r;
      ws += w;
    }
    if (ws < 8) break;
    if (o.lock) { h01 = h12 = 0; h11 = 1; g1 = 0; }
    const lam = 1e-9 * (h00 + h11 + h22) + 1e-30;
    const x = solve3([h00 + lam, h01, h02, h01, h11 + lam, h12, h02, h12, h22 + lam], [-g0, -g1, -g2]);
    if (!x) break;
    let da = x[0], db = x[1], dd = x[2];
    const ang = Math.hypot(da, db);
    if (ang > 0.2) { da *= 0.2 / ang; db *= 0.2 / ang; }
    if (Math.abs(dd) > 0.05) dd = 0.05 * Math.sign(dd);
    let n1 = [nx + da * t1x + db * t2x, ny + da * t1y + db * t2y, nz + da * t1z + db * t2z];
    if (o.lock) { const k = dot3(n1, o.lock); n1 = [n1[0] - k * o.lock[0], n1[1] - k * o.lock[1], n1[2] - k * o.lock[2]]; }
    n1 = norm3(n1);
    nx = n1[0]; ny = n1[1]; nz = n1[2]; d += dd;
    sched *= o.gamma;
    if (sched <= sigma && Math.hypot(da, db) < o.tolA && Math.abs(dd) < o.tolD) { it++; break; }
  }
  return { n: [nx, ny, nz], d, sigma, iters: it };
}

function reflectQuery(n, d, P, NN, i, out) {
  const i3 = 3 * i;
  const px = P[i3], py = P[i3 + 1], pz = P[i3 + 2];
  const s = 2 * (n[0] * px + n[1] * py + n[2] * pz - d);
  const ux = NN[i3], uy = NN[i3 + 1], uz = NN[i3 + 2];
  const un = 2 * (n[0] * ux + n[1] * uy + n[2] * uz);
  out[0] = px - s * n[0]; out[1] = py - s * n[1]; out[2] = pz - s * n[2];
  out[3] = ux - un * n[0]; out[4] = uy - un * n[1]; out[5] = uz - un * n[2];
}

/* Mean mirror distance truncated at tau, against the sample KD-tree (includes sampling noise). */
function scoreKD(n, d, src, kd, tau) {
  const q = new Float64Array(6), tau2 = tau * tau;
  let sum = 0;
  for (let i = 0; i < src.count; i++) {
    reflectQuery(n, d, src.P, src.N, i, q);
    const j = kd.nearest(q[0], q[1], q[2], q[3], q[4], q[5], tau2);
    sum += j < 0 ? tau : Math.sqrt(kd.best);
  }
  return sum / src.count;
}

/* Exact mirror distances (normalised units) of src samples to the mesh surface. */
function mirrorDistances(n, d, src, bvh, cap) {
  const q = new Float64Array(6), out = new Float64Array(src.count), cap2 = cap * cap;
  for (let i = 0; i < src.count; i++) {
    reflectQuery(n, d, src.P, src.N, i, q);
    out[i] = bvh.closest(q[0], q[1], q[2], q[3], q[4], q[5], cap2) < 0 ? cap : Math.sqrt(bvh.d2);
  }
  return out;
}

function fibHemisphere(N) {
  const out = new Float64Array(3 * N), ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const z = 1 - (i + 0.5) / N, r = Math.sqrt(1 - z * z), ph = i * ga;
    out[3 * i] = r * Math.cos(ph); out[3 * i + 1] = r * Math.sin(ph); out[3 * i + 2] = z;
  }
  return out;
}

function samePlane(a, b, angTol, offTol) {
  const c = dot3(a.n, b.n), s = c < 0 ? -1 : 1;
  return Math.abs(c) >= Math.cos(angTol) && Math.abs(a.d - s * b.d) <= offTol;
}

const DEF = {
  nDir: 1200,        // coarse normals on the hemisphere (≈4° spacing)
  nCoarse: 400,      // samples per coarse score
  nKD: 40000,        // KD-tree samples (refinement)
  nKDc: 10000,       // KD-tree samples (coarse sweep; smaller tree = cheaper far-off queries)
  n1: 1500, n2: 4000, nEval: 12000,
  evalCap: 0.04,     // mirror distances are searched only this far (fraction of diagonal); beyond = capped
  seeds: 8, keep: 3,
  tauCoarse: 0.05,   // truncation, fraction of bbox diagonal
  tauScore: 0.01,
  matchTolAbs: 1,    // "mirrors within" tolerance, file units (mm)
  matchRel: 0.001,   // scale-free tolerance (fraction of diagonal) for the winding fallback test
};

async function searchPlanes(ctx, unoriented) {
  const { mesh, kd, kdc, bvh, S, opt, tick, progress } = ctx;
  kd.unoriented = kdc.unoriented = bvh.unoriented = unoriented;
  kd.cosMin = kdc.cosMin = bvh.cosMin = COS_MIN;
  const c = mesh.centroid;

  // 1. Coarse sweep: planes through the surface centroid, normals on a Fibonacci hemisphere + PCA axes.
  const nd = opt.nDir;
  const pca = eigSym3(mesh.cov).map(e => norm3(e.vec));
  const dirs = new Float64Array(3 * (nd + 3));
  dirs.set(fibHemisphere(nd));
  pca.forEach((v, k) => dirs.set(v, 3 * (nd + k)));
  const scores = new Float64Array(nd + 3);
  for (let k = 0; k < nd + 3; k++) {
    const n = [dirs[3 * k], dirs[3 * k + 1], dirs[3 * k + 2]];
    scores[k] = scoreKD(n, dot3(n, c), S.coarse, kdc, opt.tauCoarse);
    if ((k & 31) === 31) { progress('Scanning plane orientations', k / (nd + 3)); await tick(); }
  }

  // 2. Local minima on the sphere (antipodes identified) → seeds.
  const rad = 2 * Math.sqrt((2 * Math.PI) / nd), cr = Math.cos(rad);
  const minima = [];
  for (let i = 0; i < nd; i++) {
    let isMin = true;
    for (let j = 0; j < nd && isMin; j++) {
      if (j === i) continue;
      const dp = Math.abs(dirs[3 * i] * dirs[3 * j] + dirs[3 * i + 1] * dirs[3 * j + 1] + dirs[3 * i + 2] * dirs[3 * j + 2]);
      if (dp >= cr && (scores[j] < scores[i] || (scores[j] === scores[i] && j < i))) isMin = false;
    }
    if (isMin) minima.push(i);
  }
  minima.sort((a, b) => scores[a] - scores[b]);
  const seedIdx = minima.slice(0, opt.seeds).concat([nd, nd + 1, nd + 2]);
  const seeds = [];
  for (const k of seedIdx) {
    const s = { n: [dirs[3 * k], dirs[3 * k + 1], dirs[3 * k + 2]], d: 0 };
    s.d = dot3(s.n, c);
    if (!seeds.some(o => samePlane(o, s, 0.05, Infinity))) seeds.push(s);
  }

  // 3. Tier 1: robust ICP against the sample KD-tree (point-to-plane).
  const kc = kdCorr(kd);
  let t1 = [];
  for (let i = 0; i < seeds.length; i++) {
    progress('Refining candidates', i / seeds.length); await tick();
    const r = refinePlane(seeds[i].n, seeds[i].d, S.s1, kc,
      { sigma0: 0.02, gamma: 0.65, iters: 25, sigmaMin: 2e-5, minSearch: 2e-3, tolA: 1e-6, tolD: 1e-7 });
    r.score = scoreKD(r.n, r.d, S.s1, kd, opt.tauScore);
    t1.push(r);
  }
  t1.sort((a, b) => a.score - b.score);
  const uniq1 = [];
  for (const r of t1) if (!uniq1.some(o => samePlane(o, r, 0.02, 0.003))) uniq1.push(r);

  // 4. Tier 2: robust ICP against the exact mesh surface (BVH closest point), then full evaluation.
  const out = [];
  const top = uniq1.slice(0, opt.keep);
  for (let i = 0; i < top.length; i++) {
    progress('Polishing on exact surface', i / top.length); await tick();
    out.push(polish(top[i], ctx, unoriented, null, i > 0));
  }
  return dedupeSorted(out);
}

function dedupeSorted(out) {
  out.sort((a, b) => a.score - b.score);
  const uniq = [];
  for (const r of out) if (!uniq.some(o => samePlane({ n: o.nN, d: o.dN }, { n: r.nN, d: r.dN }, 2e-3, 2e-4))) uniq.push(r);
  return uniq;
}

/* Tier 2: robust ICP against the exact surface (BVH closest point), then full evaluation. */
/* quick: alternates that are only offered to the user get fewer samples, steps and a tighter search cap. */
function polish(seed, ctx, unoriented, lock, quick) {
  const { bvh, S, opt } = ctx;
  const cap = quick ? opt.evalCap / 2 : opt.evalCap;
  const r = refinePlane(seed.n, seed.d, quick ? S.s2q : S.s2, bvhCorr(bvh),
    { sigma0: Math.max(4 * seed.sigma, 2e-4), gamma: 0.5, iters: quick ? 8 : 40, sigmaMin: 1e-7, minSearch: 1e-4, maxSearch: cap, tolA: 1e-8, tolD: 1e-9, lock });
  const dist = mirrorDistances(r.n, r.d, quick ? S.evalq : S.eval, bvh, cap);
  let sum = 0, sq = 0, mx = 0, inTol = 0, inRel = 0;
  for (let k = 0; k < dist.length; k++) {
    const v = dist[k];
    sum += Math.min(v, opt.tauScore); sq += v * v; if (v > mx) mx = v;
    if (v <= opt.matchTol) inTol++;
    if (v <= opt.matchRel) inRel++;
  }
  const sorted = dist.slice().sort();
  return {
    nN: r.n, dN: r.d, score: sum / dist.length, match: inTol / dist.length, matchRel: inRel / dist.length,
    median: sorted[sorted.length >> 1], p95: sorted[Math.floor(0.95 * (sorted.length - 1))],
    rms: Math.sqrt(sq / dist.length), max: mx, capped: mx >= cap, iters: r.iters, unoriented,
  };
}

function toOriginal(cd, mesh, opt) {
  const L = mesh.L;
  cd.n = cd.nN.slice();
  cd.d = L * cd.dN + dot3(cd.n, mesh.c0);
  for (const k of ['score', 'median', 'p95', 'rms', 'max']) cd[k] *= L;
  cd.tol = opt.matchTol * L;
  return cd;
}

/* Best mirror plane perpendicular to c1 (its normal is locked ⊥ c1.n): 1-D sweep of the
   rotation about c1's normal, then the same robust ICP with that constraint. */
async function secondPlane(an, c1, options) {
  // c1: a candidate (locks to its normal) or { nN, unoriented } for any direction (normalised coords = same direction)
  const o = options || {};
  const tick = o.tick || (() => undefined), progress = o.progress || (() => {});
  const ctx = an.ctx, { mesh, kd, kdc, bvh, S, opt } = ctx;
  kd.unoriented = kdc.unoriented = bvh.unoriented = c1.unoriented;
  const lock = c1.nN, c = mesh.centroid;
  const B = tangentBasis(lock[0], lock[1], lock[2]);
  const nA = 360, sc = new Float64Array(nA), dirs = [];
  for (let k = 0; k < nA; k++) {
    const th = (Math.PI * k) / nA, ct = Math.cos(th), st = Math.sin(th);
    const n = [ct * B[0] + st * B[3], ct * B[1] + st * B[4], ct * B[2] + st * B[5]];
    dirs.push(n);
    sc[k] = scoreKD(n, dot3(n, c), S.coarse, kdc, opt.tauCoarse);
    if ((k & 31) === 31) { progress('Scanning perpendicular planes', k / nA); await tick(); }
  }
  const minima = [];
  for (let k = 0; k < nA; k++) {
    let m = true;
    for (let j = 1; j <= 4 && m; j++) if (sc[(k + j) % nA] < sc[k] || sc[(k - j + nA) % nA] < sc[k]) m = false;
    if (m) minima.push(k);
  }
  minima.sort((a, b) => sc[a] - sc[b]);
  const kc = kdCorr(kd), t1 = [];
  for (const k of minima.slice(0, 4)) {
    const r = refinePlane(dirs[k], dot3(dirs[k], c), S.s1, kc,
      { sigma0: 0.02, gamma: 0.65, iters: 25, sigmaMin: 2e-5, minSearch: 2e-3, tolA: 1e-6, tolD: 1e-7, lock });
    r.score = scoreKD(r.n, r.d, S.s1, kd, opt.tauScore);
    t1.push(r);
  }
  t1.sort((a, b) => a.score - b.score);
  const out = [];
  for (let i = 0; i < Math.min(2, t1.length); i++) {
    progress('Polishing perpendicular plane', i / 2); await tick();
    out.push(polish(t1[i], ctx, c1.unoriented, lock, i > 0));
  }
  return dedupeSorted(out).map(cd => toOriginal(cd, mesh, opt));
}

/* Full pipeline. tris: Float32Array (9 per triangle, original units). */
async function analyse(tris, options) {
  const o = options || {};
  const opt = Object.assign({}, DEF, o.opt || {});
  const tick = o.tick || (() => undefined);
  const progress = o.progress || (() => {});
  const t0 = Date.now();
  progress('Preparing mesh', 0); await tick();
  const mesh = prepareMesh(tris);
  opt.matchTol = opt.matchTolAbs / mesh.L;
  const bvh = new BVH(mesh);
  await tick();
  const S = {
    coarse: sampleSurface(mesh, opt.nCoarse, 11),
    s1: sampleSurface(mesh, opt.n1, 12),
    s2: sampleSurface(mesh, opt.n2, 13),
    eval: sampleSurface(mesh, opt.nEval, 14),
    s2q: sampleSurface(mesh, 1500, 16),
    evalq: sampleSurface(mesh, 4000, 17),
  };
  const kd = new KDTree(sampleSurface(mesh, opt.nKD, 10));
  const kdc = new KDTree(sampleSurface(mesh, opt.nKDc, 15));
  const ctx = { mesh, kd, kdc, bvh, S, opt, tick, progress };
  let cands = await searchPlanes(ctx, false);
  // Mixed triangle winding breaks the oriented-normal test; retry unoriented if the match is poor.
  // Mixed triangle winding breaks the oriented-normal test. Cheap check on the found planes first;
  // only if ignoring orientation clearly helps, re-polish those same planes unoriented.
  if (cands.length && cands[0].matchRel < 0.9) {
    const top = cands[0], sOri = scoreKD(top.nN, top.dN, S.s1, kd, opt.tauScore);
    kd.unoriented = true;
    const sUn = scoreKD(top.nN, top.dN, S.s1, kd, opt.tauScore);
    kd.unoriented = false;
    if (sUn < 0.8 * sOri) {
      bvh.unoriented = true;
      const alt = [];
      for (let i = 0; i < cands.length; i++) {
        progress('Re-checking with mixed triangle winding', i / cands.length); await tick();
        alt.push(polish({ n: cands[i].nN, d: cands[i].dN, sigma: 1e-4 }, ctx, true, null, i > 0));
      }
      const u = dedupeSorted(alt);
      if (u.length && u[0].score < cands[0].score) cands = u;
    }
  } else if (!cands.length) cands = await searchPlanes(ctx, true);
  for (const cd of cands) toOriginal(cd, mesh, opt);
  bvh.unoriented = kd.unoriented = kdc.unoriented = cands.length ? cands[0].unoriented : false;
  return { tris, mesh, bvh, ctx, candidates: cands, ms: Date.now() - t0 };
}

/* ------------------------------------------------------------------ reorientation */

const RX_M90 = [1, 0, 0, 0, 0, 1, 0, -1, 0];   // maps +Z → +Y
const RZ_180 = [-1, 0, 0, 0, -1, 0, 0, 0, 1];

/* In-plane "up": the long axis of the surface (PCA) snapped to the nearer principal direction of the
   area-weighted face normals projected into the plane. PCA alone is tilted by off-centre mass (a seat
   post's head tilts it ~0.5°); the normal tensor is not, so tubes, flats and extrusions come out square. */
function inPlaneAxis(mesh, n) {
  const P = [1 - n[0] * n[0], -n[0] * n[1], -n[0] * n[2], -n[1] * n[0], 1 - n[1] * n[1], -n[1] * n[2], -n[2] * n[0], -n[2] * n[1], 1 - n[2] * n[2]];
  let u = eigSym3(mul33(P, mul33(mesh.cov, P)))[0].vec;
  const un = dot3(u, n);
  u = norm3([u[0] - un * n[0], u[1] - un * n[1], u[2] - un * n[2]]);
  const v = cross3(n, u), N = mesh.N, A = mesh.A;
  let a11 = 0, a12 = 0, a22 = 0;
  for (let t = 0; t < mesh.n; t++) {
    const x = N[3 * t], y = N[3 * t + 1], z = N[3 * t + 2];
    const p = u[0] * x + u[1] * y + u[2] * z, q = v[0] * x + v[1] * y + v[2] * z;
    a11 += A[t] * p * p; a12 += A[t] * p * q; a22 += A[t] * q * q;
  }
  if (Math.hypot(a11 - a22, 2 * a12) < 0.05 * (a11 + a22)) return u; // isotropic normals: nothing to snap to
  const th = 0.5 * Math.atan2(2 * a12, a11 - a22), c = Math.cos(th), s = Math.sin(th);
  const w = Math.abs(c) >= Math.abs(s) ? [c, s] : [-s, c];
  const sg = w[0] < 0 ? -1 : 1;
  return norm3([0, 1, 2].map(k => sg * (w[0] * u[k] + w[1] * v[k])));
}

/* Long axis of the part: principal axis of the surface; with n, inside the plane ⊥ n (snapped to face normals). */
function longAxis(mesh, n) {
  return n ? inPlaneAxis(mesh, n) : norm3(eigSym3(mesh.cov)[0].vec);
}

/* Generic two-step orientation. spec.p / spec.s = { dir, axis (0 X, 1 Y, 2 Z), pin: {n, d} | null }.
   Step 1 maps p.dir exactly onto its axis; step 2 maps s.dir, projected ⊥ p.dir, onto its axis (resid = the
   angle that projection removed). A pin is a plane n·x = d whose axis coordinate becomes 0; other axes follow
   spec.origin ('bbox' | 'min' | 'centroid'). Rotation only (det +1): nothing is mirrored. */
function orient(an, spec) {
  const mesh = an.mesh, tris = an.tris, P = spec.p, Sx = spec.s;
  const d1 = norm3(P.dir);
  const k = dot3(Sx.dir, d1);
  const raw = [Sx.dir[0] - k * d1[0], Sx.dir[1] - k * d1[1], Sx.dir[2] - k * d1[2]];
  if (Math.hypot(raw[0], raw[1], raw[2]) < 1e-6) throw new Error('Step 2 direction is parallel to step 1.');
  const d2 = norm3(raw), resid = (Math.asin(Math.min(1, Math.abs(k) / Math.hypot(...Sx.dir))) * 180) / Math.PI;
  const a1 = P.axis, a2 = Sx.axis, a3 = 3 - a1 - a2, rows = [];
  rows[a1] = d1; rows[a2] = d2; rows[a3] = cross3(rows[(a3 + 1) % 3], rows[(a3 + 2) % 3]);
  const R = [...rows[0], ...rows[1], ...rows[2]];
  const cO = [0, 1, 2].map(i => mesh.c0[i] + mesh.L * mesh.centroid[i]);
  let p0 = cO.slice();
  const pinned = [false, false, false];
  if (P.pin) { const e = dot3(P.pin.n, p0) - P.pin.d, m = dot3(P.pin.n, d1); p0 = p0.map((x, i) => x - (e / m) * d1[i]); pinned[a1] = true; }
  if (Sx.pin) {
    const m = dot3(Sx.pin.n, d2);
    if (Math.abs(m) > 1e-6) { const e = dot3(Sx.pin.n, p0) - Sx.pin.d; p0 = p0.map((x, i) => x - (e / m) * d2[i]); pinned[a2] = true; }
  }
  const b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i] - p0[0], y = tris[i + 1] - p0[1], z = tris[i + 2] - p0[2];
    for (let r = 0; r < 3; r++) {
      const w = R[3 * r] * x + R[3 * r + 1] * y + R[3 * r + 2] * z;
      if (w < b[2 * r]) b[2 * r] = w; if (w > b[2 * r + 1]) b[2 * r + 1] = w;
    }
  }
  const cw = mulv(R, [cO[0] - p0[0], cO[1] - p0[1], cO[2] - p0[2]]);
  const o = [0, 1, 2].map(r => pinned[r] ? 0 : spec.origin === 'min' ? b[2 * r] : spec.origin === 'centroid' ? cw[r] : 0.5 * (b[2 * r] + b[2 * r + 1]));
  const Rp = mulv(R, p0), t = [-Rp[0] - o[0], -Rp[1] - o[1], -Rp[2] - o[2]];
  return {
    R, t, resid, pinned,
    M: [R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2], 0, 0, 0, 1],
    ext: [0, 1, 2].map(r => [b[2 * r] - o[r], b[2 * r + 1] - o[r]]),
  };
}

/* Rigid transform (rotation, det +1, no mirroring) that puts the plane on YZ (x = 0).
   In-plane axis (see inPlaneAxis) → +Z with more surface toward +Z; X sign closest to the input frame.
   opt: { rx: quarter turns about X (each Z→Y), fz: 180° about Z, origin: 'bbox' | 'min' | 'centroid' } */
function frame(an, cand, opt) {
  opt = opt || {};
  const mesh = an.mesh, tris = an.tris, n = cand.n, d = cand.d;
  const n2 = opt.second ? opt.second.n : null;
  let u;
  if (n2) u = norm3(cross3(n, n2));
  else if (opt.up) { const k = dot3(opt.up, n); u = norm3([opt.up[0] - k * n[0], opt.up[1] - k * n[1], opt.up[2] - k * n[2]]); }
  else u = cand.axis || (cand.axis = inPlaneAxis(mesh, n));
  const cO = [mesh.c0[0] + mesh.L * mesh.centroid[0], mesh.c0[1] + mesh.L * mesh.centroid[1], mesh.c0[2] + mesh.L * mesh.centroid[2]];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const s = u[0] * tris[i] + u[1] * tris[i + 1] + u[2] * tris[i + 2];
    if (s < lo) lo = s; if (s > hi) hi = s;
  }
  if (!opt.up && dot3(u, cO) < 0.5 * (lo + hi)) u = [-u[0], -u[1], -u[2]]; // a picked direction keeps its sign
  let R = null, best = -Infinity;
  for (const sg of [1, -1]) {
    const X = [sg * n[0], sg * n[1], sg * n[2]], Z = u, Y = cross3(Z, X);
    const tr = X[0] + Y[1] + Z[2];
    if (tr > best) { best = tr; R = [X[0], X[1], X[2], Y[0], Y[1], Y[2], Z[0], Z[1], Z[2]]; }
  }
  if (opt.fz) R = mul33(RZ_180, R);
  for (let k = 0; k < ((opt.rx || 0) & 3); k++) R = mul33(RX_M90, R);
  const off = dot3(n, cO) - d;
  const p0 = [cO[0] - off * n[0], cO[1] - off * n[1], cO[2] - off * n[2]];
  if (n2) { // n2 ⊥ n, so this stays on plane 1
    const o2 = dot3(n2, p0) - opt.second.d;
    for (let k = 0; k < 3; k++) p0[k] -= o2 * n2[k];
  }
  const b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i] - p0[0], y = tris[i + 1] - p0[1], z = tris[i + 2] - p0[2];
    const wx = R[0] * x + R[1] * y + R[2] * z, wy = R[3] * x + R[4] * y + R[5] * z, wz = R[6] * x + R[7] * y + R[8] * z;
    if (wx < b[0]) b[0] = wx; if (wx > b[1]) b[1] = wx;
    if (wy < b[2]) b[2] = wy; if (wy > b[3]) b[3] = wy;
    if (wz < b[4]) b[4] = wz; if (wz > b[5]) b[5] = wz;
  }
  const cw = mulv(R, [cO[0] - p0[0], cO[1] - p0[1], cO[2] - p0[2]]);
  let oy = 0.5 * (b[2] + b[3]), oz = 0.5 * (b[4] + b[5]);
  if (opt.origin === 'min') { oy = b[2]; oz = b[4]; }
  else if (opt.origin === 'centroid') { oy = cw[1]; oz = cw[2]; }
  let plane2 = null;
  if (n2) { // the axis plane 2's normal lands on is pinned to 0
    const m = mulv(R, n2);
    if (Math.abs(m[1]) > 0.5) { oy = 0; plane2 = 'XZ'; } else { oz = 0; plane2 = 'XY'; }
  }
  const Rp = mulv(R, p0);
  const t = [-Rp[0], -Rp[1] - oy, -Rp[2] - oz];
  return {
    R, t,
    M: [R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2], 0, 0, 0, 1],
    ext: [[b[0], b[1]], [b[2] - oy, b[3] - oy], [b[4] - oz, b[5] - oz]],
    plane2,
  };
}

function transform(tris, M) {
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    out[i] = M[0] * x + M[1] * y + M[2] * z + M[3];
    out[i + 1] = M[4] * x + M[5] * y + M[6] * z + M[7];
    out[i + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
  }
  return out;
}

/* Per original triangle: distance (original units) from its mirrored centroid to the surface. */
async function deviationMap(an, cand, options) {
  const o = options || {};
  const tick = o.tick || (() => undefined), progress = o.progress || (() => {});
  const { mesh, bvh } = an, V = mesh.V, N = mesh.N, L = mesh.L;
  const out = new Float32Array(mesh.nOrig);
  const n = cand.nN, d = cand.dN, cap = an.ctx.opt.evalCap, cap2 = cap * cap;
  for (let t = 0; t < mesh.n; t++) {
    const b = 9 * t;
    const px = (V[b] + V[b + 3] + V[b + 6]) / 3, py = (V[b + 1] + V[b + 4] + V[b + 7]) / 3, pz = (V[b + 2] + V[b + 5] + V[b + 8]) / 3;
    const s = 2 * (n[0] * px + n[1] * py + n[2] * pz - d);
    const ux = N[3 * t], uy = N[3 * t + 1], uz = N[3 * t + 2];
    const un = 2 * (n[0] * ux + n[1] * uy + n[2] * uz);
    const hit = bvh.closest(px - s * n[0], py - s * n[1], pz - s * n[2], ux - un * n[0], uy - un * n[1], uz - un * n[2], cap2);
    out[mesh.src[t]] = (hit < 0 ? cap : Math.sqrt(bvh.d2)) * L;
    if ((t & 8191) === 8191) { progress('Deviation map', t / mesh.n); await tick(); }
  }
  return out;
}

/* Direction of the surface feature under a picked point (original coords p, face normal nrm).
   Flat patch → its normal. Otherwise, if the local normals all lie in a plane (cylinder, cone, extrusion)
   → the axis they are perpendicular to. Uses triangles within rFrac·diagonal of the point. */
function pickFeature(an, p, nrm, rFrac) {
  const m = an.mesh, L = m.L, V = m.V, N = m.N, A = m.A;
  const q = [(p[0] - m.c0[0]) / L, (p[1] - m.c0[1]) / L, (p[2] - m.c0[2]) / L], r = rFrac || 0.03, r2 = r * r;
  const T = [0, 0, 0, 0, 0, 0, 0, 0, 0], sum = [0, 0, 0];
  let aAll = 0, aFlat = 0, count = 0;
  for (let t = 0; t < m.n; t++) {
    const b = 9 * t;
    const dx = (V[b] + V[b + 3] + V[b + 6]) / 3 - q[0], dy = (V[b + 1] + V[b + 4] + V[b + 7]) / 3 - q[1], dz = (V[b + 2] + V[b + 5] + V[b + 8]) / 3 - q[2];
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    const x = N[3 * t], y = N[3 * t + 1], z = N[3 * t + 2], c = x * nrm[0] + y * nrm[1] + z * nrm[2];
    if (Math.abs(c) < 0.2) continue; // other side of an edge, not the clicked patch
    const a = A[t], sg = c < 0 ? -1 : 1;
    aAll += a; count++;
    if (Math.abs(c) > 0.97) { aFlat += a; sum[0] += sg * a * x; sum[1] += sg * a * y; sum[2] += sg * a * z; }
    T[0] += a * x * x; T[1] += a * x * y; T[2] += a * x * z; T[4] += a * y * y; T[5] += a * y * z; T[8] += a * z * z;
  }
  if (!count) return { kind: 'none', count };
  if (aFlat > 0.85 * aAll) return { kind: 'flat', dir: norm3(sum), count };
  T[3] = T[1]; T[6] = T[2]; T[7] = T[5];
  const e = eigSym3(T), tr = e[0].val + e[1].val + e[2].val;
  if (e[2].val < 0.08 * tr) return { kind: 'round', dir: norm3(e[2].vec), count };
  return { kind: 'none', count };
}

/* Extrusion / sweep / revolve axis inside the mirror plane: the in-plane direction that the most side-wall
   area is perpendicular to (a tube's wall normals all point radially, never along its axis).
   Each triangle votes, with weight area × (in-plane part of its normal)², for the direction ⊥ its normal;
   peaks of the smoothed 0.25° histogram are refined by least squares on the triangles near each peak. */
function extrusionAxes(mesh, n) {
  if (!n) return extrusionAxes3D(mesh);
  const B = tangentBasis(n[0], n[1], n[2]), u = [B[0], B[1], B[2]], v = [B[3], B[4], B[5]];
  const N = mesh.N, A = mesh.A, NB = 720, H = new Float64Array(NB), P = new Float32Array(mesh.n), Q = new Float32Array(mesh.n);
  let tot = 0;
  for (let t = 0; t < mesh.n; t++) {
    const x = N[3 * t], y = N[3 * t + 1], z = N[3 * t + 2];
    const p = x * u[0] + y * u[1] + z * u[2], q = x * v[0] + y * v[1] + z * v[2];
    P[t] = p; Q[t] = q;
    const w = A[t] * (p * p + q * q);
    tot += w;
    let th = Math.atan2(-p, q);
    if (th < 0) th += Math.PI;
    H[Math.min(NB - 1, Math.floor((th / Math.PI) * NB))] += w;
  }
  const G = [], sig = 4;
  for (let k = -12; k <= 12; k++) G.push(Math.exp((-k * k) / (2 * sig * sig)));
  const sm = new Float64Array(NB);
  for (let i = 0; i < NB; i++) { let s2 = 0; for (let k = -12; k <= 12; k++) s2 += H[(i + k + NB) % NB] * G[k + 12]; sm[i] = s2; }
  const peaks = [];
  for (let i = 0; i < NB; i++) {
    let m = sm[i] > 0;
    for (let k = 1; k <= 16 && m; k++) if (sm[(i + k) % NB] > sm[i] || sm[(i - k + NB) % NB] > sm[i]) m = false;
    if (m) peaks.push(i);
  }
  peaks.sort((a, b) => sm[b] - sm[a]);
  const out = [];
  for (const i of peaks.slice(0, 3)) {
    let th = ((i + 0.5) / NB) * Math.PI, share = 0;
    for (let it = 0; it < 3; it++) { // least squares on the walls within ±3° of the current direction
      const c = Math.cos(th), sn = Math.sin(th), lim = Math.sin((3 * Math.PI) / 180);
      let a11 = 0, a12 = 0, a22 = 0, w3 = 0;
      for (let t = 0; t < mesh.n; t++) {
        const p = P[t], q = Q[t], r2 = p * p + q * q;
        if (r2 < 1e-6 || Math.abs(c * p + sn * q) > lim * Math.sqrt(r2)) continue;
        a11 += A[t] * p * p; a12 += A[t] * p * q; a22 += A[t] * q * q; w3 += A[t] * r2;
      }
      if (!w3) break;
      share = w3 / tot;
      // direction minimising Σ A (a·n)²: eigenvector of the smaller eigenvalue of [[a11,a12],[a12,a22]]
      const phi = 0.5 * Math.atan2(2 * a12, a11 - a22) + Math.PI / 2;
      th = phi;
    }
    const c = Math.cos(th), sn = Math.sin(th);
    const d = norm3([c * u[0] + sn * v[0], c * u[1] + sn * v[1], c * u[2] + sn * v[2]]);
    if (out.some(o => Math.abs(dot3(o.dir, d)) > Math.cos((5 * Math.PI) / 180))) continue;
    out.push({ dir: d, share });
  }
  out.sort((a, b) => b.share - a.share); // refined share, not raw histogram height
  return out.filter(o => o.share >= 0.4 * (out[0] ? out[0].share : 0));
}

/* Large flat regions whose normal lies (nearly) in the mirror plane, so they can be turned onto ±Z without
   breaking YZ. Triangles are grouped by in-plane normal angle (0.25° histogram, sign folded so mixed winding
   does not split a face), then by plane offset; each group is refit as a plane (area-weighted PCA of its
   triangles) and kept if it is genuinely flat. Returns up to 6 planes, largest first, with the outward normal. */
/* Largest connected piece of a triangle set: triangles sharing a vertex (STL facets of one face do) are joined. */
function largestPiece(sel, V, A) {
  const owner = new Map(), parent = sel.map((_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  sel.forEach((t, i) => {
    const b = 9 * t;
    for (let j = 0; j < 9; j += 3) {
      const k = Math.round(V[b + j] * 1e6) + ',' + Math.round(V[b + j + 1] * 1e6) + ',' + Math.round(V[b + j + 2] * 1e6);
      const o = owner.get(k);
      if (o === undefined) owner.set(k, i); else parent[find(i)] = find(o);
    }
  });
  const area = new Map();
  sel.forEach((t, i) => { const r = find(i); area.set(r, (area.get(r) || 0) + A[t]); });
  let best = -1, bestA = -1;
  for (const [r, a] of area) if (a > bestA) { bestA = a; best = r; }
  return sel.filter((t, i) => find(i) === best);
}

/* Peak normal directions (sign folded) of the surface: in the plane ⊥ n when n is given, else over the sphere. */
function normalPeaks(mesh, n, maxPeaks) {
  const N = mesh.N, A = mesh.A, T = mesh.n, dirs = [];
  if (n) {
    const B = tangentBasis(n[0], n[1], n[2]), u = [B[0], B[1], B[2]], v = [B[3], B[4], B[5]];
    const NB = 720, H = new Float64Array(NB), lim = Math.sin((15 * Math.PI) / 180);
    for (let t = 0; t < T; t++) {
      const x = N[3 * t], y = N[3 * t + 1], z = N[3 * t + 2];
      if (Math.abs(x * n[0] + y * n[1] + z * n[2]) > lim) continue;
      let a = Math.atan2(x * v[0] + y * v[1] + z * v[2], x * u[0] + y * u[1] + z * u[2]);
      if (a < 0) a += Math.PI;
      if (a >= Math.PI) a -= Math.PI;
      H[Math.min(NB - 1, Math.floor((a / Math.PI) * NB))] += A[t];
    }
    const sm = new Float64Array(NB);
    for (let i = 0; i < NB; i++) for (let k = -3; k <= 3; k++) sm[i] += H[(i + k + NB) % NB] * Math.exp((-k * k) / 4);
    const pk = [];
    for (let i = 0; i < NB; i++) {
      let m = sm[i] > 0;
      for (let k = 1; k <= 6 && m; k++) if (sm[(i + k) % NB] > sm[i] || sm[(i - k + NB) % NB] > sm[i]) m = false;
      if (m) pk.push(i);
    }
    pk.sort((a, b) => sm[b] - sm[a]);
    for (const i of pk.slice(0, maxPeaks)) { const a0 = ((i + 0.5) / NB) * Math.PI; dirs.push([0, 1, 2].map(k => Math.cos(a0) * u[k] + Math.sin(a0) * v[k])); }
    return dirs;
  }
  // 1° latitude/longitude bins of the upper hemisphere (normals folded to z ≥ 0).
  const NT = 91, NP = 360, H = new Float64Array(NT * NP);
  for (let t = 0; t < T; t++) {
    let x = N[3 * t], y = N[3 * t + 1], z = N[3 * t + 2];
    if (z < 0) { x = -x; y = -y; z = -z; }
    const it = Math.min(NT - 1, Math.round((Math.acos(Math.min(1, z)) * 180) / Math.PI));
    let ph = Math.atan2(y, x); if (ph < 0) ph += 2 * Math.PI;
    H[it * NP + (Math.floor((ph * 180) / Math.PI) % NP)] += A[t];
  }
  const sm = new Float64Array(NT * NP);
  for (let i = 0; i < NT; i++) for (let j = 0; j < NP; j++) {
    let sum = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const ii = i + a; if (ii >= 0 && ii < NT) sum += H[ii * NP + ((j + b + NP) % NP)]; }
    sm[i * NP + j] = sum;
  }
  const pk = [];
  for (let i = 0; i < NT; i++) for (let j = 0; j < NP; j++) {
    const v0 = sm[i * NP + j]; if (!(v0 > 0)) continue;
    let m = true;
    for (let a = -3; a <= 3 && m; a++) for (let b = -3; b <= 3 && m; b++) {
      if (!a && !b) continue; const ii = i + a; if (ii < 0 || ii >= NT) continue;
      if (sm[ii * NP + ((j + b + NP) % NP)] > v0) m = false;
    }
    if (m) pk.push(i * NP + j);
  }
  pk.sort((a, b) => sm[b] - sm[a]);
  for (const k of pk) {
    const th = ((Math.floor(k / NP)) * Math.PI) / 180, ph = (((k % NP) + 0.5) * Math.PI) / 180;
    const d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    if (dirs.some(o => Math.abs(dot3(o, d)) > Math.cos((3 * Math.PI) / 180))) continue;
    dirs.push(d);
    if (dirs.length >= maxPeaks) break;
  }
  return dirs;
}

/* Unconstrained extrusion axis: directions on a Fibonacci hemisphere scored by the area of (a subsample of)
   triangles whose normal is within 3° of perpendicular; peaks refined by least squares on all such walls. */
function extrusionAxes3D(mesh) {
  const N = mesh.N, A = mesh.A, T = mesh.n, step = Math.max(1, Math.ceil(T / 60000));
  const sx = [], sy = [], sz = [], sw = [];
  for (let t = 0; t < T; t += step) { sx.push(N[3 * t]); sy.push(N[3 * t + 1]); sz.push(N[3 * t + 2]); sw.push(A[t]); }
  const ND = 2000, D = fibHemisphere(ND), sc = new Float64Array(ND), lim = Math.sin((3 * Math.PI) / 180);
  for (let k = 0; k < ND; k++) {
    const a = D[3 * k], b = D[3 * k + 1], c = D[3 * k + 2];
    let s2 = 0;
    for (let i = 0; i < sw.length; i++) if (Math.abs(sx[i] * a + sy[i] * b + sz[i] * c) < lim) s2 += sw[i];
    sc[k] = s2;
  }
  const rad = 2.5 * Math.sqrt((2 * Math.PI) / ND), cr = Math.cos(rad), peaks = [];
  for (let i = 0; i < ND; i++) {
    let m = sc[i] > 0;
    for (let j = 0; j < ND && m; j++) {
      if (j === i) continue;
      const dp = Math.abs(D[3 * i] * D[3 * j] + D[3 * i + 1] * D[3 * j + 1] + D[3 * i + 2] * D[3 * j + 2]);
      if (dp >= cr && (sc[j] > sc[i] || (sc[j] === sc[i] && j < i))) m = false;
    }
    if (m) peaks.push(i);
  }
  peaks.sort((a, b) => sc[b] - sc[a]);
  const out = [];
  for (const k of peaks.slice(0, 4)) {
    let d = [D[3 * k], D[3 * k + 1], D[3 * k + 2]], share = 0;
    for (let it = 0; it < 3; it++) {
      const M = [0, 0, 0, 0, 0, 0, 0, 0, 0]; let w = 0;
      for (let t = 0; t < T; t++) {
        const x = N[3 * t], y = N[3 * t + 1], z = N[3 * t + 2];
        if (Math.abs(x * d[0] + y * d[1] + z * d[2]) > lim) continue;
        const a = A[t]; w += a;
        M[0] += a * x * x; M[1] += a * x * y; M[2] += a * x * z; M[4] += a * y * y; M[5] += a * y * z; M[8] += a * z * z;
      }
      if (!w) break;
      M[3] = M[1]; M[6] = M[2]; M[7] = M[5];
      d = norm3(eigSym3(M)[2].vec);
      share = w / mesh.area;
    }
    if (out.some(o => Math.abs(dot3(o.dir, d)) > Math.cos((5 * Math.PI) / 180))) continue;
    out.push({ dir: d, share });
  }
  out.sort((a, b) => b.share - a.share);
  return out.filter(o => o.share >= 0.4 * (out[0] ? out[0].share : 0)).slice(0, 3);
}

/* Large flat regions. With n: only faces whose normal lies (nearly) ⊥ n, so they can be turned onto an axis
   without disturbing an alignment along n. Without n: any direction. Triangles facing a peak direction are
   grouped by plane offset; each group is split into vertex-connected pieces, refit as a plane (area-weighted
   PCA) and kept if it is genuinely flat and wider than a facet row. Returns up to 6, largest first. */
function flatPlanes(mesh, n) {
  const N = mesh.N, A = mesh.A, V = mesh.V, T = mesh.n;
  const peaks = normalPeaks(mesh, n, 12);
  const cen = mesh.centroid, tol = 0.0025, win = (2 * Math.PI) / 180, out = [];
  const cw = Math.cos(win);
  for (const d0 of peaks) {
    // Offsets of the triangles facing this way, binned at the flatness tolerance.
    const idx = [], off = [];
    for (let t = 0; t < T; t++) {
      if (Math.abs(N[3 * t] * d0[0] + N[3 * t + 1] * d0[1] + N[3 * t + 2] * d0[2]) < cw) continue;
      const b = 9 * t;
      idx.push(t); off.push(d0[0] * (V[b] + V[b + 3] + V[b + 6]) / 3 + d0[1] * (V[b + 1] + V[b + 4] + V[b + 7]) / 3 + d0[2] * (V[b + 2] + V[b + 5] + V[b + 8]) / 3);
    }
    const bins = new Map();
    for (let i = 0; i < idx.length; i++) { const k = Math.round(off[i] / tol); bins.set(k, (bins.get(k) || 0) + A[idx[i]]); }
    const keys = [...bins.keys()].sort((a, b) => bins.get(b) - bins.get(a)).slice(0, 4); // up to 4 parallel faces
    for (const kb of keys) {
      let sel = idx.filter((t, i) => Math.abs(off[i] - kb * tol) <= 1.5 * tol);
      let nrm = d0, dd = kb * tol, rms = 0, area = 0, c = [0, 0, 0], ev = null;
      for (let it = 0; it < 3 && sel.length; it++) { // area-weighted plane fit; re-select within tolerance between fits
        if (it) sel = idx.filter(t => {
          const b = 9 * t, x = N[3 * t], y = N[3 * t + 1], z = N[3 * t + 2];
          const pc = [(V[b] + V[b + 3] + V[b + 6]) / 3, (V[b + 1] + V[b + 4] + V[b + 7]) / 3, (V[b + 2] + V[b + 5] + V[b + 8]) / 3];
          return Math.abs(x * nrm[0] + y * nrm[1] + z * nrm[2]) > Math.cos(win) && Math.abs(dot3(nrm, pc) - dd) <= tol;
        });
        if (!sel.length) break;
        if (it === 2) sel = largestPiece(sel, V, A); // last fit on one connected face only
        const M = [0, 0, 0, 0, 0, 0, 0, 0, 0]; c = [0, 0, 0]; area = 0;
        for (const t of sel) { const b = 9 * t; for (let k = 0; k < 3; k++) c[k] += A[t] * (V[b + k] + V[b + 3 + k] + V[b + 6 + k]) / 3; area += A[t]; }
        c = c.map(x => x / area);
        for (const t of sel) {
          const b = 9 * t;
          for (let j = 0; j < 9; j += 3) {
            const p = [V[b + j] - c[0], V[b + j + 1] - c[1], V[b + j + 2] - c[2]];
            for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) M[3 * r + q] += A[t] * p[r] * p[q];
          }
        }
        ev = eigSym3(M);
        nrm = norm3(ev[2].vec);
        if (dot3(nrm, d0) < 0) nrm = nrm.map(x => -x);
        dd = dot3(nrm, c);
      }
      if (!sel.length || !ev) continue;
      // Width of the region (from the in-plane spread): rejects single facet rows of a tessellated cylinder.
      const width = Math.sqrt((Math.max(0, ev[1].val) / (3 * area)) * 12); // full width of an equivalent uniform strip
      if (width < 0.01) continue;
      let s2 = 0; area = 0;
      for (const t of sel) { const b = 9 * t, pc = [(V[b] + V[b + 3] + V[b + 6]) / 3, (V[b + 1] + V[b + 4] + V[b + 7]) / 3, (V[b + 2] + V[b + 5] + V[b + 8]) / 3], e = dot3(nrm, pc) - dd; s2 += A[t] * e * e; area += A[t]; }
      rms = Math.sqrt(s2 / area);
      if (rms > 0.5 * tol || area < 0.003 * mesh.area) continue; // not flat, or too small to matter
      let sw = 0;
      for (const t of sel) sw += A[t] * Math.sign(N[3 * t] * nrm[0] + N[3 * t + 1] * nrm[1] + N[3 * t + 2] * nrm[2]);
      // Outward = the faces' own normal side; if winding is mixed, the side facing away from the centroid.
      const flip = Math.abs(sw) > 0.8 * area ? sw < 0 : dot3(nrm, c) - dot3(nrm, cen) < 0;
      const outward = flip ? nrm.map(x => -x) : nrm;
      if (out.some(o => Math.abs(dot3(o.dirN, outward)) > Math.cos(win) && Math.abs(dot3(o.dirN, c) - dot3(o.dirN, o.c)) < 2 * tol)) continue;
      out.push({ dirN: outward, c, area, rms, tris: sel });
    }
  }
  out.sort((a, b) => b.area - a.area);
  const L = mesh.L, total = mesh.area;
  return out.slice(0, 6).map(o => ({
    dir: o.dirN, // normalisation preserves directions
    off: L * dot3(o.dirN, o.c) + dot3(o.dirN, mesh.c0), // plane dir·x = off, original units
    area: o.area * L * L, share: o.area / total, rms: o.rms * L,
    tilt: n ? (Math.asin(Math.min(1, Math.abs(dot3(o.dirN, n)))) * 180) / Math.PI : 0,
    tris: Uint32Array.from(o.tris, t => mesh.src[t]),
  }));
}

/* Stateful wrapper so the heavy work can live in a Web Worker: every call returns { value, transfer }. */
function engine() {
  let an = null;
  const lockDir = l => (l == null ? null : typeof l === 'number' ? an.candidates[l].nN : l);
  return {
    async ping() { return { value: 'ok' }; },
    async analyse(tris, progress, tick) {
      an = await analyse(tris, { progress, tick });
      for (const c of an.candidates) c.axis = inPlaneAxis(an.mesh, c.n);
      const m = an.mesh;
      return { value: { mesh: { c0: m.c0, L: m.L, centroid: m.centroid, cov: m.cov, n: m.n, nOrig: m.nOrig }, candidates: an.candidates, ms: an.ms } };
    },
    async second(lock, progress, tick) {
      const c1 = typeof lock === 'number' ? an.candidates[lock] : { nN: lock, unoriented: an.candidates[0].unoriented };
      return { value: await secondPlane(an, c1, { progress, tick }) };
    },
    async devmap(cand, progress, tick) {
      const v = await deviationMap(an, cand, { progress, tick });
      return { value: v, transfer: [v.buffer] };
    },
    async feature(p, nrm) { return { value: pickFeature(an, p, nrm) }; },
    // lock: candidate index, a direction (search ⊥ it), or null (free).
    async extrude(lock) { return { value: extrusionAxes(an.mesh, lockDir(lock)) }; },
    async flats(lock) { const v = flatPlanes(an.mesh, lockDir(lock)); return { value: v, transfer: v.map(p => p.tris.buffer) }; },
    async long(lock) { return { value: longAxis(an.mesh, lockDir(lock)) }; },
  };
}

/* ------------------------------------------------------------------ synthetic seat post (demo + tests) */

/* Z up, sagittal (mirror) plane x = 0, fore-aft along Y. Tessellation deliberately not mirror-symmetric.
   o.logo adds a small one-sided emboss on the tube (a real asymmetry the fit must ignore). */
function seatPost(o) {
  o = Object.assign({ seg: 72, nz: 14, logo: true, head: 1 }, o || {});
  const B = [];
  const tri = (a, b, c) => B.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const quad = (a, b, c, d, f) => { if (f) { tri(a, b, d); tri(b, c, d); } else { tri(a, b, c); tri(a, c, d); } };
  const pt = (c, e1, e2, a, r, th, h) => [0, 1, 2].map(k => c[k] + r * (Math.cos(th) * e1[k] + Math.sin(th) * e2[k]) + h * a[k]);
  function wall(c, e1, e2, a, r, h0, h1, S, nh, ph, inward) {
    for (let i = 0; i < S; i++) {
      const t0 = ph + (2 * Math.PI * i) / S, t1 = ph + (2 * Math.PI * (i + 1)) / S;
      for (let k = 0; k < nh; k++) {
        const ha = h0 + ((h1 - h0) * k) / nh, hb = h0 + ((h1 - h0) * (k + 1)) / nh;
        const p = [pt(c, e1, e2, a, r, t0, ha), pt(c, e1, e2, a, r, t1, ha), pt(c, e1, e2, a, r, t1, hb), pt(c, e1, e2, a, r, t0, hb)];
        if (inward) quad(p[3], p[2], p[1], p[0], (i + k) & 1); else quad(p[0], p[1], p[2], p[3], (i + k) & 1);
      }
    }
  }
  function disc(c, e1, e2, a, r, h, S, ph, up) {
    const ctr = [c[0] + h * a[0], c[1] + h * a[1], c[2] + h * a[2]];
    for (let i = 0; i < S; i++) {
      const p0 = pt(c, e1, e2, a, r, ph + (2 * Math.PI * i) / S, h), p1 = pt(c, e1, e2, a, r, ph + (2 * Math.PI * (i + 1)) / S, h);
      if (up) tri(ctr, p0, p1); else tri(ctr, p1, p0);
    }
  }
  function annulus(c, e1, e2, a, ri, ro, h, S, ph, up) {
    for (let i = 0; i < S; i++) {
      const t0 = ph + (2 * Math.PI * i) / S, t1 = ph + (2 * Math.PI * (i + 1)) / S;
      const p = [pt(c, e1, e2, a, ri, t0, h), pt(c, e1, e2, a, ro, t0, h), pt(c, e1, e2, a, ro, t1, h), pt(c, e1, e2, a, ri, t1, h)];
      if (up) quad(p[0], p[1], p[2], p[3], i & 1); else quad(p[3], p[2], p[1], p[0], i & 1);
    }
  }
  function box(x0, x1, y0, y1, z0, z1) {
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
    quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  }
  const Z = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const S = o.seg, ph = 0.37 * (2 * Math.PI / S), hs = o.head;
  // Tube Ø27.2, 2 mm wall, 280 long.
  wall(Z[0], Z[1], Z[2], Z[3], 13.6, 0, 280, S, o.nz, ph, false);
  wall(Z[0], Z[1], Z[2], Z[3], 11.6, 0, 280, S, o.nz, ph * 1.7, true);
  annulus(Z[0], Z[1], Z[2], Z[3], 11.6, 13.6, 0, S, ph, false);
  // Clamp head (setback toward -Y).
  box(-14 * hs, 14 * hs, -30 * hs, 18 * hs, 280, 280 + 12 * hs);
  box(-14 * hs, 14 * hs, -26 * hs, 14 * hs, 280 + 19 * hs, 280 + 25 * hs);
  const rs = Math.max(8, S >> 1);
  for (const sx of [-1, 1]) {
    const c = [sx * 10.5 * hs, -36 * hs, 280 + 15.5 * hs], e1 = [0, 0, 1], e2 = [1, 0, 0], a = [0, 1, 0];
    const p2 = sx > 0 ? 0.21 : 0.63;
    wall(c, e1, e2, a, 3.5 * hs, 0, 60 * hs, rs, 3, p2, false);
    disc(c, e1, e2, a, 3.5 * hs, 0, rs, p2, false);
    disc(c, e1, e2, a, 3.5 * hs, 60 * hs, rs, p2, true);
  }
  for (const by of [-22, 8]) {
    const c = [0, by * hs, 0];
    wall(c, Z[1], Z[2], Z[3], 2.5 * hs, 280 + 12 * hs, 280 + 19 * hs, 16, 1, 0.1, false);
    wall(c, Z[1], Z[2], Z[3], 4.5 * hs, 280 + 25 * hs, 280 + 29 * hs, 6, 1, 0, false);
    disc(c, Z[1], Z[2], Z[3], 4.5 * hs, 280 + 29 * hs, 6, 0, true);
  }
  if (o.logo) box(13.2, 14.3, -4, 4, 100, 160);
  return new Float32Array(B);
}

function rotationXYZ(ax, ay, az) {
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul33(Rz, mul33(Ry, Rx));
}

function rigid(tris, R, t) {
  return transform(tris, [R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2]]);
}

const SymCore = {
  parseSTL, writeSTL, zipOne, crc32,
  analyse, secondPlane, frame, transform, deviationMap, pickFeature, extrusionAxes, flatPlanes, longAxis, orient, engine,
  seatPost, rotationXYZ, rigid,
  _internal: { prepareMesh, sampleSurface, KDTree, BVH, eigSym3, refinePlane, mirrorDistances, fibHemisphere, closestPtTri, CP },
};

if (typeof module === 'object' && module.exports) module.exports = SymCore;
else root.SymCore = SymCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
