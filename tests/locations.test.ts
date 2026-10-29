import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { PHOTO_IDS, PHOTO_LOCATIONS, randomLocation } from '../src/lib/locations/photographic'

test('all photographic locations ship valid bounded HDR panoramas', () => {
  for (const id of PHOTO_IDS) {
    const bytes = readFileSync(`public/environments/${PHOTO_LOCATIONS[id].file}.hdr`)
    assert.ok(bytes.length < 8 * 1024 * 1024)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const image = new HDRLoader().parse(buffer)
    assert.equal(image.width, 2048)
    assert.equal(image.height, 1024)
    assert.ok((image.data?.length ?? 0) > 0)
  }
})
test('random selection always gives a supported location different from the current one', () => {
  for (const current of [...PHOTO_IDS, 'studio'] as const) {
    for (let i = 0; i < 50; i++) {
      const chosen = randomLocation(current)
      assert.ok(PHOTO_IDS.includes(chosen))
      assert.notEqual(chosen, current)
    }
  }
})
