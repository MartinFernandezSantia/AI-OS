import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const [,, src, out, widthArg] = process.argv;
const width = parseInt(widthArg || '2048', 10);
const svg = readFileSync(src, 'utf8');
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: width },
  background: 'rgba(0,0,0,0)', // transparent
});
const png = resvg.render().asPng();
writeFileSync(out, png);
const { width: w, height: h } = resvg.render();
console.log(`Wrote ${out} @ ${width}px width`);
