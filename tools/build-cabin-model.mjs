#!/usr/bin/env node
/**
 * Generates public/models/skylink-cabin.glb, a massing model of the
 * 10-passenger cabin assembled from boxes. It stands in for the detailed CAD
 * export: same overall dimensions, livery and part layout, no surface detail.
 *
 *   node tools/build-cabin-model.mjs
 *
 * No dependencies: the binary glTF container is written by hand.
 * Units are metres, +Y is up, the doors face +X and travel is along Z.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../public/models/skylink-cabin.glb',
);

// glTF base colours are linear; the palette is authored in sRGB hex.
const srgbToLinear = (channel) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const hex = (value, alpha = 1) => [
  ...[1, 3, 5].map((i) => srgbToLinear(parseInt(value.slice(i, i + 2), 16) / 255)),
  alpha,
];

const MATERIALS = {
  crimson: { color: hex('#990000'), metallic: 0.35, roughness: 0.38 },
  cream: { color: hex('#EEEDEB'), metallic: 0.1, roughness: 0.5 },
  slate: { color: hex('#1B2129'), metallic: 0.2, roughness: 0.7 },
  steel: { color: hex('#A9AFB6'), metallic: 0.9, roughness: 0.35 },
  glass: { color: hex('#9CC3D6', 0.32), metallic: 0, roughness: 0.08, blend: true },
};

/** [material, centre xyz, size xyz] */
const PARTS = [
  // Chassis and running gear
  ['slate', [0, 0.06, 0], [2.0, 0.12, 2.2]],
  ['slate', [0.9, -0.03, 0], [0.1, 0.06, 2.0]],
  ['slate', [-0.9, -0.03, 0], [0.1, 0.06, 2.0]],

  // Shell: crimson lower panels, glazed band, cream roof band
  ['crimson', [0, 0.545, 0], [2.0, 0.85, 2.2]],
  ['glass', [0, 1.445, 0], [1.94, 0.95, 2.14]],
  ['cream', [0.955, 1.445, 1.055], [0.09, 0.95, 0.09]],
  ['cream', [-0.955, 1.445, 1.055], [0.09, 0.95, 0.09]],
  ['cream', [0.955, 1.445, -1.055], [0.09, 0.95, 0.09]],
  ['cream', [-0.955, 1.445, -1.055], [0.09, 0.95, 0.09]],
  ['cream', [0, 2.01, 0], [2.0, 0.18, 2.2]],
  ['crimson', [0, 2.13, 0], [1.8, 0.06, 2.0]],

  // Bi-parting door set on the +X side: 0.90 m clear between jambs
  ['cream', [1.005, 1.07, 0.48], [0.03, 1.8, 0.06]],
  ['cream', [1.005, 1.07, -0.48], [0.03, 1.8, 0.06]],
  ['cream', [1.005, 1.95, 0], [0.03, 0.06, 1.02]],
  ['slate', [1.005, 1.07, 0], [0.02, 1.74, 0.03]],
  ['steel', [1.03, 0.13, 0], [0.08, 0.03, 0.9]],

  // Roof services tray
  ['slate', [0, 2.175, -0.45], [1.2, 0.03, 0.8]],

  // Damper, hanger, grip and a short length of haul rope
  ['slate', [0, 2.2, 0.25], [0.5, 0.08, 0.5]],
  ['steel', [0, 2.78, 0], [0.12, 1.24, 0.12]],
  ['steel', [0, 3.47, 0], [0.24, 0.18, 0.56]],
  ['slate', [0, 3.6, 0], [0.045, 0.045, 5.0]],
];

const FACES = [
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

function appendBox(mesh, centre, size) {
  const half = size.map((length) => length / 2);
  for (const { normal, u, v } of FACES) {
    const base = mesh.positions.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let axis = 0; axis < 3; axis += 1) {
        mesh.positions.push(
          centre[axis] + half[axis] * (normal[axis] + su * u[axis] + sv * v[axis]),
        );
      }
      mesh.normals.push(...normal);
    }
    mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function buildGlb() {
  const materialNames = Object.keys(MATERIALS);
  const meshes = new Map(
    materialNames.map((name) => [name, { positions: [], normals: [], indices: [] }]),
  );
  for (const [material, centre, size] of PARTS) {
    appendBox(meshes.get(material), centre, size);
  }

  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  let byteOffset = 0;

  const addAccessor = (typedArray, target, extra) => {
    const bytes = Buffer.from(typedArray.buffer);
    bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target });
    chunks.push(bytes);
    byteOffset += bytes.length;
    const padding = (4 - (byteOffset % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      byteOffset += padding;
    }
    accessors.push({ bufferView: bufferViews.length - 1, ...extra });
    return accessors.length - 1;
  };

  const ARRAY_BUFFER = 34962;
  const ELEMENT_ARRAY_BUFFER = 34963;
  const FLOAT = 5126;
  const UNSIGNED_SHORT = 5123;

  const primitives = materialNames.map((name, materialIndex) => {
    const { positions, normals, indices } = meshes.get(name);
    const bounds = [0, 1, 2].map((axis) => {
      const values = positions.filter((_, i) => i % 3 === axis);
      return [Math.min(...values), Math.max(...values)];
    });
    return {
      attributes: {
        POSITION: addAccessor(new Float32Array(positions), ARRAY_BUFFER, {
          componentType: FLOAT,
          count: positions.length / 3,
          type: 'VEC3',
          min: bounds.map(([min]) => Math.fround(min)),
          max: bounds.map(([, max]) => Math.fround(max)),
        }),
        NORMAL: addAccessor(new Float32Array(normals), ARRAY_BUFFER, {
          componentType: FLOAT,
          count: normals.length / 3,
          type: 'VEC3',
        }),
      },
      indices: addAccessor(new Uint16Array(indices), ELEMENT_ARRAY_BUFFER, {
        componentType: UNSIGNED_SHORT,
        count: indices.length,
        type: 'SCALAR',
      }),
      material: materialIndex,
    };
  });

  const gltf = {
    asset: { version: '2.0', generator: 'iu-skylink build-cabin-model' },
    scene: 0,
    scenes: [{ name: 'SkyLink cabin', nodes: [0] }],
    nodes: [{ name: 'Cabin', mesh: 0 }],
    meshes: [{ name: 'CabinMassing', primitives }],
    materials: materialNames.map((name) => {
      const { color, metallic, roughness, blend } = MATERIALS[name];
      return {
        name,
        pbrMetallicRoughness: {
          baseColorFactor: color,
          metallicFactor: metallic,
          roughnessFactor: roughness,
        },
        ...(blend ? { alphaMode: 'BLEND', doubleSided: true } : {}),
      };
    }),
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }],
  };

  const pad = (buffer, fill) => {
    const padding = (4 - (buffer.length % 4)) % 4;
    return padding ? Buffer.concat([buffer, Buffer.alloc(padding, fill)]) : buffer;
  };
  const json = pad(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const binary = pad(Buffer.concat(chunks), 0);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binary.length, 8);

  const chunkHeader = (length, type) => {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32LE(length, 0);
    buffer.writeUInt32LE(type, 4);
    return buffer;
  };

  return Buffer.concat([
    header,
    chunkHeader(json.length, 0x4e4f534a), // "JSON"
    json,
    chunkHeader(binary.length, 0x004e4942), // "BIN\0"
    binary,
  ]);
}

const glb = buildGlb();
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, glb);
console.log(`Wrote ${OUTPUT} (${(glb.length / 1024).toFixed(1)} kB, ${PARTS.length} parts)`);
