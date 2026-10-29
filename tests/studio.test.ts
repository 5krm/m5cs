import test from 'node:test'
import assert from 'node:assert/strict'
import { createStudioCove } from '../src/lib/studio'

test('studio floor curves continuously into an inward-facing wall', () => {
  const geometry = createStudioCove()
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  for (let i = 0; i < positions.count; i++) {
    for (let axis = 0; axis < 3; axis++) assert.ok(Number.isFinite(normals.getComponent(i, axis)))
    const y = positions.getY(i)
    if (y < 0 && Math.hypot(positions.getX(i), positions.getZ(i)) < 10) {
      assert.ok(normals.getY(i) > 0.99, 'floor must face upward')
    }
    if (y > 15) {
      const dot = positions.getX(i) * normals.getX(i) + positions.getZ(i) * normals.getZ(i)
      assert.ok(dot < 0, 'wall must face the vehicle')
    }
  }
  geometry.computeBoundingBox()
  assert.ok(geometry.boundingBox!.min.y > -0.02)
  assert.ok(geometry.boundingBox!.max.y >= 24)
  geometry.dispose()
})
