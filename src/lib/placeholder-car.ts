'use client'

/**
 * Ultra-light procedural placeholder car - 0KB network, instant paint
 * Shows a recognizable M5 silhouette while real model streams in
 * ~5KB JS, no textures, no external deps
 */

import * as THREE from 'three'

export function createPlaceholderCar(): THREE.Group {
  const group = new THREE.Group()
  
  // Materials - match M5 CS grey but simplified
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x8a8d93,
    metalness: 0.7,
    roughness: 0.3,
    envMapIntensity: 0.8,
  })
  
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a0e14,
    metalness: 0.2,
    roughness: 0.05,
    transmission: 0.1,
    transparent: true,
    opacity: 0.85,
  })
  
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    metalness: 0.3,
    roughness: 0.7,
  })
  
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xc9a86a, // Gold bronze
    metalness: 0.8,
    roughness: 0.2,
  })
  
  // Main body - low poly box with beveled look
  const bodyGeo = new THREE.BoxGeometry(4.6, 0.9, 1.9, 2, 1, 1)
  // Taper front and rear
  const pos = bodyGeo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    // Nose taper
    if (x > 1.8) {
      const factor = 1 - (x - 1.8) * 0.15
      pos.setZ(i, pos.getZ(i) * Math.max(0.7, factor))
    }
    // Rear taper
    if (x < -1.8) {
      const factor = 1 - (-1.8 - x) * 0.12
      pos.setZ(i, pos.getZ(i) * Math.max(0.75, factor))
    }
    // Roof lower at rear
    if (y > 0 && x < 0.5 && x > -1.5) {
      pos.setY(i, y * 0.85)
    }
  }
  pos.needsUpdate = true
  bodyGeo.computeVertexNormals()
  
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  body.position.y = 0.65
  body.castShadow = true
  body.receiveShadow = false
  group.add(body)
  
  // Roof / cabin
  const cabinGeo = new THREE.BoxGeometry(2.2, 0.55, 1.6, 1, 1, 1)
  const cabin = new THREE.Mesh(cabinGeo, bodyMat)
  cabin.position.set(-0.15, 1.25, 0)
  cabin.castShadow = true
  group.add(cabin)
  
  // Windshield - slanted plane
  const windshieldGeo = new THREE.PlaneGeometry(1.4, 0.9)
  const windshield = new THREE.Mesh(windshieldGeo, glassMat)
  windshield.position.set(0.75, 1.25, 0)
  windshield.rotation.y = Math.PI / 2
  windshield.rotation.x = -Math.PI / 8
  windshield.rotation.z = Math.PI / 2
  group.add(windshield)
  
  // Rear window
  const rearWindow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8), glassMat)
  rearWindow.position.set(-1.15, 1.25, 0)
  rearWindow.rotation.y = -Math.PI / 2
  rearWindow.rotation.x = Math.PI / 10
  rearWindow.rotation.z = -Math.PI / 2
  group.add(rearWindow)
  
  // Side windows
  const sideWindowGeo = new THREE.PlaneGeometry(2.0, 0.5)
  for (const zSide of [-0.81, 0.81]) {
    const sideWin = new THREE.Mesh(sideWindowGeo, glassMat)
    sideWin.position.set(-0.15, 1.25, zSide)
    sideWin.rotation.y = zSide > 0 ? 0 : Math.PI
    group.add(sideWin)
  }
  
  // Wheels - 4 cylinders
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 12)
  wheelGeo.rotateX(Math.PI / 2)
  const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.34, 8)
  rimGeo.rotateX(Math.PI / 2)
  
  const wheelPositions: [number, number][] = [
    [1.35, 0.85],
    [1.35, -0.85],
    [-1.35, 0.85],
    [-1.35, -0.85],
  ]
  
  for (const [x, z] of wheelPositions) {
    const wheelGroup = new THREE.Group()
    wheelGroup.position.set(x, 0.38, z)
    
    const tire = new THREE.Mesh(wheelGeo, wheelMat)
    tire.castShadow = true
    wheelGroup.add(tire)
    
    const rim = new THREE.Mesh(rimGeo, rimMat)
    rim.position.z = 0.02
    wheelGroup.add(rim)
    
    group.add(wheelGroup)
  }
  
  // Front grille - two kidneys
  const grilleMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.5, roughness: 0.5 })
  const kidneyGeo = new THREE.BoxGeometry(0.08, 0.4, 0.32)
  for (const zOffset of [-0.22, 0.22]) {
    const kidney = new THREE.Mesh(kidneyGeo, grilleMat)
    kidney.position.set(2.32, 0.65, zOffset)
    kidney.rotation.y = zOffset > 0 ? 0.15 : -0.15
    group.add(kidney)
  }
  
  // Headlights - glowing boxes
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffeedd,
    emissiveIntensity: 0.3,
  })
  const headlightGeo = new THREE.BoxGeometry(0.1, 0.18, 0.35)
  for (const zSide of [-0.75, 0.75]) {
    const hl = new THREE.Mesh(headlightGeo, headlightMat)
    hl.position.set(2.28, 0.68, zSide)
    group.add(hl)
  }
  
  // Taillights
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xcc0000,
    emissive: 0x550000,
    emissiveIntensity: 0.4,
  })
  const tailGeo = new THREE.BoxGeometry(0.08, 0.16, 0.4)
  for (const zSide of [-0.7, 0.7]) {
    const tl = new THREE.Mesh(tailGeo, tailMat)
    tl.position.set(-2.32, 0.75, zSide)
    group.add(tl)
  }
  
  return group
}

/**
 * Create an even simpler fallback - just a box with car proportions
 * For ultra-slow connections or WebGL failure
 */
export function createFallbackBox(): THREE.Group {
  const group = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8a8d93,
    metalness: 0.6,
    roughness: 0.4,
  })
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.1, 1.9), mat)
  body.position.y = 0.7
  body.castShadow = true
  group.add(body)
  
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 })
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 8)
  wheelGeo.rotateX(Math.PI / 2)
  for (const [x, z] of [[1.3, 0.8], [1.3, -0.8], [-1.3, 0.8], [-1.3, -0.8]] as const) {
    const w = new THREE.Mesh(wheelGeo, wheelMat)
    w.position.set(x, 0.35, z)
    group.add(w)
  }
  
  return group
}
