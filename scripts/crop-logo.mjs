import sharp from 'sharp';
const [,, src, out, l, t, w, h] = process.argv;
await sharp(src)
  .extract({ left: +l, top: +t, width: +w, height: +h })
  .resize({ width: 1000 })
  .toFile(out);
console.log('wrote', out);
