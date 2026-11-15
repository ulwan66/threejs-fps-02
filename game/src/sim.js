// BREACHLINE — the fixed-step simulation. stepGame advances the world by
// exactly SIM_DT; the renderer calls it as many times as the frame budget
// needs and never more, so the game plays identically at any refresh rate.
// Order is fixed: timers, round machine, player, bots, separation,
// grenades, objective beeps. Nothing here touches the DOM or three.js.

import { SIM_DT } from './config.js';
import { assignBotRoles, updateBot } from './bots.js';
import { updateGrenades } from './combat.js';
import { updatePlayer } from './player.js';
import { updateRound } from './rounds.js';
import { pushEvent } from './state.js';
import { recoverRecoil } from './weapons.js';

export function stepGame(state, input, dt = SIM_DT) {
  state.time += dt;
  const now = state.time;

  // Expire transient queues.
  for (let i = state.tracers.length - 1; i >= 0; i--) {
    if (now > state.tracers[i].until) state.tracers.splice(i, 1);
  }
  for (let i = state.impacts.length - 1; i >= 0; i--) {
    if (now > state.impacts[i].until) state.impacts.splice(i, 1);
  }
  for (let i = state.noises.length - 1; i >= 0; i--) {
    if (now - state.noises[i].time > 1.2) state.noises.splice(i, 1);
  }
  for (let i = state.killfeed.length - 1; i >= 0; i--) {
    if (now > state.killfeed[i].until) state.killfeed.splice(i, 1);
  }
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (now > state.messages[i].until) state.messages.splice(i, 1);
  }

  if (state.needsRoles) {
    state.needsRoles = false;
    assignBotRoles(state);
  }

  // Shared per-fighter timers: fire cooldowns, flash decay, and recoil
  // recovery — every fighter's kick decays here, bots included, or their
  // aim would climb into the sky and never come back.
  for (const f of state.fighters) {
    if (f.fireCooldown > 0) f.fireCooldown -= dt;
    if (now >= f.flashUntil) f.flashPeak = 0;
    recoverRecoil(f, dt);
  }

  updateRound(state, dt);

  if (state.phase === 'freeze' || state.phase === 'live') {
    updatePlayer(state, state.player, input, dt);
    for (const f of state.fighters) {
      if (!f.isPlayer) updateBot(state, f, dt);
    }
    separateFighters(state);
  }
  updateGrenades(state, dt);

  // Planted charge beeps, faster as the fuse runs down.
  if (state.charge.state === 'planted') {
    const fuse = state.charge.fuse;
    const interval = fuse > 20 ? 1.0 : fuse > 10 ? 0.6 : fuse > 5 ? 0.35 : 0.18;
    if (now >= (state.beepAt || 0)) {
      state.beepAt = now + interval;
      pushEvent(state, { kind: 'beep', urgent: fuse < 10 });
    }
  }

  // Spectate: when the player is down, follow the first living teammate.
  if (!state.player.alive && state.phase === 'live') {
    const mate = state.fighters.find((f) => f.alive && f.team === 'vanguard');
    state.spectate = mate ? mate.id : -1;
  } else {
    state.spectate = -1;
  }
}

// Soft body separation so fighters never stack inside each other. The
// push is small and purely horizontal; walls still win via moveBody.
function separateFighters(state) {
  const list = state.fighters;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b.alive) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 0.49 || d2 < 1e-9) continue;
      const d = Math.sqrt(d2);
      const push = (0.7 - d) * 0.5;
      const nx = dx / d, nz = dz / d;
      a.pos.x -= nx * push; a.pos.z -= nz * push;
      b.pos.x += nx * push; b.pos.z += nz * push;
    }
  }
}
