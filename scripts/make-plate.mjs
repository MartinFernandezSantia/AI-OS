import sharp from 'sharp';
const out = process.argv[2];
await sharp({ create: { width: 2752, height: 1536, channels: 3, background: { r: 10, g: 10, b: 12 } } })
  .png().toFile(out);
console.log('wrote', out);
