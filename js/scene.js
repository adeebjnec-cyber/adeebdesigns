import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const GOLD = 0xc9a96e;
const BG = 0x0b0a09;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/*
 * The Atelier: a desk at night under a pendant lamp. The Riyora salon's floor plan
 * draws itself on the sheet, the salon's walls rise out of it, gain material in
 * golden-hour sun, glow at dusk, and the camera walks in through the entrance door.
 * Progress p (0..1) comes from the scroll position of the story section.
 */
export function createScene(canvas, { shell, prints, onLoadProgress, onLoaded, onPrintClick, onProgress }) {
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

  /* ---------- Model: the salon rises from its own plan ---------- */
  // Geometry comes from the Riyora salon Blender model, converted by
  // tools/riyora_plan_json.py into assets/model/riyora_shell.json
  const model = new THREE.Group();
  model.position.y = 0.02;
  model.visible = false;
  scene.add(model);

  // Graphite linework so the rising wireframe reads like the ink plan on white paper
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x1c1c1c, transparent: true, opacity: 1 });
  const std = (o) => new THREE.MeshStandardMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, ...o });
  const mats = {
    walls: std({ color: 0xe9e5de, roughness: 0.9, envMapIntensity: 0.3 }),
    floor: std({ color: 0xe6e1d9, roughness: 0.25, envMapIntensity: 0.7 }),
    metal: std({ color: 0x1d1d1f, metalness: 0.85, roughness: 0.35, envMapIntensity: 0.9 }),
    glass: std({ color: 0x9fb4b0, metalness: 0.1, roughness: 0.05, envMapIntensity: 1.2 }),
  };
  const GLASS_MAX = 0.35;   // the shop window stays see-through
  const fading = Object.values(mats);

  const meshFrom = (positions, mat) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    model.add(mesh);
    return mesh;
  };
  const wallMesh = meshFrom(shell.walls, mats.walls);
  meshFrom(shell.floor, mats.floor);
  const frameMesh = meshFrom(shell.frames, mats.metal);
  meshFrom(shell.glass, mats.glass);
  model.add(new THREE.LineSegments(new THREE.EdgesGeometry(wallMesh.geometry, 20), edgeMat));
  const shadowCasters = [wallMesh, frameMesh];
  const box = (w, h, d, x, y, z, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    model.add(mesh);
    return mesh;
  };

  // The entrance arch: at dusk the lit salon glows through it, and the camera walks up
  // the street and in through the door until the light blinds the screen.
  // A light panel just inside the facade fills the arch; the wall around hides its corners.
  const HERO = shell.hero, WX = HERO.x, WYC = HERO.height / 2;
  const EYE = 1.55 * shell.unitsPerMetre;
  const windowMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, side: THREE.DoubleSide });
  const windowPane = new THREE.Mesh(new THREE.PlaneGeometry(HERO.width * 1.08, HERO.height * 1.04), windowMat);
  windowPane.position.set(WX, HERO.height * 0.52, HERO.zInner - 0.04);
  model.add(windowPane);
  const windowGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  windowGlow.position.set(WX, WYC, HERO.zOuter + 0.1);
  model.add(windowGlow);
  // Light shaft: an open cone of warm light spilling out of the door onto the street
  const shaftGeo = new THREE.CylinderGeometry(HERO.width * 0.45, HERO.width * 0.8, 4, 32, 1, true);
  shaftGeo.translate(0, -2, 0);
  const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTexture(), color: 0xffd6a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.position.set(WX, WYC, HERO.zOuter + 0.05);
  shaft.quaternion.setFromUnitVectors(V(0, -1, 0), V(0, -0.45, 1).normalize());
  model.add(shaft);

  /* ---------- Plan (draws itself) ---------- */
  // The shell's floor plan, cut at 1.2 m from the same model, so the walls rise
  // exactly out of the drawn walls. The ink linework draws in first; poché, labels
  // and dimensions fade in afterwards from a canvas layer (see drawAnnotations).
  const planSegs = [];
  const seg = (x1, z1, x2, z2) => planSegs.push([x1, z1, x2, z2]);
  const rect = (x1, z1, x2, z2) => { seg(x1, z1, x2, z1); seg(x2, z1, x2, z2); seg(x2, z2, x1, z2); seg(x1, z2, x1, z1); };
  const arc = (cx, cz, r, a0 = 0, a1 = Math.PI * 2, n = 20) => {
    for (let i = 0; i < n; i++) {
      const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n;
      seg(cx + Math.cos(t0) * r, cz + Math.sin(t0) * r, cx + Math.cos(t1) * r, cz + Math.sin(t1) * r);
    }
  };

  // Sheet frame and title block strip
  rect(-9.1, -6.1, 9.1, 6.1);
  rect(1.5, 5.3, 9.1, 6.1);
  seg(5.2, 5.3, 5.2, 6.1); seg(7.4, 5.3, 7.4, 6.1);

  // Walls as cut at 1.2 m
  shell.plan.cut.forEach((s) => seg(...s));
  // Shop window: three lines across the glazing
  for (const [x1, z1, x2, z2] of shell.plan.windows) {
    const zm = (z1 + z2) / 2, d = 0.06;
    for (const z of [zm - d, zm, zm + d]) seg(x1, z, x2, z);
  }
  // Doors: the leaf drawn open at 90 degrees with its swing arc
  for (const [x1, z1, x2, z2] of shell.plan.doors) {
    if (x2 - x1 >= z2 - z1) {          // door in a wall running along x
      const w = x2 - x1, zm = (z1 + z2) / 2;
      seg(x1, zm, x1, zm - w); arc(x1, zm, w, -Math.PI / 2, 0, 12);
    } else {                            // door in a wall running along z
      const w = z2 - z1, xm = (x1 + x2) / 2;
      seg(xm, z1, xm + w, z1); arc(xm, z1, w, 0, Math.PI / 2, 12);
    }
  }
  // Entrance: threshold lines and the open leaf swung into the salon
  const HL = WX - HERO.width / 2, HR = WX + HERO.width / 2;
  seg(HL, HERO.zOuter, HR, HERO.zOuter); seg(HL, HERO.zInner, HR, HERO.zInner);
  seg(HR, HERO.zInner, HR, HERO.zInner - HERO.width * 0.5);
  // Entrance arrow on the street
  seg(WX, HERO.zOuter + 0.85, WX, HERO.zOuter + 0.25);
  seg(WX, HERO.zOuter + 0.25, WX - 0.12, HERO.zOuter + 0.42); seg(WX, HERO.zOuter + 0.25, WX + 0.12, HERO.zOuter + 0.42);

  // Overall dimension strings
  const B = shell.bounds, DIM_TOP = B.minZ - 0.6, DIM_LEFT = B.minX - 0.6;
  seg(B.minX, DIM_TOP, B.maxX, DIM_TOP);
  seg(DIM_LEFT, B.minZ, DIM_LEFT, B.maxZ);
  for (const x of [B.minX, B.maxX]) { seg(x, DIM_TOP - 0.15, x, B.minZ - 0.1); seg(x - 0.08, DIM_TOP + 0.08, x + 0.08, DIM_TOP - 0.08); }
  for (const z of [B.minZ, B.maxZ]) { seg(DIM_LEFT - 0.15, z, B.minX - 0.1, z); seg(DIM_LEFT - 0.08, z + 0.08, DIM_LEFT + 0.08, z - 0.08); }

  // North arrow
  arc(-8.1, 4.9, 0.5, 0, Math.PI * 2, 24);
  seg(-8.1, 5.35, -8.1, 4.45); seg(-8.1, 4.45, -8.28, 4.8); seg(-8.1, 4.45, -7.92, 4.8);

  // Annotation layer: poché, room name, dimensions, title block
  const annoCanvas = document.createElement('canvas');
  annoCanvas.width = 2048;
  annoCanvas.height = Math.round(2048 * SHEET_D / SHEET_W);
  const annoTex = new THREE.CanvasTexture(annoCanvas);
  annoTex.colorSpace = THREE.SRGBColorSpace;
  annoTex.anisotropy = 8;
  function drawAnnotations() {
    const g = annoCanvas.getContext('2d'), W = annoCanvas.width, H = annoCanvas.height, k = W / SHEET_W;
    const px = (x, z) => [(x + SHEET_W / 2) * k, (z + SHEET_D / 2) / SHEET_D * H];
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
    // Solid walls from the wall tops, with door and window openings cut back out
    g.fillStyle = '#141414';
    for (const t of shell.plan.tops) {
      g.beginPath();
      for (let i = 0; i < 6; i += 2) g.lineTo(...px(t[i], t[i + 1]));
      g.closePath();
      g.fill();
    }
    for (const [x1, z1, x2, z2] of [...shell.plan.windows, ...shell.plan.doors]) {
      const [a, b] = px(Math.min(x1, x2), Math.min(z1, z2)), [c, d] = px(Math.max(x1, x2), Math.max(z1, z2));
      g.clearRect(a - 1, b - 1, c - a + 2, d - b + 2);
    }
    {
      const [a, b] = px(HL, HERO.zInner), [c, d] = px(HR, HERO.zOuter);
      g.clearRect(a, b - 2, c - a, d - b + 4);
    }

    text('ENTRANCE', WX, HERO.zOuter + 1.05, 0.15, { weight: 600 });
    text('SALON', (B.minX + B.maxX) / 2 + 0.6, (B.minZ + B.maxZ) / 2 + 1.6, 0.3);
    const mm = (units) => String(Math.round(units / shell.unitsPerMetre * 1000));
    text(mm(B.maxX - B.minX), (B.minX + B.maxX) / 2, DIM_TOP - 0.18, 0.16, { weight: 400, spacing: 0.05 });
    text(mm(B.maxZ - B.minZ), DIM_LEFT - 0.18, (B.minZ + B.maxZ) / 2, 0.16, { weight: 400, spacing: 0.05, rotate: -Math.PI / 2 });
    text('N', -8.1, 4.15, 0.22, { weight: 600, spacing: 0 });
    text('ALL DIMENSIONS IN MM', -8.8, 5.85, 0.11, { weight: 400, align: 'left' });

    text('RIYORA SALON', 3.35, 5.58, 0.28, { weight: 600 });
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
  // Warm light filling the salon at dusk
  const roomLight = new THREE.PointLight(0xffb066, 0, 14, 1.2);
  roomLight.position.set((shell.bounds.minX + shell.bounds.maxX) / 2, 2.4, (shell.bounds.minZ + shell.bounds.maxZ) / 2 + 2);
  // Light pouring out of the open door onto the street: aimed outwards so the facade
  // around the arch stays dark and the doorway reads as the light source
  const windowLight = new THREE.SpotLight(0xffd29a, 0, 11, 0.95, 0.6, 1.2);
  windowLight.position.set(WX, WYC + 0.02, HERO.zInner - 0.1);
  windowLight.target.position.set(WX, 0.15, HERO.zOuter + 3.5);
  scene.add(windowLight, windowLight.target, roomLight);
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
    [0.20, [7, 15, 14], [0, 0.6, 0]],
    [0.40, [17, 10, 13], [0.5, 0.6, 0]],
    [0.64, [-13, 11, 16], [0.5, 0.4, 0.5]],
    // Down on the street in front of the shop, walking towards the lit entrance
    [0.76, [WX + 0.7, 3.2, HERO.zOuter + 7], [WX, EYE, HERO.zOuter]],
    // Through the doorway at eye level; the rest of the scroll is the slow reveal
    [0.88, [WX, EYE, HERO.zInner - 0.5], [WX, EYE * 0.95, HERO.zInner - 6]],
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
      const glass = m === mats.glass;
      m.opacity = glass ? material * GLASS_MAX : material;
      m.transparent = glass || material < 0.99;
      m.depthWrite = !glass && material > 0.5;
    }
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
    windowPane.visible = material > 0.5; // no glass in the wireframe stages
    windowMat.color.setRGB(1, 0.8, 0.55).multiplyScalar(0.25 + 1.1 * dusk + 4 * near);
    windowGlow.material.opacity = 0.75 * dusk + 0.25 * near;
    windowGlow.scale.setScalar(2.2 + 5 * near);
    shaftMat.opacity = 0.22 * dusk + 0.4 * near;
    roomLight.intensity = 3 * dusk;
    windowLight.intensity = 4 * dusk + 16 * near;
    renderer.toneMappingExposure = 1 + 2.5 * smooth(0.77, 0.87, p);
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
