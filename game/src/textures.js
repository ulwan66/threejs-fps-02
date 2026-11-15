// BREACHLINE — art, generated. Every texture is painted on a canvas at
// boot: concrete, metal, wood, hazard stripes, sprites. No image files, no
// network, and the palette stays exactly the one in config.js.

import * as THREE from 'three';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}
function speckle(ctx, size, n, colors, alpha) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    ctx.globalAlpha = Math.random() * alpha;
    const s = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  ctx.globalAlpha = 1;
}
function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function floorTexture() {
  const s = 256, c = canvas(s), x = c.getContext('2d');
  x.fillStyle = '#43464e'; x.fillRect(0, 0, s, s);
  speckle(x, s, 2600, ['#3a3d44', '#4d5058', '#55585f', '#33363d'], 0.5);
  // Expansion joints and a painted guide line.
  x.strokeStyle = '#31343b'; x.lineWidth = 3;
  x.strokeRect(1, 1, s - 2, s - 2);
  x.strokeStyle = '#2c2f36'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(s / 2, 0); x.lineTo(s / 2, s); x.stroke();
  x.fillStyle = 'rgba(217,164,65,0.16)';
  x.fillRect(0, s - 14, s, 5);
  // Oil stains.
  for (let i = 0; i < 5; i++) {
    const g = x.createRadialGradient(0, 0, 2, 0, 0, 30 + Math.random() * 30);
    g.addColorStop(0, 'rgba(15,16,20,0.5)');
    g.addColorStop(1, 'rgba(15,16,20,0)');
    x.save();
    x.translate(Math.random() * s, Math.random() * s);
    x.fillStyle = g;
    x.fillRect(-60, -60, 120, 120);
    x.restore();
  }
  return tex(c);
}

function wallTexture() {
  const s = 256, c = canvas(s), x = c.getContext('2d');
  x.fillStyle = '#676a73'; x.fillRect(0, 0, s, s);
  speckle(x, s, 2200, ['#5c5f68', '#74777f', '#565963', '#7d8089'], 0.45);
  // Panel seams.
  x.strokeStyle = '#4a4d55'; x.lineWidth = 4;
  x.strokeRect(2, 2, s - 4, s - 4);
  x.beginPath(); x.moveTo(0, s / 2); x.lineTo(s, s / 2); x.stroke();
  // Rivets.
  x.fillStyle = '#3f424a';
  for (const [rx, ry] of [[14, 14], [s - 14, 14], [14, s - 14], [s - 14, s - 14], [14, s / 2], [s - 14, s / 2]]) {
    x.beginPath(); x.arc(rx, ry, 4, 0, 7); x.fill();
  }
  // Grime streaks from the top.
  for (let i = 0; i < 8; i++) {
    const gx = Math.random() * s, len = 40 + Math.random() * 90;
    const g = x.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(30,32,38,0.35)');
    g.addColorStop(1, 'rgba(30,32,38,0)');
    x.fillStyle = g;
    x.fillRect(gx, 0, 6 + Math.random() * 10, len);
  }
  // Faded stencil.
  x.fillStyle = 'rgba(230,230,230,0.13)';
  x.font = 'bold 44px monospace';
  x.fillText('F-9', 84, 150);
  return tex(c);
}

function metalTexture() {
  const s = 256, c = canvas(s), x = c.getContext('2d');
  x.fillStyle = '#6e5a44'; x.fillRect(0, 0, s, s);
  // Brushed horizontal bands.
  for (let y = 0; y < s; y += 4) {
    x.fillStyle = `rgba(${20 + Math.random() * 40},${16 + Math.random() * 30},10,${0.08 + Math.random() * 0.1})`;
    x.fillRect(0, y, s, 2);
  }
  speckle(x, s, 900, ['#7d6a52', '#5d4c39', '#8a5a3b'], 0.4);
  // Rust blooms.
  for (let i = 0; i < 7; i++) {
    const g = x.createRadialGradient(0, 0, 2, 0, 0, 18 + Math.random() * 26);
    g.addColorStop(0, 'rgba(138,90,59,0.55)');
    g.addColorStop(1, 'rgba(138,90,59,0)');
    x.save();
    x.translate(Math.random() * s, Math.random() * s);
    x.fillStyle = g;
    x.fillRect(-50, -50, 100, 100);
    x.restore();
  }
  x.strokeStyle = '#4a3d2d'; x.lineWidth = 5;
  x.strokeRect(2, 2, s - 4, s - 4);
  return tex(c);
}

function crateTexture() {
  const s = 256, c = canvas(s), x = c.getContext('2d');
  x.fillStyle = '#8d724c'; x.fillRect(0, 0, s, s);
  // Planks.
  for (let i = 0; i < 4; i++) {
    const y = i * 64;
    x.fillStyle = ['#967b54', '#8a7049', '#9a7f58', '#87714a'][i];
    x.fillRect(0, y, s, 64);
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.fillRect(0, y, s, 3);
    // Grain.
    x.strokeStyle = 'rgba(60,45,25,0.3)'; x.lineWidth = 1;
    for (let g = 0; g < 6; g++) {
      const gy = y + 8 + Math.random() * 48;
      x.beginPath(); x.moveTo(0, gy);
      x.bezierCurveTo(s * 0.3, gy + 4, s * 0.6, gy - 4, s, gy + 2);
      x.stroke();
    }
  }
  speckle(x, s, 700, ['#6f5a3e', '#a3865f'], 0.35);
  // Frame and stencil.
  x.strokeStyle = '#5d4a30'; x.lineWidth = 14;
  x.strokeRect(7, 7, s - 14, s - 14);
  x.fillStyle = 'rgba(240,230,200,0.55)';
  x.font = 'bold 34px monospace';
  x.fillText('FNDRY-9', 52, 140);
  return tex(c);
}

function hazardTexture() {
  const s = 128, c = canvas(s), x = c.getContext('2d');
  x.fillStyle = '#d9a441'; x.fillRect(0, 0, s, s);
  x.fillStyle = '#1c1d20';
  for (let i = -2; i < 6; i++) {
    x.beginPath();
    x.moveTo(i * 32, s); x.lineTo(i * 32 + 32, 0);
    x.lineTo(i * 32 + 48, 0); x.lineTo(i * 32 + 16, s);
    x.closePath(); x.fill();
  }
  return tex(c);
}

function glowTexture(inner, outer) {
  const s = 128, c = canvas(s), x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  const t = tex(c, false);
  return t;
}

function letterTexture(letter, color) {
  const s = 128, c = canvas(s), x = c.getContext('2d');
  x.clearRect(0, 0, s, s);
  x.font = 'bold 96px monospace';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = color; x.shadowBlur = 18;
  x.fillStyle = color;
  x.fillText(letter, s / 2, s / 2 + 4);
  return tex(c, false);
}

export function makeTextures() {
  return {
    floor: floorTexture(),
    wall: wallTexture(),
    metal: metalTexture(),
    crate: crateTexture(),
    hazard: hazardTexture(),
    flash: glowTexture('rgba(255,240,200,1)', 'rgba(255,160,60,0.7)'),
    smoke: glowTexture('rgba(150,150,160,0.85)', 'rgba(105,105,115,0.45)'),
    spark: glowTexture('rgba(255,255,255,1)', 'rgba(255,200,120,0.6)'),
    blood: glowTexture('rgba(200,40,30,0.9)', 'rgba(140,20,15,0.5)'),
    decal: glowTexture('rgba(10,10,12,0.85)', 'rgba(10,10,12,0.35)'),
    letterA: letterTexture('A', '#ffd27a'),
    letterB: letterTexture('B', '#ffd27a'),
  };
}
