import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_BUILD_CONFIGURATION,
  normalizeBuildConfiguration,
  readBuildConfiguration,
  serializeBuildConfiguration,
} from '../src/lib/build-config'

test('the first-run build is a deterministic studio configuration', () => {
  assert.deepEqual(readBuildConfiguration('', null), DEFAULT_BUILD_CONFIGURATION)
  assert.equal(DEFAULT_BUILD_CONFIGURATION.sceneId, 'studio')
})

test('a shared URL round-trips every configurable value', () => {
  const expected = {
    paint: 'frozen-bluestone',
    wheelFinish: 'jet-black',
    caliperColor: 'blue',
    sceneId: 'tokyo',
    theme: 'night',
    highBeams: false,
  } as const

  const query = serializeBuildConfiguration(expected)
  assert.deepEqual(readBuildConfiguration(`?${query}`, null), expected)
})

test('shared URL values take precedence over the locally saved build', () => {
  const saved = JSON.stringify({ ...DEFAULT_BUILD_CONFIGURATION, sceneId: 'dubai' })
  const restored = readBuildConfiguration('?paint=sapphire-black&scene=studio', saved)

  assert.equal(restored.paint, 'sapphire-black')
  assert.equal(restored.sceneId, 'studio')
  assert.equal(restored.wheelFinish, DEFAULT_BUILD_CONFIGURATION.wheelFinish)
})

test('invalid or stale URL and storage values safely fall back to defaults', () => {
  assert.deepEqual(readBuildConfiguration('?paint=not-a-paint&scene=unknown', null), DEFAULT_BUILD_CONFIGURATION)
  assert.deepEqual(readBuildConfiguration('', '{broken json'), DEFAULT_BUILD_CONFIGURATION)
  assert.deepEqual(
    normalizeBuildConfiguration({ paint: 'unknown', highBeams: 'yes' }),
    DEFAULT_BUILD_CONFIGURATION,
  )
})
