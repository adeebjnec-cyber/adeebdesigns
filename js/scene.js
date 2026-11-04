import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const GOLD = 0xc9a96e;
const BG = 0x0b0a09;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/*
 * The Atelier: a desk at night under a pendant lamp. A plan draws itself
 * on the sheet, the villa rises out of it, gains material in golden-hour sun,
 * glows at dusk, and the camera walks inside.
 * Progress p (0..1) comes from the scroll position of the story section.
 */
export function createScene(canvas, { prints, onLoadProgress, onLoaded, onPrintClick, onProgress }) {
  const isMobile = matchMedia('(max-width: 760px)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // Resolution is the biggest cost: start modest, and step down further on slow
  // devices (see adaptQuality in the loop)
  let dpr = Math.min(devicePixelRatio, isMobile ? 1 : 1.25);
  renderer.setPixelRatio(dpr);
  // Frames are only drawn when something changed; anything that alters the
  // picture outside the loop (a texture arriving, a resize) sets this
  let dirty = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !isMobile;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // re-rendered only when a shadow caster or light moves

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 38, 75);
  // Soft studio reflections for glass, water and metal
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);

  const manager = new THREE.LoadingManager();
  manager.onProgress = (_, loaded, total) => onLoadProgress?.(loaded / total);
  manager.onLoad = () => onLoaded?.();
  const loader = new THREE.TextureLoader(manager);

  /* ---------- Desk ---------- */
  const desk = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 40),
    new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.42, metalness: 0.05, envMapIntensity: 0.25 })
  );
  desk.rotation.x = -Math.PI / 2;
  desk.receiveShadow = true;
  scene.add(desk);

  const SHEET_W = 19, SHEET_D = 13;
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(SHEET_W, SHEET_D),
    new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.95, envMapIntensity: 0.1 })
  );
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.y = 0.01;
  sheet.receiveShadow = true;
  scene.add(sheet);

  /* ---------- Model (rises from the plan) ---------- */
  const model = new THREE.Group();
  model.position.y = 0.02;
  model.visible = false;
  scene.add(model);

  // Graphite linework so the rising wireframe reads like the ink plan on white paper
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x1c1c1c, transparent: true, opacity: 1 });
  const std = (o) => new THREE.MeshStandardMaterial({ transparent: true, opacity: 0, ...o });
  const mats = {
    solid: std({ color: 0xe2ded6, roughness: 0.88, envMapIntensity: 0.3 }),
    stone: std({ color: 0xb8a891, map: stoneTexture(), roughness: 0.92, envMapIntensity: 0.25 }),
    timber: std({ color: 0x7a4e30, roughness: 0.55, envMapIntensity: 0.3 }),
    panel: std({ color: 0x2e2118, roughness: 0.55, envMapIntensity: 0.15 }),
    metal: std({ color: 0x2c2620, metalness: 0.85, roughness: 0.35, envMapIntensity: 0.9 }),
    fabric: std({ color: 0xd3c9b8, roughness: 1, envMapIntensity: 0.15 }),
    green: std({ color: 0x55633f, roughness: 0.9, flatShading: true, envMapIntensity: 0.2 }),
    glass: std({ color: 0x0e0d0b, emissive: 0xffa94d, emissiveIntensity: 0, roughness: 0.04, metalness: 0.6, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4 }),
    water: std({ color: 0x0f363c, emissive: 0x2a7f86, emissiveIntensity: 0, roughness: 0.05, metalness: 0.2, envMapIntensity: 1.4 }),
    light: std({ color: 0x1a1612, emissive: 0xffc27a, emissiveIntensity: 0 }),
  };
  const fading = Object.values(mats).filter((m) => m !== mats.glass);

  const shadowCasters = [];
  function add(geo, x, y, z, kind, { edges = true, rotY = 0 } = {}) {
    const mesh = new THREE.Mesh(geo, mats[kind]);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.receiveShadow = true;
    if (kind !== 'glass' && kind !== 'light' && kind !== 'water') shadowCasters.push(mesh);
    model.add(mesh);
    if (edges) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edgeMat);
      e.position.copy(mesh.position);
      e.rotation.copy(mesh.rotation);
      model.add(e);
    }
    return mesh;
  }
  // Boxes are placed by their bottom face, like a plan extruded upwards
  function box(w, h, d, x, y, z, kind, opts) {
    return add(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, kind, opts);
  }

  // Ground: stone plinth, entry steps, timber deck, pool with coping
  box(14, 0.15, 9, 1, 0, 0.2, 'stone');
  box(3, 0.1, 0.35, -2.6, 0, 4.88, 'stone');
  box(3, 0.05, 0.35, -2.6, 0, 5.23, 'stone');
  box(4.2, 0.04, 2, -2.6, 0.15, 3.65, 'timber');
  for (let x = -4.5; x <= -0.6; x += 0.3) box(0.012, 0.005, 2, x, 0.19, 3.65, 'metal', { edges: false });
  box(5.4, 0.04, 2.1, 4.2, 0.15, 3.55, 'stone');
  box(5, 0.03, 1.7, 4.2, 0.175, 3.55, 'water');

  // Glazed living room, with furniture you can see through the glass
  box(7, 1.5, 4.5, -1.5, 0.15, 0.3, 'glass');
  box(1.8, 0.16, 0.7, -3.8, 0.15, -0.9, 'fabric');
  box(1.8, 0.34, 0.16, -3.8, 0.15, -1.3, 'fabric');
  box(0.8, 0.12, 0.5, -3.8, 0.15, 0.05, 'timber');
  box(1.2, 0.04, 0.6, 0.6, 0.6, -0.6, 'timber');
  box(0.08, 0.45, 0.08, 0.6, 0.15, -0.6, 'metal', { edges: false });
  box(0.025, 1.05, 0.025, -4.7, 0.15, 0.2, 'metal', { edges: false });
  box(0.16, 0.16, 0.16, -4.7, 1.2, 0.2, 'light', { edges: false });

  // Kitchen block with a bronze entrance door on its east side, under the cantilever
  box(2.6, 1.5, 4.5, 3.3, 0.15, 0.3, 'stone');
  box(0.03, 1.15, 0.9, 4.615, 0.15, 0.45, 'metal');

  // Stair core with a vertical slot window
  box(1.4, 3.3, 1.4, -4.4, 0.15, -1.5, 'stone');
  box(0.28, 2.4, 0.03, -4.4, 0.5, -0.785, 'glass');

  // Upper volume: plaster box cantilevering east, glazed band behind timber fins
  box(10, 1.35, 4.1, 2, 1.65, -0.5, 'solid');
  box(9.4, 0.85, 0.03, 2, 1.9, 1.565, 'glass');
  for (let x = -2.7; x <= 6.75; x += 0.35) box(0.05, 1.15, 0.16, x, 1.75, 1.66, 'timber');
  // Downlights under the cantilever
  for (const z of [-1.6, 0, 1.2]) box(0.14, 0.01, 0.14, 6.1, 1.635, z, 'light', { edges: false });

  // Roof slab with bronze fascia and a glass balustrade
  box(10.8, 0.14, 5, 2, 3.0, -0.35, 'solid');
  box(10.8, 0.05, 0.03, 2, 2.98, 2.165, 'metal', { edges: false });
  box(10.4, 0.35, 0.02, 2, 3.14, 1.95, 'glass');

  // Steel columns under the cantilever
  box(0.12, 1.5, 0.12, 6.7, 0.15, 1.3, 'metal');
  box(0.12, 1.5, 0.12, 6.7, 0.15, -2.3, 'metal');

  // Garden bollards along the deck and pool
  const BOLLARDS = [[-4.9, 4.55], [-0.3, 4.55], [1.3, 4.5], [7.2, 4.5]];
  for (const [x, z] of BOLLARDS) box(0.07, 0.3, 0.07, x, 0.15, z, 'light', { edges: false });

  // Low-poly trees
  const TREES = [[-6.3, 3.4, 1], [7.5, -3.4, 1.2], [-6.4, -3.4, 0.85], [7.4, 3.8, 0.7]];
  for (const [x, z, s] of TREES) {
    add(new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 1.2 * s, 6), x, 0.15 + 0.6 * s, z, 'timber');
    add(new THREE.IcosahedronGeometry(0.75 * s, 0), x, 0.15 + 1.45 * s, z, 'green', { rotY: x });
  }

  // Mullions on the glazed living room
  const mull = [];
  for (let x = -5; x <= 2.01; x += 0.875) mull.push(x, 0.15, 2.56, x, 1.65, 2.56);
  mull.push(-5, 0.95, 2.56, 2, 0.95, 2.56);
  const mullGeo = new THREE.BufferGeometry();
  mullGeo.setAttribute('position', new THREE.Float32BufferAttribute(mull, 3));
  model.add(new THREE.LineSegments(mullGeo, edgeMat));

  // Back wall of the living room with a window pouring warm light into the room.
  // The camera walks towards it until the light blinds the screen.
  const WX = -1.5, WZ = -1.9, WY0 = 0.3, WY1 = 1.4, WW = 0.9, WYC = (WY0 + WY1) / 2;
  box(1.05, 1.5, 0.1, WX - WW / 2 - 0.525, 0.15, WZ, 'panel');
  box(1.05, 1.5, 0.1, WX + WW / 2 + 0.525, 0.15, WZ, 'panel');
  box(WW, WY0 - 0.15, 0.1, WX, 0.15, WZ, 'panel');
  box(WW, 1.65 - WY1, 0.1, WX, WY1, WZ, 'panel');
  box(0.025, WY1 - WY0, 0.03, WX, WY0, WZ, 'metal', { edges: false });
  box(WW, 0.025, 0.03, WX, WYC + 0.12, WZ, 'metal', { edges: false });
  const windowMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const windowPane = new THREE.Mesh(new THREE.PlaneGeometry(WW, WY1 - WY0), windowMat);
  windowPane.position.set(WX, WYC, WZ - 0.03);
  model.add(windowPane);
  const windowGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  windowGlow.position.set(WX, WYC, WZ + 0.08);
  model.add(windowGlow);
  // Light shaft: an open cone fading away from the window, falling towards the floor
  const shaftGeo = new THREE.CylinderGeometry(0.5, 1.0, 3.2, 32, 1, true);
  shaftGeo.translate(0, -1.6, 0);
  const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTexture(), color: 0xffd6a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.position.set(WX, WYC, WZ + 0.05);
  shaft.quaternion.setFromUnitVectors(V(0, -1, 0), V(0, -0.55, 1).normalize());
  model.add(shaft);

  /* ---------- Plan (draws itself) ---------- */
  // A working drawing of the villa's ground floor, at the same coordinates as the
  // model. The ink linework draws in first; poché, labels and dimensions fade in
  // afterwards from a canvas layer (see drawAnnotations).
  const planSegs = [];
  const seg = (x1, z1, x2, z2) => planSegs.push([x1, z1, x2, z2]);
  const rect = (x1, z1, x2, z2) => { seg(x1, z1, x2, z1); seg(x2, z1, x2, z2); seg(x2, z2, x1, z2); seg(x1, z2, x1, z1); };
  const arc = (cx, cz, r, a0 = 0, a1 = Math.PI * 2, n = 20, wobble = 0) => {
    const at = (t) => r * (1 + wobble * Math.sin(t * 9));
    for (let i = 0; i < n; i++) {
      const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n;
      seg(cx + Math.cos(t0) * at(t0), cz + Math.sin(t0) * at(t0), cx + Math.cos(t1) * at(t1), cz + Math.sin(t1) * at(t1));
    }
  };
  const dashed = (x1, z1, x2, z2, on = 0.3, off = 0.12) => {
    const len = Math.hypot(x2 - x1, z2 - z1), dx = (x2 - x1) / len, dz = (z2 - z1) / len;
    for (let d = 0; d < len; d += on + off) {
      const e = Math.min(len, d + on);
      seg(x1 + dx * d, z1 + dz * d, x1 + dx * e, z1 + dz * e);
    }
  };

  // Sheet frame and title block strip
  rect(-9.1, -6.1, 9.1, 6.1);
  rect(1.5, 5.3, 9.1, 6.1);
  seg(5.2, 5.3, 5.2, 6.1); seg(7.4, 5.3, 7.4, 6.1);

  // Structural grid with bubbles and dimension strings
  const GX = [-5, -1.5, 2, 4.6, 6.7], GZ = [-1.95, 2.55];
  for (const x of GX) { dashed(x, -4.75, x, 4.9, 0.5, 0.15); arc(x, -5.05, 0.25, 0, Math.PI * 2, 16); }
  for (const z of GZ) { dashed(-7.3, z, 8.4, z, 0.5, 0.15); arc(-7.6, z, 0.25, 0, Math.PI * 2, 16); }
  seg(GX[0], -4.5, GX[GX.length - 1], -4.5);
  for (const x of GX) seg(x - 0.08, -4.42, x + 0.08, -4.58);
  seg(-6.9, GZ[0], -6.9, GZ[1]);
  for (const z of GZ) seg(-6.98, z - 0.08, -6.82, z + 0.08);

  // Terrace edge, entry steps, and the upper floor above (dashed)
  rect(-6, -4.3, 8, 4.7);
  rect(-4.1, 4.7, -1.1, 4.95); rect(-4.1, 4.95, -1.1, 5.2);
  dashed(-3, -2.55, 7, -2.55, 0.2, 0.12); dashed(7, -2.55, 7, 1.55, 0.2, 0.12);
  dashed(7, 1.55, -3, 1.55, 0.2, 0.12); dashed(-3, 1.55, -3, -2.55, 0.2, 0.12);

  // Cut walls (filled black in the annotation layer), with openings
  const walls = [
    [-3.7, -2.025, -1.95, -1.875], [-1.05, -2.025, 2.075, -1.875],   // living back wall, window gap
    [1.925, -1.875, 2.075, 0.2], [1.925, 1.1, 2.075, 2.475],         // partition, door gap
    [2.075, -2.025, 4.675, -1.875], [2.075, 2.475, 4.675, 2.625],    // kitchen north, south
    [4.525, -1.875, 4.675, 0], [4.525, 0.9, 4.675, 2.475],           // kitchen east, entrance gap
    [-5.1, -2.2, -3.7, -2.05], [-5.1, -0.95, -3.7, -0.8],            // stair core
    [-5.1, -2.05, -4.95, -0.95], [-3.85, -2.05, -3.7, -1.55],
  ];
  walls.forEach((w) => rect(...w));
  // Glazing on the living room's front and west side, with mullions
  for (const z of [2.51, 2.59]) seg(-5, z, 1.925, z);
  for (const x of [-5.04, -4.96]) seg(x, -0.8, x, 2.59);
  for (let x = -5; x <= 2; x += 0.875) seg(x, 2.47, x, 2.63);
  // The back window the camera walks towards
  for (const z of [-2.025, -1.95, -1.875]) seg(-1.95, z, -1.05, z);
  // Doors and their swings
  seg(2, 0.2, 1.1, 0.2); arc(2, 0.2, 0.9, Math.PI / 2, Math.PI, 12);
  seg(4.6, 0, 3.7, 0); arc(4.6, 0, 0.9, Math.PI / 2, Math.PI, 12);
  // Stair: two flights with an up arrow
  seg(-4.4, -2.05, -4.4, -0.95);
  for (let z = -1.95; z < -1; z += 0.15) { seg(-4.95, z, -4.45, z); seg(-4.35, z, -3.85, z); }
  seg(-4.7, -1.1, -4.7, -1.9); seg(-4.7, -1.9, -4.8, -1.75); seg(-4.7, -1.9, -4.6, -1.75);

  // Furniture
  rect(-4.7, -1.38, -2.9, -0.55); seg(-4.7, -1.22, -2.9, -1.22);   // sofa
  rect(-4.85, -0.45, -2.6, 0.75);                                    // rug
  rect(-4.2, -0.2, -3.4, 0.3);                                       // coffee table
  arc(-4.7, 0.2, 0.12, 0, Math.PI * 2, 10);                          // floor lamp
  rect(0, -0.9, 1.2, -0.3);                                          // dining table + chairs
  for (const x of [0.2, 0.6, 1]) { rect(x - 0.15, -1.2, x + 0.15, -0.95); rect(x - 0.15, -0.25, x + 0.15, 0); }
  rect(2.1, -1.85, 4.5, -1.3);                                       // kitchen counter, sink, hob
  rect(2.8, -1.75, 3.4, -1.42);
  for (const x of [3.8, 4.2]) for (const z of [-1.7, -1.45]) arc(x, z, 0.09, 0, Math.PI * 2, 8);
  rect(2.4, 0.3, 3.6, 1);                                            // island

  // Outside: deck boards, pool with steps, columns, trees, garden lights
  rect(-4.7, 2.65, -0.5, 4.65);
  for (let x = -4.4; x < -0.5; x += 0.3) seg(x, 2.65, x, 4.65);
  rect(1.5, 2.5, 6.9, 4.6); rect(1.7, 2.7, 6.7, 4.4);
  for (const x of [1.95, 2.2, 2.45]) seg(x, 2.7, x, 3.3);
  for (const [x, z] of [[6.7, 1.3], [6.7, -2.3]]) { rect(x - 0.08, z - 0.08, x + 0.08, z + 0.08); seg(x - 0.08, z - 0.08, x + 0.08, z + 0.08); }
  for (const [x, z, s] of TREES) { arc(x, z, 0.75 * s, 0, Math.PI * 2, 36, 0.08); seg(x - 0.12, z, x + 0.12, z); seg(x, z - 0.12, x, z + 0.12); }
  for (const [x, z] of BOLLARDS) arc(x, z, 0.07, 0, Math.PI * 2, 8);

  // North arrow
  arc(-8.1, 4.9, 0.5, 0, Math.PI * 2, 24);
  seg(-8.1, 5.35, -8.1, 4.45); seg(-8.1, 4.45, -8.28, 4.8); seg(-8.1, 4.45, -7.92, 4.8);

  // Annotation layer: poché, water, room names, dimensions, title block
  const annoCanvas = document.createElement('canvas');
  annoCanvas.width = 2048;
  annoCanvas.height = Math.round(2048 * SHEET_D / SHEET_W);
  const annoTex = new THREE.CanvasTexture(annoCanvas);
  annoTex.colorSpace = THREE.SRGBColorSpace;
  annoTex.anisotropy = 8;
  function drawAnnotations() {
    const g = annoCanvas.getContext('2d'), W = annoCanvas.width, H = annoCanvas.height, k = W / SHEET_W;
    const px = (x, z) => [(x + SHEET_W / 2) * k, (z + SHEET_D / 2) / SHEET_D * H];
    const fill = (x1, z1, x2, z2) => { const [a, b] = px(x1, z1); g.fillRect(a, b, (x2 - x1) * k, (z2 - z1) * k); };
    const text = (s, x, z, size, { weight = 500, font = 'Manrope', style = 'normal', align = 'center', rotate = 0, spacing = 0.12 } = {}) => {
      const [a, b] = px(x, z);
      g.save();
      g.translate(a, b);
      g.rotate(rotate);
      g.font = `${style} ${weight} ${size * k}px "${font}", Arial, sans-serif`;
      g.letterSpacing = `${size * k * spacing}px`;
      g.textAlign = align;
      g.fillText(s, 0, 0);
      g.restore();
    };
    g.clearRect(0, 0, W, H);
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(126,170,184,.22)';
    fill(1.7, 2.7, 6.7, 4.4);
    g.fillStyle = '#141414';
    walls.forEach((w) => fill(...w));
    for (const [x, z] of [[6.7, 1.3], [6.7, -2.3]]) fill(x - 0.08, z - 0.08, x + 0.08, z + 0.08);

    text('LIVING / DINING', -1.5, 0.95, 0.3);
    text('31.5 m²', -1.5, 1.35, 0.18, { weight: 400 });
    text('KITCHEN', 3.3, 1.6, 0.26);
    text('11.7 m²', 3.3, 1.97, 0.18, { weight: 400 });
    text('UP', -4.7, -0.98, 0.1, { weight: 600 });
    text('TERRACE', -2.6, 4.3, 0.24);
    text('POOL', 4.2, 3.6, 0.26);
    text('ENTRY', 5.65, 0.45, 0.2);
    text('▸', 5.05, 0.45, 0.16);
    GX.forEach((x, i) => text(String(i + 1), x, -5.04, 0.24, { weight: 600, spacing: 0 }));
    GZ.forEach((z, i) => text('AB'[i], -7.6, z + 0.01, 0.24, { weight: 600, spacing: 0 }));
    GX.slice(1).forEach((x, i) => text(String(Math.round((x - GX[i]) * 1000)), (x + GX[i]) / 2, -4.66, 0.15, { weight: 400, spacing: 0.05 }));
    text(String(Math.round((GZ[1] - GZ[0]) * 1000)), -7.06, (GZ[0] + GZ[1]) / 2, 0.15, { weight: 400, spacing: 0.05, rotate: -Math.PI / 2 });
    text('N', -8.1, 4.15, 0.22, { weight: 600, spacing: 0 });
    text('ALL DIMENSIONS IN MM', -8.8, 5.85, 0.11, { weight: 400, align: 'left' });

    text('PRIVATE VILLA', 3.35, 5.58, 0.3, { weight: 600 });
    text('GROUND FLOOR PLAN', 3.35, 5.88, 0.13, { weight: 400 });
    text('SCALE 1:100', 6.3, 5.58, 0.14);
    text('DWG  A-101', 6.3, 5.88, 0.13, { weight: 400 });
    text('3D Visualization', 8.25, 5.56, 0.2, { weight: 500, font: 'Cormorant Garamond', spacing: 0 });
    text('By Adeeb', 8.25, 5.86, 0.2, { weight: 400, font: 'Cormorant Garamond', style: 'italic', spacing: 0 });
    annoTex.needsUpdate = true;
  }
  drawAnnotations();
  document.fonts?.ready.then(() => { drawAnnotations(); dirty = true; });
  const annoMat = new THREE.MeshBasicMaterial({ map: annoTex, transparent: true, opacity: 0, depthWrite: false });
  const anno = new THREE.Mesh(new THREE.PlaneGeometry(SHEET_W, SHEET_D), annoMat);
  anno.rotation.x = -Math.PI / 2;
  anno.position.y = 0.015;
  scene.add(anno);

  const planPos = new Float32Array(planSegs.length * 6);
  planSegs.forEach(([x1, z1, x2, z2], i) => planPos.set([x1, 0, z1, x2, 0, z2], i * 6));
  const planGeo = new THREE.BufferGeometry();
  planGeo.setAttribute('position', new THREE.BufferAttribute(planPos, 3));
  // Ink drawing: black linework on white paper
  const planMat = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.9 });
  const plan = new THREE.LineSegments(planGeo, planMat);
  plan.position.y = 0.02;
  planGeo.setDrawRange(0, 0);
  scene.add(plan);
  const planCount = planSegs.length * 2;

  /* ---------- Pendant lamp over the desk (the night light source) ---------- */
  // The intro's gold "A" morphs into this shade, so its size and the intro camera
  // distance are matched to the SVG in the gate (see INTRO_POS and .gate__mark).
  const bronze = new THREE.MeshStandardMaterial({ color: 0x2a2420, metalness: 0.9, roughness: 0.32, envMapIntensity: 0.8 });
  const brass = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.3, envMapIntensity: 0.8 });
  const lampRig = new THREE.Group();
  scene.add(lampRig);
  const SHADE = V(0, 8.5, -3);
  const aim = V(0, 0, 0.6);
  const part = (mesh, at) => { mesh.position.copy(at); lampRig.add(mesh); return mesh; };
  const shadeGeo = new THREE.ConeGeometry(0.95, 1.3, 48, 1, true);
  part(new THREE.Mesh(shadeGeo, bronze), SHADE);
  const shadeInnerMat = new THREE.MeshStandardMaterial({ color: 0x2e2620, emissive: 0xffc98a, emissiveIntensity: 0.9, side: THREE.BackSide, roughness: 0.8 });
  part(new THREE.Mesh(shadeGeo, shadeInnerMat), SHADE).scale.setScalar(0.97);
  part(new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.025, 8, 64), brass), SHADE.clone().add(V(0, -0.65, 0))).rotation.x = Math.PI / 2;
  part(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.2, 24), brass), SHADE.clone().add(V(0, 0.72, 0)));
  part(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 40, 8), bronze), SHADE.clone().add(V(0, 20.8, 0)));
  const bulbPos = SHADE.clone().add(V(0, -0.3, 0));
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff3dc });
  part(new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 16), bulbMat), bulbPos);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc98a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  part(glow, SHADE.clone().add(V(0, -0.8, 0))).scale.setScalar(3.5);

  /* ---------- Lights ---------- */
  const hemi = new THREE.HemisphereLight(0xffe9cc, 0x0b0a09, 0.2);
  scene.add(hemi);
  const lamp = new THREE.SpotLight(0xffc98a, 4, 0, 0.85, 0.6, 0);
  lamp.position.copy(bulbPos);
  lamp.target.position.copy(aim);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.bias = -0.0004;
  lamp.shadow.camera.near = 0.5;
  scene.add(lamp, lamp.target);
  // Low fill so the prints at the desk edges stay readable
  const fill = new THREE.SpotLight(0xffe2bd, 0.7, 0, 0.9, 1, 0);
  fill.position.set(2, 20, 10);
  scene.add(fill, fill.target);
  // Golden-hour sun: low and raking, turning amber towards dusk
  const sun = new THREE.DirectionalLight(0xfff0dc, 0);
  sun.position.set(14, 7, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 50 });
  scene.add(sun);
  const sunDay = new THREE.Color(0xfff0dc), sunDusk = new THREE.Color(0xff9a52);
  const roomLight = new THREE.PointLight(0xffb066, 0, 7, 1.2);
  roomLight.position.set(-2.8, 1.35, 0.6);
  // Light pouring in through the back window: aimed into the room so the wall
  // around the window stays dark and the opening reads as the light source
  const windowLight = new THREE.SpotLight(0xffd29a, 0, 9, 0.95, 0.6, 1.2);
  windowLight.position.set(WX, WYC + 0.02, WZ + 0.1);
  windowLight.target.position.set(WX, 0.15, 2);
  scene.add(windowLight, windowLight.target);
  const eaveLight = new THREE.PointLight(0xffc27a, 0, 5, 1.5);
  eaveLight.position.set(6.1, 1.4, 0);
  scene.add(roomLight, eaveLight);
  const bgNight = new THREE.Color(BG), bgDusk = new THREE.Color(0x15100c);

  /* ---------- Prints on the desk ---------- */
  const printSpots = [[-12.4, -4.4, 0.14], [12.3, -4.5, -0.12], [-12.9, 0.2, -0.06], [12.8, 0, 0.09], [-12.2, 4.7, -0.1], [12.4, 4.6, 0.06]];
  const printMeshes = [];
  const printGroups = prints.slice(0, printSpots.length).map((p, i) => {
    const [x, z, r] = printSpots[i];
    const g = new THREE.Group();
    g.position.set(x, 0.03 + i * 0.004, z);
    g.rotation.y = r;
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xf3eee6, roughness: 0.8, envMapIntensity: 0.15 }));
    const img = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.6, envMapIntensity: 0.15 }));
    paper.rotation.x = img.rotation.x = -Math.PI / 2;
    img.position.y = 0.005;
    paper.castShadow = true;
    img.material.map = loadTex(p.image, (t) => {
      const a = t.image.width / t.image.height;
      const w = a >= 1 ? 3.4 : 2.3 * a, h = a >= 1 ? 3.4 / a : 2.3;
      img.scale.set(w, h, 1);
      paper.scale.set(w + 0.24, h + 0.5, 1);
      paper.position.z = 0.13;
    });
    img.userData.slug = p.slug;
    printMeshes.push(img);
    g.add(paper, img);
    g.userData = { baseY: g.position.y, lift: 0 };
    scene.add(g);
    return g;
  });

  // Props: pencil and scale ruler
  const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), brass);
  pencil.rotation.set(Math.PI / 2, 0, 0.9);
  pencil.position.set(8.4, 0.08, 7.6);
  pencil.castShadow = true;
  const ruler = new THREE.Mesh(new THREE.BoxGeometry(5, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.5, envMapIntensity: 0.2 }));
  ruler.position.set(-6.5, 0.04, 7.4);
  ruler.rotation.y = 0.12;
  ruler.castShadow = true;
  scene.add(pencil, ruler);

  /* ---------- Camera path ---------- */
  // [progress, position, target]
  const keys = [
    [0.00, [0, 24, 7], [0, 0, 0.6]],
    [0.20, [7, 14, 14], [0, 0.4, 0]],
    [0.40, [15, 6.5, 10], [1.2, 1.3, 0]],
    [0.64, [-10, 5.5, 15], [1, 1.3, 0]],
    [0.76, [-1.5, 1.0, 7], [-1.5, 0.85, -1.9]],
    // The camera reaches the window here; the rest of the scroll is the slow reveal
    [0.88, [-1.5, 0.85, -1.5], [-1.5, 0.85, -3]],
  ];
  let posCurve, tgtCurve;
  function buildPath() {
    // Pull the camera back on tall/narrow screens so the model still fits
    const k = clamp(1.3 / camera.aspect, 1, 2.1);
    const pos = keys.map(([, p, t], i) => {
      const v = V(...p), tv = V(...t);
      return i < 4 ? tv.clone().add(v.sub(tv).multiplyScalar(k)) : v;
    });
    posCurve = new THREE.CatmullRomCurve3(pos, false, 'centripetal');
    tgtCurve = new THREE.CatmullRomCurve3(keys.map(([, , t]) => V(...t)), false, 'centripetal');
  }
  const pathT = (p) => {
    for (let i = 0; i < keys.length - 1; i++) {
      const [a] = keys[i], [b] = keys[i + 1];
      if (p <= b) return (i + (p - a) / (b - a)) / (keys.length - 1);
    }
    return 1;
  };

  /* ---------- State, input, loop ---------- */
  let target = 0, p = 0, planDraw = 0, started = false, active = true, introT = 0;
  // Intro shot: level with the shade, 11 units away, so the cone fills 16.2% of
  // the screen height (1.3 / (2 * 11 * tan 20°)), the same as the SVG "A" lamp
  const INTRO_POS = SHADE.clone().add(V(0, 0, 11));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const mouse = new THREE.Vector2(), smoothMouse = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  let hovered = null;
  const tmpPos = new THREE.Vector3(), tmpTgt = new THREE.Vector3();

  let mouseMoved = false;
  addEventListener('pointermove', (e) => {
    mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    mouseMoved = true;
  });
  // The story overlay has pointer-events: none, so clicks reach the canvas
  canvas.addEventListener('click', () => { if (hovered) onPrintClick?.(hovered.userData.slug); });

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    buildPath();
    dirty = true;
  }
  addEventListener('resize', resize);
  resize();

  const clock = new THREE.Clock();
  let slowFrames = 0, shadowKey = '', hoverOn = false;
  function frame() {
    requestAnimationFrame(frame);
    if (!active) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    if (tick(dt)) adaptQuality(dt);
  }
  // On a device that can't hold ~40fps, lower the resolution a step at a time
  function adaptQuality(dt) {
    slowFrames = dt > 1 / 40 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 45 && dpr > 0.75) {
      dpr = Math.max(0.75, dpr - 0.25);
      renderer.setPixelRatio(dpr);
      slowFrames = 0;
      dirty = true;
    }
  }
  // Updates the scene for this frame; returns false (and draws nothing) when
  // nothing on screen would change
  function tick(dt) {
    const pPrev = p, mx = smoothMouse.x, my = smoothMouse.y;
    p = lerp(p, target, 1 - Math.pow(0.0015, dt));
    if (Math.abs(target - p) < 1e-5) p = target;
    smoothMouse.lerp(mouse, 1 - Math.pow(0.02, dt));
    let changed = p !== pPrev || Math.abs(smoothMouse.x - mx) + Math.abs(smoothMouse.y - my) > 1e-5;

    // After the gate: crane up from the lamp onto the desk, then the plan draws
    if (started && introT < 1) { introT = Math.min(1, introT + dt / 3.4); changed = true; }
    if (introT > 0.6 && planDraw < 1) { planDraw = Math.min(1, planDraw + dt / 3.2); changed = true; }

    // Hover-lift the prints while the desk is in view (raycast only when the mouse moves)
    if (p >= 0.1 || introT < 1) hovered = null;
    else if (mouseMoved || p !== pPrev) {
      ray.setFromCamera(mouse, camera);
      hovered = ray.intersectObjects(printMeshes)[0]?.object ?? null;
    }
    mouseMoved = false;
    if (hoverOn !== !!hovered) document.body.classList.toggle('is-hovering-print', (hoverOn = !!hovered));
    let lifts = 0;
    printGroups.forEach((g, i) => {
      const goal = hovered === printMeshes[i] ? 1 : 0;
      const lift = lerp(g.userData.lift, goal, 1 - Math.pow(0.001, dt));
      g.userData.lift = Math.abs(goal - lift) < 1e-3 ? goal : lift;
      if (g.userData.lift !== goal) changed = true;
      g.position.y = g.userData.baseY + g.userData.lift * 0.6;
      lifts += g.userData.lift;
    });

    if (!changed && !dirty) return false;
    dirty = false;

    const draw = Math.max(planDraw, smooth(0, 0.1, p));
    planGeo.setDrawRange(0, Math.floor(draw * planCount / 2) * 2);

    const rise = smooth(0.12, 0.36, p);
    const material = smooth(0.42, 0.6, p);
    const dusk = smooth(0.56, 0.8, p);
    model.visible = rise > 0.001;
    model.scale.y = Math.max(0.001, rise);
    planMat.opacity = 0.9 - 0.6 * material;
    annoMat.opacity = smooth(0.75, 1, draw) * (1 - 0.65 * material);
    edgeMat.opacity = 1 - 0.8 * material;
    for (const m of fading) {
      m.opacity = material;
      m.transparent = material < 0.99;
      m.depthWrite = material > 0.5;
    }
    mats.glass.opacity = 0.1 + 0.2 * material;
    mats.glass.emissiveIntensity = 0.14 * dusk;
    mats.water.emissiveIntensity = 0.35 * dusk;
    mats.light.emissiveIntensity = 3 * dusk;
    shadowCasters.forEach((m) => (m.castShadow = material > 0.4));

    // Night desk lamp -> golden-hour sun -> dusk with the house lit from inside
    const lampOn = 1 - 0.85 * material;
    lamp.intensity = 4.5 * lampOn;
    fill.intensity = 0.6 * (1 - 0.5 * material);
    // Once the camera leaves the desk the bulb faces it: keep it from blowing out
    const bulbDim = lampOn * (1 - 0.7 * smooth(0.08, 0.3, p));
    shadeInnerMat.emissiveIntensity = 0.9 * bulbDim;
    bulbMat.color.setRGB(1, 0.95, 0.86).multiplyScalar(0.2 + 0.8 * bulbDim);
    glow.material.opacity = 0.55 * bulbDim;
    sun.intensity = 1.6 * material * (1 - 0.5 * dusk);
    sun.color.lerpColors(sunDay, sunDusk, dusk);
    sun.position.set(14, lerp(7, 3.5, dusk), 9);
    hemi.intensity = 0.2 + 0.25 * material;
    // The window glows at dusk and burns brighter as the camera closes in
    const near = smooth(0.74, 0.87, p);
    windowMat.color.setRGB(1, 0.8, 0.55).multiplyScalar(0.25 + 1.1 * dusk + 4 * near);
    windowGlow.material.opacity = 0.75 * dusk + 0.25 * near;
    windowGlow.scale.setScalar(2.2 + 5 * near);
    shaftMat.opacity = 0.22 * dusk + 0.4 * near;
    roomLight.intensity = 3 * dusk;
    windowLight.intensity = 4 * dusk + 16 * near;
    renderer.toneMappingExposure = 1 + 2.5 * smooth(0.77, 0.87, p);
    eaveLight.intensity = 2.5 * dusk;
    scene.background.lerpColors(bgNight, bgDusk, material * (1 - 0.6 * dusk));
    scene.fog.color.copy(scene.background);
    if (p !== pPrev) onProgress?.(p);

    // Shadow maps depend on lights and casters, not the camera: re-render them
    // only when the model rises, a print lifts, the sun moves or shadows switch on
    const key = `${rise.toFixed(3)}|${dusk.toFixed(3)}|${material > 0.4}|${lifts.toFixed(3)}`;
    if (key !== shadowKey) { shadowKey = key; renderer.shadowMap.needsUpdate = true; }

    const t = pathT(p);
    posCurve.getPoint(t, tmpPos);
    tgtCurve.getPoint(t, tmpTgt);
    const crane = easeInOut(introT);
    tmpPos.lerpVectors(INTRO_POS, tmpPos, crane);
    tmpTgt.lerpVectors(SHADE, tmpTgt, crane);
    const sway = (1 - smooth(0.7, 0.88, p)) * crane;
    tmpPos.x += smoothMouse.x * 0.8 * sway;
    tmpPos.y += smoothMouse.y * 0.4 * sway;
    camera.position.copy(tmpPos);
    camera.lookAt(tmpTgt);
    renderer.render(scene, camera);
    return true;
  }
  frame();

  function loadTex(url, cb) {
    return loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; cb?.(t); dirty = true; });
  }

  return {
    start() { started = true; },
    setProgress(v) { target = clamp(v); },
    setActive(v) {
      if (v === active) return;
      active = v;
      dirty = true;
      canvas.style.visibility = v ? 'visible' : 'hidden';
    },
  };
}

