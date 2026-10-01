# stl-reorient

Finds the mirror (reflective-symmetry) plane of an STL and moves the part so that plane is the YZ plane (x = 0).
Rotation + translation only; the mesh is never mirrored.

Open `index.html` in a browser (three.js loads from a CDN), drop an STL, download the result.
Everything runs locally in the page; the analysis runs in a Web Worker so the page stays responsive.

- Symmetry score: P95 mirror deviation (95 % of the surface mirrors within this distance).
  ≤ 0.25 mm perfect, ≤ 1 mm good, ≤ 3 mm ok, above that weak.
- Auto-align extrusion axis: finds the direction (inside the mirror plane) that the most side-wall area is
  perpendicular to, i.e. the extrude/sweep/revolve axis, and turns it onto Z with the larger end up.
  Press again to cycle through other candidates.
- Align to picked feature: click a flat face (its normal) or a round surface (its axis) and it is turned onto Z,
  keeping the mirror plane on YZ.

## Algorithm (`symcore.js`)

Mirror of point p across plane (n, d): S(p) = p − 2(n·p − d)n. The plane minimises
Σ ρ(dist(S(pᵢ), mesh)) over area-uniform surface samples pᵢ, with ρ = Tukey biweight.

1. Area-uniform surface samples, so the result does not depend on how the STL is tessellated.
2. Global search: planes through the surface centroid, 1200 normals on a Fibonacci hemisphere + the 3 PCA axes,
   scored by truncated mean mirror distance (KD-tree, normal orientation must match).
3. Local minima → robust Gauss–Newton ICP on the 3-DOF reflection (2 normal tilts + offset), Tukey IRLS with an
   annealed scale so small decisive features (e.g. a clamp head on a round tube) are not rejected early.
4. Polish on the exact mesh (BVH, closest point on triangle). Up to 3 distinct candidate planes are reported.
5. Optional second plane: best mirror plane locked perpendicular to the first (1-D sweep + constrained ICP),
   placed on XZ.
6. Frame: X = plane normal, Z = in-plane long axis snapped to the principal direction of the face normals,
   origin on the plane at bounding-box centre, box min or centroid.

## Tests

```
node test/run.mjs
```

Synthetic seat posts in random poses (non-mirror-symmetric tessellation, a one-sided logo emboss):
plane recovered to < 0.003° and < 0.002 mm; mixed triangle winding, a 3-plane box, and a non-symmetric part are covered too.
