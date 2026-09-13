#!/usr/bin/env python3
"""Convert KHR_materials_pbrSpecularGlossiness -> pbrMetallicRoughness (three.js r150+ compatible)."""
import json, os

SRC = "/home/z/my-project/upload/bmw_m5_extracted/scene.gltf"
DST = "/home/z/my-project/public/models/bmw-m5-cs/scene.gltf"

with open(SRC) as f:
    g = json.load(f)

converted = 0
for m in g.get("materials", []):
    ext = m.get("extensions", {}).get("KHR_materials_pbrSpecularGlossiness")
    if not ext:
        continue
    diffuse = ext.get("diffuseFactor", [1, 1, 1, 1])
    gloss = ext.get("glossinessFactor", 1.0)
    spec = ext.get("specularFactor", [1, 1, 1])
    # heuristic: dielectric specular ~0.04 gray -> metalness from spec magnitude
    spec_mag = sum(spec) / 3.0
    metalness = max(0.0, min(1.0, (spec_mag - 0.04) / 0.96)) * 0.85
    m["pbrMetallicRoughness"] = {
        "baseColorFactor": diffuse,
        "metalnessFactor": round(metalness, 3),
        "roughnessFactor": round(1.0 - gloss, 3),
    }
    m["extensions"].pop("KHR_materials_pbrSpecularGlossiness", None)
    if not m.get("extensions"):
        m.pop("extensions", None)
    converted += 1

# drop the used-extension declaration
if "extensionsUsed" in g:
    g["extensionsUsed"] = [
        e for e in g["extensionsUsed"] if e != "KHR_materials_pbrSpecularGlossiness"
    ]
    if not g["extensionsUsed"]:
        g.pop("extensionsUsed")
if "extensionsRequired" in g:
    g["extensionsRequired"] = [
        e for e in g["extensionsRequired"] if e != "KHR_materials_pbrSpecularGlossiness"
    ]
    if not g["extensionsRequired"]:
        g.pop("extensionsRequired")

os.makedirs(os.path.dirname(DST), exist_ok=True)
with open(DST, "w") as f:
    json.dump(g, f, separators=(",", ":"))

print(f"converted {converted} materials -> {DST} ({os.path.getsize(DST)//1024} KB)")
