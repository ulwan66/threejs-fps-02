// BREACHLINE — rendering: the three.js scene, fighter models, the first
// person viewmodel, and every effect (tracers, sparks, decals, smoke,
// explosions). It reads state and never writes it, except the render-only
// effect pools it owns. All per-frame work reuses preallocated buffers:
// no geometry, material or vector is created after boot.

import * as THREE from 'three';
import { PALETTE } from './config.js';
import { LAMPS, PROPS, SITES, SOLIDS } from './map.js';
import { makeTextures } from './textures.js';
import { eyePos } from './combat.js';
import { clamp, lerp } from './utils.js';

const MAX_TRACERS = 28;
const MAX_SPARKS = 240;
const MAX_DECALS = 40;

function scaledBox(w, h, d, tile = 3) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = dims[face];
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, uv.getX(i) * (su / tile), uv.getY(i) * (sv / tile));
    }
  }
  return g;
}

export class Renderer {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.sky);
    this.scene.fog = new THREE.Fog(PALETTE.fog, 34, 110);
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 260);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.tex = makeTextures();
    this.shake = 0;
    this.fov = 75;
    this.models = new Map();
    this.decals = [];
    this.decalIdx = 0;
    this.smokeGroups = new Map();
    this.explosions = [];
    this._color = new THREE.Color();
    this._v = new THREE.Vector3();
    this.buildLights();
    this.buildStatic();
    this.buildFighters(state);
    this.buildViewmodel();
    this.buildEffects();
    this.buildCharge();
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x8fa3c7, 0x3a2f28, 1.15));
    const sun = new THREE.DirectionalLight(0xffd9a0, 2.3);
    sun.position.set(30, 42, -20);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x5a76b8, 0.6);
    rim.position.set(-25, 30, 25);
    this.scene.add(rim);
    for (let i = 0; i < 6; i++) {
      const l = LAMPS[i];
      const pt = new THREE.PointLight(0xffb347, 34, 20, 2);
      pt.position.set(l.x, 3.4, l.z);
      this.scene.add(pt);
    }
    this.boomLight = new THREE.PointLight(0xff7a3c, 0, 26, 2);
    this.scene.add(this.boomLight);
  }

  buildStatic() {
    const { floor, wall, metal, crate, hazard } = this.tex;
    const floorMat = new THREE.MeshLambertMaterial({ map: floor });
    const wallMat = new THREE.MeshLambertMaterial({ map: wall });
    const metalMat = new THREE.MeshLambertMaterial({ map: metal });
    const crateMat = new THREE.MeshLambertMaterial({ map: crate });
    const hazardMat = new THREE.MeshLambertMaterial({ map: hazard });
    const mats = { wall: wallMat, crate: crateMat, pillar: metalMat, platform: metalMat };

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(66, 50), floorMat);
    floor.repeat.set(11, 8.5);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 0);
    this.scene.add(ground);
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(320, 320),
      new THREE.MeshLambertMaterial({ color: 0x1b1e26 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.06;
    this.scene.add(apron);

    for (const s of SOLIDS) {
      const w = s.x1 - s.x0, h = s.y1 - s.y0, d = s.z1 - s.z0;
      const mesh = new THREE.Mesh(scaledBox(w, h, d), mats[s.kind] || wallMat);
      mesh.position.set((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2);
      this.scene.add(mesh);
      if (s.kind === 'platform') {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.5), hazardMat);
        strip.rotation.x = -Math.PI / 2;
        strip.position.set((s.x0 + s.x1) / 2, s.y1 + 0.01, s.z0 + 0.3);
        this.scene.add(strip);
      }
    }

    // Site markers: pulsing ground ring + floating letter.
    this.siteMarkers = {};
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.3, 2.7, 40),
        new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(s.cx, 0.03, s.cz);
      this.scene.add(ring);
      const letter = new THREE.Sprite(new THREE.SpriteMaterial({
        map: key === 'A' ? this.tex.letterA : this.tex.letterB, transparent: true, depthWrite: false,
      }));
      letter.scale.set(2.2, 2.2, 1);
      letter.position.set(s.cx, 3.4, s.cz);
      this.scene.add(letter);
      this.siteMarkers[key] = { ring, letter };
    }

    this.buildProps();
    this.buildStars();
  }

  buildProps() {
    const metalMat = new THREE.MeshLambertMaterial({ map: this.tex.metal });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x2c2e35 });
    const rustMat = new THREE.MeshLambertMaterial({ color: PALETTE.rust });
    const lampMat = new THREE.MeshBasicMaterial({ color: PALETTE.lamp });
    for (const p of PROPS) {
      let mesh = null;
      if (p.type === 'chimney') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, p.h, 10), metalMat);
        mesh.position.set(p.x, p.h / 2, p.z);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.6, 10), darkMat);
        cap.position.set(p.x, p.h + 0.2, p.z);
        this.scene.add(cap);
        const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.25, 10),
          new THREE.MeshBasicMaterial({ color: 0xff6a2a }));
        glow.position.set(p.x, p.h - 0.4, p.z);
        this.scene.add(glow);
      } else if (p.type === 'silo') {
        mesh = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 9, 12), metalMat);
        body.position.y = 4.5;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), darkMat);
        cap.position.y = 9;
        mesh.add(body, cap);
        mesh.position.set(p.x, 0, p.z);
      } else if (p.type === 'barrel') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 10), rustMat);
        mesh.position.set(p.x, 0.53, p.z);
      } else if (p.type === 'pipe') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 7, 8), darkMat);
        mesh.rotation.z = Math.PI / 2;
        mesh.position.set(p.x, 3.6, p.z);
      } else if (p.type === 'fence') {
        mesh = new THREE.Group();
        for (let i = -1; i <= 1; i++) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), darkMat);
          post.position.set(i * 1.4, 0.6, 0);
          mesh.add(post);
        }
        for (const y of [0.4, 0.8, 1.1]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 0.08), rustMat);
          bar.position.set(0, y, 0);
          mesh.add(bar);
        }
        mesh.position.set(p.x, 0, p.z);
      } else if (p.type === 'lampPost') {
        mesh = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 3.4, 8), darkMat);
        pole.position.y = 1.7;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), darkMat);
        head.position.y = 3.45;
        const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.2), lampMat);
        bulb.position.y = 3.36;
        mesh.add(pole, head, bulb);
        mesh.position.set(p.x, 0, p.z);
      }
      if (mesh) this.scene.add(mesh);
    }
  }

  buildStars() {
    const n = 320;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = 0.12 + Math.random() * 0.8;
      const r = 160;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xcdd8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 });
    this.scene.add(new THREE.Points(g, m));
  }

  buildFighters(state) {
    const geo = {
      leg: new THREE.BoxGeometry(0.17, 0.78, 0.17).translate(0, -0.39, 0),
      torso: new THREE.BoxGeometry(0.52, 0.62, 0.3),
      head: new THREE.BoxGeometry(0.3, 0.3, 0.3),
      visor: new THREE.BoxGeometry(0.22, 0.07, 0.03),
      arm: new THREE.BoxGeometry(0.13, 0.56, 0.13).translate(0, -0.24, 0),
      gunBody: new THREE.BoxGeometry(0.09, 0.13, 0.5),
      gunBarrel: new THREE.BoxGeometry(0.045, 0.045, 0.3),
    };
    const limbMat = new THREE.MeshStandardMaterial({ color: 0x23252c, roughness: 0.9 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.6, metalness: 0.5 });
    const teamMats = {
      vanguard: {
        torso: new THREE.MeshStandardMaterial({ color: PALETTE.vanguard, roughness: 0.8, emissive: PALETTE.vanguard, emissiveIntensity: 0.35 }),
        head: new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.85 }),
        visor: new THREE.MeshBasicMaterial({ color: 0xffd27a }),
      },
      sentinel: {
        torso: new THREE.MeshStandardMaterial({ color: PALETTE.sentinel, roughness: 0.8, emissive: PALETTE.sentinel, emissiveIntensity: 0.35 }),
        head: new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.85 }),
        visor: new THREE.MeshBasicMaterial({ color: 0x9fe8ff }),
      },
    };
    for (const f of state.fighters) {
      if (f.isPlayer) continue; // the player never sees their own body
      const tm = teamMats[f.team];
      const root = new THREE.Group();
      const upper = new THREE.Group();
      upper.position.y = 0.78;
      root.add(upper);
      const legL = new THREE.Mesh(geo.leg, limbMat);
      legL.position.set(-0.12, 0.78, 0);
      const legR = new THREE.Mesh(geo.leg, limbMat);
      legR.position.set(0.12, 0.78, 0);
      root.add(legL, legR);
      const torso = new THREE.Mesh(geo.torso, tm.torso);
      torso.position.y = 0.31;
      const head = new THREE.Mesh(geo.head, tm.head);
      head.position.y = 0.78;
      const visor = new THREE.Mesh(geo.visor, tm.visor);
      visor.position.set(0, 0.79, -0.16);
      const armL = new THREE.Mesh(geo.arm, limbMat);
      armL.position.set(-0.33, 0.55, 0);
      const armR = new THREE.Mesh(geo.arm, limbMat);
      armR.position.set(0.33, 0.55, 0);
      armR.rotation.x = -1.25;
      armL.rotation.x = -0.9;
      upper.add(torso, head, visor, armL, armR);
      const gun = new THREE.Group();
      gun.position.set(0.3, 0.42, -0.3);
      gun.add(new THREE.Mesh(geo.gunBody, gunMat));
      const barrel = new THREE.Mesh(geo.gunBarrel, gunMat);
      barrel.position.set(0, 0.02, -0.36);
      gun.add(barrel);
      const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.tex.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }));
      muzzle.scale.set(0.4, 0.4, 1);
      muzzle.position.set(0, 0.02, -0.55);
      muzzle.visible = false;
      gun.add(muzzle);
      upper.add(gun);
      this.scene.add(root);
      this.models.set(f.id, {
        root, upper, legL, legR, armL, armR, head, gun, muzzle,
        deadT: -1, crouchK: 0,
      });
    }
  }

  buildViewmodel() {
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.3 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.6, metalness: 0.4 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x4a4034, roughness: 0.9 });
    const mk = (boxes) => {
      const g = new THREE.Group();
      for (const [w, h, d, x, y, z, mat] of boxes) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || gunMat);
        m.position.set(x, y, z);
        g.add(m);
      }
      return g;
    };
    const models = {
      p9: mk([[0.07, 0.09, 0.26, 0, 0, 0], [0.05, 0.05, 0.1, 0, 0.02, -0.16], [0.06, 0.12, 0.08, 0, -0.09, 0.07, gripMat]]),
      k7: mk([[0.08, 0.11, 0.42, 0, 0, 0], [0.04, 0.04, 0.18, 0, 0.02, -0.28], [0.06, 0.16, 0.09, 0, -0.12, -0.02, gripMat], [0.06, 0.1, 0.16, 0, -0.02, 0.26, gripMat], [0.03, 0.05, 0.06, 0, 0.08, -0.05, accentMat]]),
      ar4: mk([[0.09, 0.12, 0.55, 0, 0, 0], [0.045, 0.045, 0.3, 0, 0.02, -0.4], [0.07, 0.17, 0.1, 0, -0.13, 0.02, gripMat], [0.07, 0.1, 0.2, 0, -0.02, 0.34, gripMat], [0.04, 0.06, 0.12, 0, 0.09, -0.08, accentMat], [0.05, 0.05, 0.22, 0, -0.05, -0.22, gripMat]]),
      m870: mk([[0.1, 0.13, 0.5, 0, 0, 0], [0.06, 0.06, 0.34, 0, 0.03, -0.4], [0.09, 0.09, 0.24, 0, -0.04, -0.24, gripMat], [0.08, 0.12, 0.24, 0, -0.03, 0.34, gripMat]]),
      dmr9: mk([[0.09, 0.12, 0.7, 0, 0, 0], [0.04, 0.04, 0.36, 0, 0.02, -0.5], [0.07, 0.15, 0.1, 0, -0.12, 0.05, gripMat], [0.07, 0.1, 0.2, 0, -0.02, 0.42, gripMat]]),
      grenade: (() => {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), new THREE.MeshStandardMaterial({ color: 0x2e4030, roughness: 0.7, metalness: 0.3 }));
        const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.1), gunMat);
        lever.position.set(0.03, 0.07, 0);
        g.add(body, lever);
        return g;
      })(),
    };
    // DMR scope: a cylinder riding the rail.
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), gunMat);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.1, -0.05);
    models.dmr9.add(scope);
    const group = new THREE.Group();
    for (const m of Object.values(models)) { m.visible = false; group.add(m); }
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.tex.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    flash.scale.set(0.3, 0.3, 1);
    flash.visible = false;
    group.add(flash);
    group.position.set(0.25, -0.24, -0.44);
    group.scale.setScalar(0.85);
    this.camera.add(group);
    this.vm = { group, models, flash, kick: 0, dip: 0, throwK: 0 };
  }

  buildEffects() {
    // Tracers: one LineSegments, positions rewritten every frame.
    const tg = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(MAX_TRACERS * 6);
    this.tracerCol = new Float32Array(MAX_TRACERS * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerLines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.tracerLines.frustumCulled = false;
    this.scene.add(this.tracerLines);

    // Sparks: one Points cloud, particles integrated on the CPU.
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    this.sparkCol = new Float32Array(MAX_SPARKS * 3);
    this.sparks = [];
    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparks.push({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 1, g: 0.8, b: 0.5 });
      this.sparkPos[i * 3 + 1] = -999;
    }
    this.sparkIdx = 0;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkPoints = new THREE.Points(sg, new THREE.PointsMaterial({
      size: 0.09, map: this.tex.spark, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.sparkPoints.frustumCulled = false;
    this.scene.add(this.sparkPoints);

    // Decals: pooled quads stuck to walls at bullet impacts.
    const decalMat = () => new THREE.MeshBasicMaterial({
      map: this.tex.decal, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    for (let i = 0; i < MAX_DECALS; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), decalMat());
      m.visible = false;
      m.renderOrder = 2;
      this.scene.add(m);
      this.decals.push({ mesh: m, until: 0 });
    }
    // Grenades: pooled dark spheres, spun to match the sim's spin timer.
    this.grenadeMeshes = [];
    const grenadeGeo = new THREE.SphereGeometry(0.1, 10, 8);
    const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2e4030, roughness: 0.7, metalness: 0.3 });
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(grenadeGeo, grenadeMat);
      m.visible = false;
      this.scene.add(m);
      this.grenadeMeshes.push(m);
    }
    this.seenImpacts = new Set();
  }

  buildCharge() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x23252c, roughness: 0.7 }));
    body.position.y = 0.1;
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    light.position.set(0.08, 0.22, 0);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6),
      new THREE.MeshBasicMaterial({ color: 0x111111 }));
    antenna.position.set(-0.1, 0.3, 0);
    g.add(body, light, antenna);
    g.visible = false;
    this.scene.add(g);
    this.chargeMesh = g;
    this.chargeLight = light;
  }

  handleEvent(state, ev) {
    if (ev.kind === 'explosion' || ev.kind === 'detonation') {
      const big = ev.kind === 'detonation';
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.tex.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }));
      sprite.position.set(ev.x, (ev.y || 0.5) + 0.4, ev.z);
      sprite.scale.set(1, 1, 1);
      this.scene.add(sprite);
      this.explosions.push({ sprite, born: state.time, until: state.time + (big ? 0.8 : 0.4), max: big ? 9 : 4.5 });
      const p = state.player;
      const d = Math.hypot(ev.x - p.pos.x, ev.z - p.pos.z);
      this.shake = Math.max(this.shake, clamp(1.4 - d * 0.06, 0.1, 1.2) * (big ? 1.6 : 1));
      this.boomLight.position.set(ev.x, 1.5, ev.z);
      this.boomLight.intensity = big ? 400 : 160;
      this.burstSparks(ev.x, ev.y || 0.5, ev.z, big ? 26 : 14, 1, 0.55, 0.2, 3.2);
    }
  }

  burstSparks(x, y, z, n, r, g, b, speed) {
    for (let i = 0; i < n; i++) {
      const s = this.sparks[this.sparkIdx];
      this.sparkIdx = (this.sparkIdx + 1) % MAX_SPARKS;
      s.x = x; s.y = y; s.z = z;
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      s.vx = Math.cos(a) * Math.cos(e) * sp;
      s.vy = Math.abs(Math.sin(e)) * sp * 0.9 + 0.8;
      s.vz = Math.sin(a) * Math.cos(e) * sp;
      s.max = 0.3 + Math.random() * 0.35;
      s.life = s.max;
      s.r = r; s.g = g; s.b = b;
    }
  }

  sync(state, dt) {
    const now = state.time;
    const p = state.player;
    // --- Camera: the viewed fighter's eye, recoil, bob, lean, shake.
    const viewed = state.spectate >= 0 ? state.fighters[state.spectate] : p;
    eyePos(viewed, this._v);
    const speedFrac = clamp(viewed.speed2d / 4.3, 0, 1);
    const bob = viewed.onGround ? Math.sin(viewed.walkPhase * 2) * 0.014 * speedFrac : 0;
    this.camera.position.set(this._v.x, this._v.y + bob, this._v.z);
    this.shake *= Math.exp(-4.5 * dt);
    const shX = (Math.random() - 0.5) * 0.03 * this.shake;
    const shY = (Math.random() - 0.5) * 0.03 * this.shake;
    // Lean into strafes: roll from lateral velocity against the facing.
    const lateral = viewed.vel.x * Math.cos(viewed.yaw) - viewed.vel.z * Math.sin(viewed.yaw);
    const lean = clamp(-lateral * 0.012, -0.03, 0.03);
    this.camera.rotation.set(
      viewed.pitch + viewed.recoilPitch + shX,
      viewed.yaw + viewed.recoilYaw + shY,
      lean,
    );
    const wantFov = viewed.zoomed ? 34 : 75;
    this.fov = lerp(this.fov, wantFov, Math.min(1, 14 * dt));
    if (Math.abs(this.fov - this.camera.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // --- Fighter models.
    for (const f of state.fighters) {
      const m = this.models.get(f.id);
      if (!m) continue;
      m.root.position.set(f.pos.x, f.pos.y, f.pos.z);
      m.root.rotation.y = f.yaw;
      if (f.alive) {
        m.deadT = -1;
        m.root.rotation.x = 0;
        const targetCrouch = f.crouch ? 1 : 0;
        m.crouchK = lerp(m.crouchK, targetCrouch, Math.min(1, 12 * dt));
        m.root.scale.set(1, 1 - 0.26 * m.crouchK, 1);
        m.upper.rotation.x = f.pitch * 0.55;
        const swing = clamp(f.speed2d / 4.3, 0, 1) * 0.62;
        m.legL.rotation.x = Math.sin(f.walkPhase * 2) * swing;
        m.legR.rotation.x = -Math.sin(f.walkPhase * 2) * swing;
        m.armL.rotation.x = -0.9 - Math.sin(f.walkPhase * 2) * swing * 0.4;
        m.muzzle.visible = now < f.muzzleUntil;
      } else {
        if (m.deadT < 0) m.deadT = now;
        const k = clamp((now - m.deadT) / 0.35, 0, 1);
        m.root.rotation.x = 1.5 * k;
        m.root.scale.set(1, 1, 1);
        m.muzzle.visible = false;
      }
    }

    // --- Viewmodel: current weapon, recoil kick, reload dip, throw thrust.
    const vm = this.vm;
    const wid = p.current === 'grenade' ? 'grenade' : p.weapons[p.current];
    for (const [id, model] of Object.entries(vm.models)) model.visible = id === wid;
    vm.kick = lerp(vm.kick, 0, Math.min(1, 10 * dt));
    if (now < p.muzzleUntil) vm.kick = Math.min(vm.kick + 0.55, 1);
    const reloading = p.reloading;
    vm.dip = lerp(vm.dip, reloading ? 1 : 0, Math.min(1, 8 * dt));
    vm.throwK = now < p.throwUntil ? 1 - (p.throwUntil - now) / 0.35 : 0;
    const scoped = !!p.zoomed;
    vm.group.visible = p.alive && !scoped;
    vm.group.position.set(
      0.25 + Math.cos(p.walkPhase) * 0.006 * speedFrac,
      -0.24 + Math.sin(p.walkPhase * 2) * 0.008 * speedFrac - vm.dip * 0.14 - vm.throwK * 0.05,
      -0.44 + vm.kick * 0.05 - vm.throwK * 0.12,
    );
    vm.group.rotation.set(vm.kick * 0.14 - vm.dip * 0.55 - vm.throwK * 0.3, 0, 0);
    vm.flash.visible = now < p.muzzleUntil && !scoped;
    if (vm.flash.visible) {
      const tip = { p9: -0.2, k7: -0.36, ar4: -0.55, m870: -0.56, dmr9: -0.68 }[wid] || -0.3;
      vm.flash.position.set(0, 0.02, tip);
      const s = 0.24 + Math.random() * 0.14;
      vm.flash.scale.set(s, s, 1);
      vm.flash.material.rotation = Math.random() * Math.PI;
    }

    // --- Charge mesh + site markers.
    const ch = state.charge;
    const showCharge = ch.state === 'dropped' || ch.state === 'planted';
    this.chargeMesh.visible = showCharge;
    if (showCharge) {
      this.chargeMesh.position.set(ch.pos.x, ch.pos.y, ch.pos.z);
      const rate = ch.state === 'planted' ? clamp(14 - ch.fuse * 0.3, 2, 14) : 2;
      this.chargeLight.material.color.setHex(Math.sin(now * rate) > 0 ? 0xff3b30 : 0x441008);
    }
    for (const key of ['A', 'B']) {
      const mk = this.siteMarkers[key];
      const planted = ch.state === 'planted' && ch.site === key;
      mk.ring.material.color.setHex(planted ? 0xff3b30 : 0xffd27a);
      mk.ring.material.opacity = planted ? 0.45 + 0.3 * Math.sin(now * 9) : 0.3 + 0.12 * Math.sin(now * 2);
      mk.letter.position.y = 3.4 + Math.sin(now * 1.4 + (key === 'A' ? 0 : 2)) * 0.12;
    }

    this.syncTracers(state);
    this.syncSparks(dt);
    this.syncDecals(state);
    this.syncSmoke(state, dt);
    this.syncExplosions(state);
    this.syncGrenades(state);

    this.boomLight.intensity *= Math.exp(-6 * dt);
  }

  syncGrenades(state) {
    for (let i = 0; i < this.grenadeMeshes.length; i++) {
      const m = this.grenadeMeshes[i];
      const g = state.grenades[i];
      if (!g) { m.visible = false; continue; }
      m.visible = true;
      m.position.set(g.pos.x, g.pos.y, g.pos.z);
      m.rotation.set(g.spin, g.spin * 0.7, 0);
    }
  }

  syncTracers(state) {
    const now = state.time;
    let n = 0;
    for (const t of state.tracers) {
      if (n >= MAX_TRACERS) break;
      const life = clamp((t.until - now) / 0.07, 0, 1);
      this._color.setHex(t.color).multiplyScalar(0.25 + 0.75 * life);
      const o = n * 6;
      this.tracerPos[o] = t.fx; this.tracerPos[o + 1] = t.fy; this.tracerPos[o + 2] = t.fz;
      this.tracerPos[o + 3] = t.tx; this.tracerPos[o + 4] = t.ty; this.tracerPos[o + 5] = t.tz;
      this.tracerCol[o] = this._color.r; this.tracerCol[o + 1] = this._color.g; this.tracerCol[o + 2] = this._color.b;
      this.tracerCol[o + 3] = this._color.r; this.tracerCol[o + 4] = this._color.g; this.tracerCol[o + 5] = this._color.b;
      n++;
    }
    this.tracerLines.geometry.setDrawRange(0, n * 2);
    this.tracerLines.geometry.attributes.position.needsUpdate = true;
    this.tracerLines.geometry.attributes.color.needsUpdate = true;
  }

  syncSparks(dt) {
    for (let i = 0; i < MAX_SPARKS; i++) {
      const s = this.sparks[i];
      if (s.life > 0) {
        s.life -= dt;
        s.vy -= 9 * dt;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        if (s.y < 0.02) { s.y = 0.02; s.vy *= -0.4; }
        const k = clamp(s.life / s.max, 0, 1);
        this.sparkPos[i * 3] = s.x; this.sparkPos[i * 3 + 1] = s.y; this.sparkPos[i * 3 + 2] = s.z;
        this.sparkCol[i * 3] = s.r * k; this.sparkCol[i * 3 + 1] = s.g * k; this.sparkCol[i * 3 + 2] = s.b * k;
      } else {
        this.sparkPos[i * 3 + 1] = -999;
        this.sparkCol[i * 3] = 0; this.sparkCol[i * 3 + 1] = 0; this.sparkCol[i * 3 + 2] = 0;
      }
    }
    this.sparkPoints.geometry.attributes.position.needsUpdate = true;
    this.sparkPoints.geometry.attributes.color.needsUpdate = true;
  }

  syncDecals(state) {
    const now = state.time;
    for (const imp of state.impacts) {
      if (this.seenImpacts.has(imp)) continue;
      this.seenImpacts.add(imp);
      if (imp.kind === 'wall') {
        const d = this.decals[this.decalIdx];
        this.decalIdx = (this.decalIdx + 1) % MAX_DECALS;
        d.mesh.visible = true;
        d.mesh.position.set(imp.x + imp.nx * 0.015, imp.y + imp.ny * 0.015, imp.z + imp.nz * 0.015);
        d.mesh.lookAt(imp.x + imp.nx, imp.y + imp.ny, imp.z + imp.nz);
        d.until = imp.until;
        this.burstSparks(imp.x, imp.y, imp.z, 4, 1, 0.8, 0.5, 2.4);
      } else {
        this.burstSparks(imp.x, imp.y, imp.z, 5, 0.85, 0.15, 0.1, 1.6);
      }
    }
    if (this.seenImpacts.size > 400) {
      for (const imp of this.seenImpacts) {
        if (!state.impacts.includes(imp)) this.seenImpacts.delete(imp);
      }
    }
    for (const d of this.decals) {
      if (d.mesh.visible && now > d.until) d.mesh.visible = false;
    }
  }

  syncSmoke(state, dt) {
    for (const [smoke, group] of this.smokeGroups) {
      if (!state.smokes.includes(smoke)) {
        this.scene.remove(group);
        this.smokeGroups.delete(smoke);
      }
    }
    for (const smoke of state.smokes) {
      let group = this.smokeGroups.get(smoke);
      if (!group) {
        group = new THREE.Group();
        group.position.set(smoke.x, smoke.y, smoke.z);
        for (let i = 0; i < 12; i++) {
          const mat = new THREE.SpriteMaterial({
            map: this.tex.smoke, transparent: true, depthWrite: false, opacity: 0,
          });
          const sp = new THREE.Sprite(mat);
          const a = Math.random() * Math.PI * 2, r = Math.random() * smoke.radius * 0.6;
          sp.position.set(Math.cos(a) * r, (Math.random() - 0.4) * 1.6, Math.sin(a) * r);
          const s = 2.6 + Math.random() * 2.2;
          sp.scale.set(s, s, 1);
          sp.userData.seed = Math.random() * 10;
          group.add(sp);
        }
        this.scene.add(group);
        this.smokeGroups.set(smoke, group);
      }
      const age = state.time - smoke.born;
      const remain = smoke.until - state.time;
      const opacity = clamp(Math.min(age / 1.2, remain / 3), 0, 1) * 0.62;
      group.rotation.y += dt * 0.12;
      for (const sp of group.children) {
        sp.material.opacity = opacity;
        sp.position.y += Math.sin(state.time * 0.5 + sp.userData.seed) * dt * 0.12;
      }
    }
  }

  syncExplosions(state) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      const k = (state.time - e.born) / (e.until - e.born);
      if (k >= 1) {
        this.scene.remove(e.sprite);
        e.sprite.material.dispose();
        this.explosions.splice(i, 1);
        continue;
      }
      const s = e.max * (0.3 + 0.7 * k);
      e.sprite.scale.set(s, s, 1);
      e.sprite.material.opacity = 1 - k;
    }
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
