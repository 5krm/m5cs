import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DataTexture } from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { PHOTO_IDS, PHOTO_LOCATIONS, randomLocation, buildPhotographicLocation } from '../src/lib/locations/photographic'

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

test('browser panoramas preserve HDR data within the loading budget', () => {
  for (const id of PHOTO_IDS) {
    const original = readFileSync(`public/environments/${PHOTO_LOCATIONS[id].file}.hdr`)
    const bytes = readFileSync(`public/environments/${PHOTO_LOCATIONS[id].file}-1k.hdr`)
    assert.ok(bytes.length < original.length / 3, `${id} panorama must be at least three times smaller`)
    const image = new HDRLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    assert.equal(image.width, 1024)
    assert.equal(image.height, 512)
    assert.ok(image.data)
    assert.equal(image.data.length, 1024 * 512 * 4)
    const preview = readFileSync(`public/environments/${PHOTO_LOCATIONS[id].file}-preview.hdr`)
    assert.ok(preview.length < original.length / 12, `${id} first view must be at least twelve times smaller`)
    const firstView = new HDRLoader().parse(preview.buffer.slice(preview.byteOffset, preview.byteOffset + preview.byteLength))
    assert.equal(firstView.width, 512)
    assert.equal(firstView.height, 256)
  }
})

test('a failed location download rejects without building a scene', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 503 })
  try {
    await assert.rejects(buildPhotographicLocation('alpine', false), /Location download failed \(503\)/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('location loading forwards cancellation and uses the small panorama', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  let requestedUrl = ''
  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url)
    assert.equal(options?.signal, controller.signal)
    const bytes = readFileSync('public/environments/mountain-road-preview.hdr')
    return new Response(bytes)
  }
  try {
    const location = await buildPhotographicLocation('alpine', false, controller.signal)
    assert.equal(requestedUrl, '/environments/mountain-road-preview.hdr')
    assert.ok(location.environment instanceof DataTexture)
    assert.equal(location.environment.image.width, 512)
    location.dispose()
  } finally {
    globalThis.fetch = originalFetch
  }
})
