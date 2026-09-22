/**
 * One-off: generate the 360° equirectangular night-city backdrop at
 * 2048×1024 (the API's real constraint is ≤2^22 px + multiples of 32 —
 * the CLI whitelist just doesn't expose this size).
 */
import ZAI from 'z-ai-web-dev-sdk'
import { writeFileSync } from 'fs'

const PROMPTS: Record<string, string> = {
  a: 'Seamless 360 degree equirectangular panorama of a dark rooftop observation deck at night: empty dark asphalt rooftop floor in the foreground bottom third, a breathtaking glowing megacity skyline of illuminated skyscrapers wrapping around the entire distant horizon, hundreds of warm golden window lights and cool teal-blue neon towers, deep navy night sky with wispy clouds and faint stars in the upper half, cinematic automotive commercial backdrop, moody dark atmosphere, photorealistic, ultra detailed, no cars, no people, no text, no watermark',
  b: '360 degree equirectangular panorama photo, seaside promenade at night: wide dark wet asphalt embankment in the foreground, glittering modern harbor city skyline with glowing towers across the water on the horizon band, reflections shimmering on dark water, deep indigo-black sky with subtle clouds in upper half, champagne gold and cyan city lights, long exposure night photography, cinematic luxury car commercial setting, dark moody tones, photorealistic, seamless wrap, no cars, no people, no text',
}

async function main() {
  const key = process.argv[2]
  const out = process.argv[3]
  const zai = await ZAI.create()
  const res = await zai.images.generations.create({ prompt: PROMPTS[key], size: '2048x1024' })
  const b64 = res.data?.[0]?.base64
  if (!b64) throw new Error('no image data returned')
  writeFileSync(out, Buffer.from(b64, 'base64'))
  console.log('saved', out)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
