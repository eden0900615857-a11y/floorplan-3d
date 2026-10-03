// 產生 js/models-data.js：把 KayKit Furniture Bits（CC0）的 glTF 家具模型轉成可以直接用 <script> 載入的資料，
// 這樣從電腦直接開 index.html（file://）也能顯示模型。
// 用法：node tools/build-models.js [glTF 資料夾]
// 沒給資料夾時從 GitHub 下載到 tools/.cache。座標壓縮成 16 位元整數，法向量 8 位元，貼圖用 data URL。
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = 'https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0/main/addons/kaykit_furniture_bits/Assets/gltf/';
const TEXTURE = 'furniturebits_texture.png';
// 用到的模型（對應 js/furniture.js 家具庫的 mesh 欄位）
const MODELS = [
  'couch_pillows', 'armchair_pillows', 'table_low', 'bed_double_A', 'bed_single_A', 'cabinet_small',
  'cabinet_medium', 'table_medium', 'chair_A_wood', 'table_medium_long', 'cactus_medium_A',
  'lamp_standing', 'rug_rectangle_A'
];

async function fetchTo(dir, name) {
  const file = path.join(dir, name);
  if (fs.existsSync(file)) return file;
  const res = await fetch(SRC + name);
  if (!res.ok) throw new Error('下載失敗 ' + name + '：' + res.status);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3 };
const TYPES = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array };

function accessor(gltf, bin, i) {
  const a = gltf.accessors[i], v = gltf.bufferViews[a.bufferView];
  const T = TYPES[a.componentType], n = COMPONENTS[a.type];
  if (!T || !n || (v.byteStride && v.byteStride !== n * T.BYTES_PER_ELEMENT)) throw new Error('不支援的 accessor ' + i);
  const off = (v.byteOffset || 0) + (a.byteOffset || 0);
  return { data: new T(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * n * T.BYTES_PER_ELEMENT)), n };
}

function quantize(arr, n, Out, max) {
  const lo = [], hi = [];
  for (let k = 0; k < n; k++) { lo[k] = Infinity; hi[k] = -Infinity; }
  for (let i = 0; i < arr.length; i++) { const k = i % n; lo[k] = Math.min(lo[k], arr[i]); hi[k] = Math.max(hi[k], arr[i]); }
  const out = new Out(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const k = i % n, span = hi[k] - lo[k] || 1;
    out[i] = Math.round((arr[i] - lo[k]) / span * max);
  }
  const r = v => Math.round(v * 1e5) / 1e5;
  return { out, min: lo.map(r), max: hi.map(r) };
}

const b64 = typed => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');

async function main() {
  const dir = process.argv[2] || path.join(__dirname, '.cache');
  fs.mkdirSync(dir, { recursive: true });
  const models = {};
  for (const name of MODELS) {
    const gltf = JSON.parse(fs.readFileSync(await fetchTo(dir, name + '.gltf'), 'utf8'));
    const bin = fs.readFileSync(await fetchTo(dir, gltf.buffers[0].uri));
    if (gltf.meshes.length !== 1 || gltf.meshes[0].primitives.length !== 1) throw new Error(name + '：只支援一個 mesh、一個 primitive');
    const node = gltf.nodes.find(n => n.mesh === 0);
    if (node.translation || node.rotation || node.scale || node.matrix) throw new Error(name + '：不支援節點變換');
    const p = gltf.meshes[0].primitives[0];
    const pos = quantize(accessor(gltf, bin, p.attributes.POSITION).data, 3, Uint16Array, 65535);
    const uv = quantize(accessor(gltf, bin, p.attributes.TEXCOORD_0).data, 2, Uint16Array, 65535);
    const nrm = accessor(gltf, bin, p.attributes.NORMAL).data;
    const nor = Int8Array.from(nrm, v => Math.round(v * 127));
    const idx = Uint16Array.from(accessor(gltf, bin, p.indices).data);
    models[name] = { min: pos.min, max: pos.max, uvMin: uv.min, uvMax: uv.max, pos: b64(pos.out), nor: b64(nor), uv: b64(uv.out), idx: b64(idx) };
  }
  const tex = 'data:image/png;base64,' + fs.readFileSync(await fetchTo(dir, TEXTURE)).toString('base64');
  const data = {
    source: 'KayKit Furniture Bits 1.0 by Kay Lousberg (kaylousberg.com), CC0 1.0',
    texture: tex,
    models
  };
  const js = '// 自動產生，請勿手動修改：node tools/build-models.js\n' +
    '// ' + data.source + '\n' +
    '(function (root, data) {\n' +
    "  if (typeof module === 'object' && module.exports) module.exports = data;\n" +
    '  else root.FP_MODEL_DATA = data;\n' +
    "})(typeof self !== 'undefined' ? self : this, " + JSON.stringify(data) + ');\n';
  const out = path.join(__dirname, '..', 'js', 'models-data.js');
  fs.writeFileSync(out, js);
  console.log('寫入 ' + out + '（' + Math.round(js.length / 1024) + ' KB，' + MODELS.length + ' 個模型）');
}

main().catch(e => { console.error(e.message); process.exit(1); });
