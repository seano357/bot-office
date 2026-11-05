// A loft's view: a procedural neon skyline just past the glass, a few stars, warm string lights and pots.
// Nothing here is a copied asset. Phones get a shorter skyline and no rain. Reduced motion holds still.
import * as THREE from 'three';

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const PHONE = typeof matchMedia === 'function' && matchMedia('(max-width: 600px), (max-height: 500px) and (max-width: 950px)').matches;

const NEON = ['#ff4fad', '#49e0ff', '#e879f9', '#ffd2a8', '#c084fc'];

export function createCity(scene) {
  const root = new THREE.Group();
  root.name = 'lofi-city';
  scene.add(root);
  // The studio aura traces every mesh. Leave the skyline out of that mask so towers don't grow a contact shadow.
  const prevBefore = scene.onBeforeRender;
  const prevAfter = scene.onAfterRender;
  scene.onBeforeRender = function (...args) {
    prevBefore.apply(this, args);
    if (scene.overrideMaterial) root.visible = false;
  };
  scene.onAfterRender = function (...args) {
    root.visible = true;
    prevAfter.apply(this, args);
  };

  // Sky, towers and rain. Hidden once the painted plate has loaded; this is the fallback.
  const outside = new THREE.Group();
  outside.name = 'lofi-skyline';
  root.add(outside);
  const towers = makeSkyline(PHONE ? 8 : 16);
  outside.add(towers.mesh);
  const signs = makeSigns(towers.spots);
  for (const s of signs) outside.add(s);
  const clouds = makeClouds(PHONE ? 3 : 5);
  outside.add(clouds);
  outside.add(makeStars(PHONE ? 40 : 90));

  const cozy = new THREE.Group();
  root.add(cozy);
  const bulbs = stringLights(cozy, PHONE ? 9 : 14);
  const lamp = new THREE.PointLight(0xffb078, 0.38, 10, 2);
  lamp.position.set(-0.4, 2.05, -4.8);
  cozy.add(lamp);
  // Open floor, clear of the tables, the bar and the existing trees.
  for (const [x, z] of [[-7.05, -5.25], [3.4, -5.15], [3.25, 5.15], [-5.4, 5.05]]) cozy.add(plant(x, z));

  let rain = null;
  if (!PHONE && !REDUCED) rain = makeRain();
  if (rain) root.add(rain);

  return {
    follow(y) { root.position.y = y || 0; },
    setPhoto(on) { outside.visible = !on; },
    update(dt, t) {
      if (REDUCED) return;
      for (let i = 0; i < bulbs.length; i++) {
        const k = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 0.7));
        bulbs[i].material.color.setRGB(k, 0.82 * k, 0.62 * k);
      }
      if (rain) stepRain(rain, dt);
      if (!outside.visible) return;
      const tw = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(t * 0.7));
      towers.mat.color.setRGB(tw, tw, tw);
      for (let i = 0; i < signs.length; i++) {
        signs[i].material.opacity = 0.62 + 0.32 * (0.5 + 0.5 * Math.sin(t * 1.6 + i * 1.1));
      }
      driftClouds(clouds, dt);
    },
  };
}

function makeSkyline(n) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshBasicMaterial({ map: windowTex(), color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const spots = [];
  for (let i = 0; i < n; i++) {
    const x = -15 + (i + 0.35) * (28 / n);
    const z = -8.15 - (i % 3) * 1.25;
    const h = 3.1 + ((i * 5) % 8) * 0.55;
    const w = 1.45 + (i % 4) * 0.32;
    dummy.position.set(x, 0, z);
    dummy.scale.set(w, h, 1.35 + (i % 2) * 0.35);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, tint.set(NEON[i % NEON.length]));
    spots.push({ x, z, h, w });
  }
  mesh.instanceColor.needsUpdate = true;
  return { mesh, mat, spots };
}

function makeSigns(spots) {
  const signs = [];
  spots.forEach((s, i) => {
    if (i % 3 !== 0) return;
    const color = NEON[(i + 2) % NEON.length];
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(s.w * 0.62, 0.55),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    board.position.set(s.x, s.h * 0.62, s.z + 0.95);
    signs.push(board);
  });
  return signs;
}

function windowTex() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#140818';
  g.fillRect(0, 0, 32, 64);
  for (let y = 2; y < 64; y += 4) {
    for (let x = 2; x < 32; x += 4) {
      if (((x * 13 + y * 7) % 10) > 6) continue;
      const a = 0.45 + ((x * 3 + y) % 5) / 10;
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.fillRect(x, y, 2, 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function makeStars(n) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = -16 + Math.random() * 30;
    pos[i * 3 + 1] = 3.2 + Math.random() * 5.5;
    pos[i * 3 + 2] = -7.2 - Math.random() * 7;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xe7e0ff, size: 0.18, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false,
  }));
}

function makeClouds(n) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xd8ccf6, transparent: true, opacity: 0.2, depthWrite: false });
  const spots = PHONE
    ? [[-15, 3.6, 1.4], [-10, 4.2, -0.6]]
    : [[-16, 3.6, 1.6], [-11.5, 4.3, -0.8], [-14, 2.8, 3.2]];
  spots.slice(0, n).forEach(([x, y, z], i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), mat);
    m.scale.set(1.35 + (i % 2) * 0.35, 0.32, 0.7);
    m.position.set(x, y, z);
    g.add(m);
  });
  return g;
}

function driftClouds(clouds, dt) {
  for (const m of clouds.children) {
    m.position.x += dt * 0.18;
    if (m.position.x > -4) m.position.x = -18;
  }
}

function stringLights(parent, count) {
  const bulbs = [];
  const pts = [];
  for (let i = 0; i < count; i++) {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe1c2 }),
    );
    const x = -6.6 + (13.2 * i) / (count - 1);
    const sag = Math.sin((i / (count - 1)) * Math.PI) * 0.28;
    bulb.position.set(x, 2.22 - sag, -5.62);
    parent.add(bulb);
    bulbs.push(bulb);
    pts.push(bulb.position.clone());
  }
  parent.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x5a3a32 })));
  return bulbs;
}

function plant(x, z) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.13, 0.24, 8),
    new THREE.MeshStandardMaterial({ color: 0xc47b90, roughness: 0.72 }),
  );
  pot.position.y = 0.12;
  const leaf = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f8f62, roughness: 0.82 }),
  );
  leaf.position.y = 0.46;
  leaf.scale.y = 0.75;
  const flower = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshBasicMaterial({ color: (x + z) > 0 ? 0xff6ea8 : 0xffd27a }),
  );
  flower.position.set(0.08, 0.66, 0.06);
  const bloom = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff1c9 }),
  );
  bloom.position.set(-0.1, 0.6, 0.02);
  g.add(pot, leaf, flower, bloom);
  g.position.set(x, 0, z);
  return g;
}

function makeRain() {
  const n = 70;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = -6 + Math.random() * 11;
    pos[i * 3 + 1] = 0.6 + Math.random() * 4.2;
    pos[i * 3 + 2] = -4.6 - Math.random() * 1.1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xe8e0ff, size: 0.09, transparent: true, opacity: 0.28, depthWrite: false,
  }));
}

function stepRain(rain, dt) {
  const p = rain.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i) - dt * 2.4;
    if (y < 0.35) y = 4.8;
    p.setY(i, y);
  }
  p.needsUpdate = true;
}
