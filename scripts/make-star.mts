// Generate a tight sub-90° star-prism STL for testing sharp-corner shelling.
// Run: npx tsx scripts/make-star.mts  ->  public/star.stl + samples/star.stl
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeStarPrism } from './shapes';
import { fromArrays, exportSTL } from '../src/lib/geometry';

const star = makeStarPrism(6, 12, 2.5, 12);
const blob = exportSTL(fromArrays(star));
const buf = Buffer.from(await blob.arrayBuffer());
mkdirSync('public', { recursive: true });
mkdirSync('samples', { recursive: true });
writeFileSync('public/star.stl', buf);
writeFileSync('samples/star.stl', buf);
console.log(`Wrote star.stl (${star.index.length / 3} tris)`);
