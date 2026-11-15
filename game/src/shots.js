// BREACHLINE — screenshot staging. ?shot=cover|buy|combat|plant poses a
// real game state through the same code paths the player uses (startMatch,
// the same spawn/pose state, the same renderer and HUD), then freezes the
// simulation so the frame is stable for capture. Nothing here draws pixels
// that the game itself would not draw: these are the game's own renders of
// its own state, staged for the camera like a photo mode.

import { startMatch } from './rounds.js';
import { addKillfeed } from './state.js';
import { giveWeapon } from './weapons.js';
import { eyePos } from './combat.js';
import { v3 } from './utils.js';

const _eye = v3();

function pose(state, id, x, z, yaw, pitch = 0) {
  const f = state.fighters[id];
  f.pos.x = x; f.pos.z = z; f.pos.y = 0;
  f.yaw = yaw; f.pitch = pitch;
  f.vel.x = 0; f.vel.y = 0; f.vel.z = 0;
  return f;
}

function stageCommon(state, round, scoreV, scoreS, roundTime) {
  startMatch(state);
  state.needsRoles = false;
  state.phase = 'live';
  state.phaseTime = 0;
  state.round = round;
  state.score.vanguard = scoreV;
  state.score.sentinel = scoreS;
  state.roundTime = roundTime;
  state.messages.length = 0;
}

export function applyShotMode(state, params) {
  const mode = params.get('shot');
  if (!mode) return null;
  const p = state.player;

  if (mode === 'cover') {
    // Mid-hall standoff: rifle up, two defenders ahead, smoke drifting.
    stageCommon(state, 3, 2, 1, 62);
    giveWeapon(p, 'ar4');
    p.armor = 50;
    p.money = 3200;
    p.grenades = { frag: 1, flash: 1, smoke: 0 };
    pose(state, 0, -8, 0.5, -Math.PI / 2, 0.01);
    pose(state, 1, -4.5, -2.6, -Math.PI / 2);
    // Defenders pushing through the mid double doors, framed by the gap.
    pose(state, 5, 5, -1.2, Math.PI / 2);
    pose(state, 6, 6.5, 1.6, Math.PI / 2 - 0.3);
    pose(state, 7, 13, 0.5, Math.PI / 2);
    state.smokes.push({ x: 3, y: 1.1, z: 3.6, radius: 5.5, until: state.time + 999, born: state.time - 2 });
    addKillfeed(state, 'Rook AR-4 Hollow', 'vanguard');
    state.messages.length = 0;
    return null; // frozen frame; nothing needs refreshing
  }

  if (mode === 'buy') {
    // Buy phase at spawn, menu open, a full wallet.
    startMatch(state);
    state.needsRoles = false;
    state.phase = 'freeze';
    state.phaseTime = 0.5;
    state.buyUntil = state.time + 999;
    state.buyOpen = true;
    p.money = 4800;
    p.grenades = { frag: 0, flash: 0, smoke: 0 };
    pose(state, 0, -28.5, 0, -Math.PI / 2);
    state.messages.length = 0;
    return null;
  }

  if (mode === 'combat') {
    // Firing down the north lane: muzzle flash, tracer, hitmarker, an
    // enemy caught in the open. The staging refreshes the flash, tracer
    // and hitmarker every frame so the capture catches the action.
    stageCommon(state, 5, 3, 2, 41);
    giveWeapon(p, 'ar4');
    p.ammo.ar4 = { mag: 24, reserve: 90 };
    p.armor = 34;
    p.hp = 78;
    p.money = 1500;
    p.grenades = { frag: 0, flash: 1, smoke: 1 };
    pose(state, 0, 2, -18, -Math.PI / 2, 0.01);
    const enemy = pose(state, 5, 12, -18, Math.PI / 2);
    enemy.hp = 62;
    pose(state, 6, 17, -15.5, Math.PI / 2 + 0.4);
    pose(state, 1, -1, -16, -Math.PI / 2);
    return (st) => {
      const now = st.time;
      p.muzzleUntil = now + 999;
      p.fireCooldown = 0;
      eyePos(p, _eye);
      st.tracers.length = 0;
      st.tracers.push({
        fx: _eye.x + 0.45, fy: _eye.y - 0.14, fz: _eye.z + 0.18,
        tx: enemy.pos.x, ty: enemy.pos.y + 1.15, tz: enemy.pos.z,
        color: 0xffe9b0, until: now + 999,
      });
      st.events.push({ kind: 'damaged', victim: enemy.id, attacker: p.id, amount: 30, head: false, weapon: 'ar4' });
    };
  }

  if (mode === 'plant') {
    // Planting inside Site A, looking north into the site: ring underfoot,
    // letter overhead, teammates covering both approaches.
    stageCommon(state, 2, 1, 1, 55);
    giveWeapon(p, 'k7');
    p.money = 900;
    pose(state, 0, 24, -15.5, 0.74, -0.06);
    pose(state, 1, 17, -17, Math.PI / 2);
    pose(state, 2, 19.5, -22.5, 0);
    return (st) => {
      // Hold the channel at ~60% so the progress bar reads clearly.
      p.channel = { kind: 'plant', site: 'A', until: st.time + 1.2, total: 3 };
    };
  }

  return null;
}
