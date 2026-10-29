import * as THREE from 'three'
import type { StudioTheme } from '@/types/configurator'

/** A single continuous floor-to-wall surface: no intersecting floor and cylinder. */
export function createStudioCove(): THREE.BufferGeometry {
  const profile: [number, number][] = [[0, -0.015], [7, -0.015], [14, -0.015]]
  for (let i = 1; i <= 24; i++) {
    const a = i / 24 * Math.PI / 2
    profile.push([14 + 8 * Math.sin(a), 8 * (1 - Math.cos(a)) - 0.015])
  }
  profile.push([22, 24])
  const segments = 96
  const positions: number[] = [], normals: number[] = [], indices: number[] = []
  for (let i = 0; i < profile.length; i++) {
    const [radius, y] = profile[i]
    const curveAngle = Math.max(0, Math.min(1, (i - 2) / 24)) * Math.PI / 2
    for (let j = 0; j <= segments; j++) {
      const a = j / segments * Math.PI * 2
      positions.push(radius * Math.cos(a), y, radius * Math.sin(a))
      normals.push(-Math.sin(curveAngle) * Math.cos(a), Math.cos(curveAngle), -Math.sin(curveAngle) * Math.sin(a))
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j, b = a + segments + 1
      indices.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return geometry
}
export function studioPalette(theme: StudioTheme) {
  return theme === 'night'
    ? { surface: '#687889', background: '#8798a9' }
    : theme === 'm'
      ? { surface: '#8e9da9', background: '#b0becb' }
      : { surface: '#a3a5a5', background: '#bdc1c3' }
}