function canvasTexture(size, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function woodTexture() {
  // Walnut planks: warm base, flowing grain, plank seams
  return canvasTexture(1024, (g, s) => {
    const planks = 4, ph = s / planks;
    for (let k = 0; k < planks; k++) {
      const tone = 0.85 + Math.random() * 0.25;
      g.fillStyle = `rgb(${Math.round(104 * tone)},${Math.round(68 * tone)},${Math.round(42 * tone)})`;
      g.fillRect(0, k * ph, s, ph);
    }
    for (let i = 0; i < 420; i++) {
      const y = Math.random() * s;
      g.strokeStyle = Math.random() < 0.6 ? `rgba(35,18,8,${Math.random() * 0.35})` : `rgba(170,120,75,${Math.random() * 0.22})`;
      g.lineWidth = Math.random() * 2.5 + 0.4;
      g.beginPath();
      for (let x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin(x * 0.006 + i) * 7 + Math.sin(x * 0.03 + i * 3) * 1.2);
      g.stroke();
    }
    g.fillStyle = 'rgba(20,10,4,.7)';
    for (let k = 0; k < planks; k++) g.fillRect(0, k * ph, s, 2);
  }, [2.5, 1.6]);
}

// Coursed limestone: staggered blocks with slight tone variation
function stoneTexture() {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#cfc4b3';
    g.fillRect(0, 0, s, s);
    const rows = 8, rh = s / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -rh * 1.2 : 0;
      while (x < s) {
        const w = rh * (1.8 + Math.random() * 1.6), v = 200 + Math.random() * 14;
        g.fillStyle = `rgb(${v},${v - 10},${v - 24})`;
        g.fillRect(x + 1, r * rh + 1, w - 2, rh - 2);
        x += w;
      }
    }
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  }, [3, 1.5]);
}

// Vertical fade for the light shaft: bright at the window, gone at the far end
function shaftTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,240,215,1)');
  grad.addColorStop(0.25, 'rgba(255,200,140,.35)');
  grad.addColorStop(1, 'rgba(255,180,110,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
