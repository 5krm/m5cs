import fs from 'node:fs/promises';
import path from 'node:path';
import { FloatType } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

const directory = 'public/environments';
const names = ['mountain-road', 'city-parking', 'sunset-avenue'];

// Retain HDR lighting and the original files; ship a smaller panorama to browsers.
function encodeScanline(channel) {
  const output = [];
  let offset = 0;
  while (offset < channel.length) {
    let run = 1;
    while (run < 127 && offset + run < channel.length && channel[offset + run] === channel[offset]) run++;
    if (run >= 4) {
      output.push(128 + run, channel[offset]);
      offset += run;
    } else {
      const start = offset;
      offset += Math.min(run, 127);
      while (offset < channel.length && offset - start < 127) {
        run = 1;
        while (run < 4 && offset + run < channel.length && channel[offset + run] === channel[offset]) run++;
        if (run >= 4) break;
        offset += Math.min(run, 127 - (offset - start));
      }
      output.push(offset - start, ...channel.subarray(start, offset));
    }
  }
  return Buffer.from(output);
}

for (const name of names) {
 for (const scale of [2, 4]) {
  const input = path.join(directory, `${name}.hdr`);
  const output = path.join(directory, `${name}-${scale === 2 ? '1k' : 'preview'}.hdr`);
  const original = await fs.stat(input);
  const existing = await fs.stat(output).catch(() => null);
  if (existing && existing.mtimeMs >= original.mtimeMs) continue;
  const bytes = await fs.readFile(input);
  const image = new HDRLoader().setDataType(FloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const width = image.width / scale;
  const height = image.height / scale;
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error(`Unexpected panorama dimensions: ${name}`);
  const chunks = [Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`)];
  const channels = Array.from({ length: 4 }, () => new Uint8Array(width));
  const stride = image.data.length / (image.width * image.height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgb = [0, 0, 0];
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const pixel = ((y * scale + dy) * image.width + x * scale + dx) * stride;
        for (let c = 0; c < 3; c++) rgb[c] += image.data[pixel + c] / (scale * scale);
      }
      const peak = Math.max(...rgb);
      const exponent = peak > 1e-32 ? Math.floor(Math.log2(peak)) + 1 : -128;
      const rgbeScale = peak > 1e-32 ? 256 / 2 ** exponent : 0;
      for (let c = 0; c < 3; c++) channels[c][x] = Math.min(255, Math.max(0, Math.floor(rgb[c] * rgbeScale)));
      channels[3][x] = exponent + 128;
    }
    chunks.push(Buffer.from([2, 2, width >> 8, width & 255]), ...channels.map(encodeScanline));
  }
  const optimized = Buffer.concat(chunks);
  await fs.writeFile(output, optimized);
  console.log(`[environments] ${path.basename(output)}: ${original.size} → ${optimized.length} bytes`);
 }
}
