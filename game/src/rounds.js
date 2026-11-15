// BREACHLINE — rounds, match flow, economy and objectives. The state
// machine: freeze (buy, 3 s) -> live (100 s clock) -> roundEnd (3.5 s) ->
// next freeze, until one team takes 7 rounds. Vanguard wins by elimination
// or detonation; Sentinels by elimination, defuse, or the clock. Money is
// earned per round and per kill and spent in the buy menu; weapons, armour
// and grenades persist across rounds until their owner dies holding them.

import {
  ARMOR_PRICE, BOMB_TIME, BUY_TIME, DEFUSE_REWARD, FREEZE_TIME, GRENADES,
  LOSS_REWARD, MAX_GRENADES, MAX_MONEY, MAX_ROUNDS, PLANT_REWARD, ROUND_TIME,
  ROUNDS_TO_WIN, START_MONEY, WEAPONS, WIN_REWARD,
} from './config.js';
import {
  announce, giveArmor, makeBrain, pushEvent, spawnFighter,
} from './state.js';
import { giveWeapon } from './weapons.js';
import { SITES } from './map.js';

export function startMatch(state) {
  state.score.vanguard = 0;
  state.score.sentinel = 0;
  state.round = 1;
  state.matchWinner = null;
  state.roundWinner = null;
  for (const f of state.fighters) {
    f.money = START_MONEY;
    f.weapons = { main: null, side: 'p9' };
    f.current = 'side';
    for (const id of Object.keys(WEAPONS)) f.ammo[id] = { mag: 0, reserve: 0 };
    f.ammo.p9 = { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve };
    f.grenades = { frag: 0, flash: 0, smoke: 0 };
    f.armor = 0;
    f.kills = 0; f.deaths = 0; f.damageDealt = 0;
    if (!f.isPlayer && !f.bot) f.bot = makeBrain(state.rng, f.team);
  }
  state.killfeed.length = 0;
  startRound(state);
}

export function startRound(state) {
  state.phase = 'freeze';
  state.phaseTime = 0;
  state.roundTime = ROUND_TIME;
  state.roundWinner = null;
  state.roundReason = '';
  state.buyUntil = state.time + BUY_TIME;
  state.buyOpen = false;
  state.grenades.length = 0;
  state.smokes.length = 0;
  state.tracers.length = 0;
  state.impacts.length = 0;
  state.noises.length = 0;
  state.spectate = -1;
  const teamIndex = { vanguard: 0, sentinel: 0 };
  for (const f of state.fighters) {
    spawnFighter(state, f, teamIndex[f.team]++);
    if (f.bot) {
      f.bot.bought = false;
      f.bot.mode = 'route';
      f.bot.target = -1;
      f.bot.investigate = null;
      f.bot.path = [];
      f.bot.pathIdx = 0;
    }
  }
  // The player carries the charge every round; if they fall, a teammate
  // bot fetches it (see bots.js).
  state.charge.state = 'carried';
  state.charge.carrier = 0;
  state.charge.site = null;
  state.charge.fuse = 0;
  state.player.hasCharge = true;
  state.needsRoles = true; // sim.js assigns bot roles once per round
  announce(state, `ROUND ${state.round}`, 'Vanguard: plant the charge. Sentinels: hold the sites.', 3);
  pushEvent(state, { kind: 'roundStart', round: state.round });
}

function matchDecided(state) {
  return state.score.vanguard >= ROUNDS_TO_WIN ||
    state.score.sentinel >= ROUNDS_TO_WIN ||
    state.round >= MAX_ROUNDS;
}

export function endRound(state, winner, reason) {
  if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
  state.phase = 'roundEnd';
  state.phaseTime = 0;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner] += 1;
  for (const f of state.fighters) {
    f.money = Math.min(MAX_MONEY, f.money + (f.team === winner ? WIN_REWARD : LOSS_REWARD));
  }
  const label = winner === 'vanguard' ? 'VANGUARD WINS THE ROUND' : 'SENTINELS WIN THE ROUND';
  announce(state, label, reason, 3.2);
  pushEvent(state, { kind: 'roundEnd', winner, reason });
}

export function updateRound(state, dt) {
  state.phaseTime += dt;
  if (state.phase === 'freeze') {
    if (state.phaseTime >= FREEZE_TIME) {
      state.phase = 'live';
      state.phaseTime = 0;
      pushEvent(state, { kind: 'roundLive' });
    }
    return;
  }
  if (state.phase === 'roundEnd') {
    if (state.phaseTime >= 3.5) {
      if (matchDecided(state)) {
        state.phase = 'matchEnd';
        state.phaseTime = 0;
        state.matchWinner = state.score.vanguard > state.score.sentinel ? 'vanguard' : 'sentinel';
        pushEvent(state, { kind: 'matchEnd', winner: state.matchWinner });
      } else {
        state.round += 1;
        startRound(state);
      }
    }
    return;
  }
  if (state.phase !== 'live') return;

  // Planted charge: the fuse runs the round now.
  if (state.charge.state === 'planted') {
    state.charge.fuse -= dt;
    if (state.charge.fuse <= 0) {
      pushEvent(state, {
        kind: 'detonation', x: state.charge.pos.x, y: 0.5, z: state.charge.pos.z,
        site: state.charge.site,
      });
      state.charge.state = 'gone';
      endRound(state, 'vanguard', 'The charge detonated.');
      return;
    }
  } else {
    state.roundTime -= dt;
    if (state.roundTime <= 0) {
      state.roundTime = 0;
      endRound(state, 'sentinel', 'Time expired — the charge was never planted.');
      return;
    }
  }

  // Elimination: with the charge planted, the round plays out to the fuse
  // or a defuse; without it, wiping the enemy team wins at once.
  let vAlive = 0, sAlive = 0;
  for (const f of state.fighters) {
    if (!f.alive) continue;
    if (f.team === 'vanguard') vAlive++; else sAlive++;
  }
  if (vAlive === 0) {
    endRound(state, 'sentinel', state.charge.state === 'planted'
      ? 'All attackers down — the site is safe.'
      : 'Vanguard eliminated.');
  } else if (sAlive === 0 && state.charge.state !== 'planted') {
    endRound(state, 'vanguard', 'Sentinels eliminated.');
  }
}

export function completePlant(state, f, site) {
  state.charge.state = 'planted';
  state.charge.site = site;
  state.charge.fuse = BOMB_TIME;
  state.charge.pos.x = f.pos.x;
  state.charge.pos.y = 0;
  state.charge.pos.z = f.pos.z;
  f.hasCharge = false;
  f.money = Math.min(MAX_MONEY, f.money + PLANT_REWARD);
  announce(state, 'CHARGE PLANTED', `${SITES[site].name} — ${BOMB_TIME}s to detonation`, 3);
  pushEvent(state, { kind: 'planted', fighter: f.id, site });
}

export function completeDefuse(state, f) {
  state.charge.state = 'gone';
  f.money = Math.min(MAX_MONEY, f.money + DEFUSE_REWARD);
  pushEvent(state, { kind: 'defused', fighter: f.id });
  endRound(state, 'sentinel', 'The charge was defused.');
}

// The buy menu: weapons (buying one you own refills its ammo), armour and
// grenades. Only while the buy window is open and the buyer is alive.
export function buyItem(state, f, id) {
  if (!f.alive) return { ok: false, reason: 'You are down.' };
  if (state.time >= state.buyUntil) return { ok: false, reason: 'Buy window closed.' };
  if (WEAPONS[id]) {
    const w = WEAPONS[id];
    if (f.money < w.price) return { ok: false, reason: 'Not enough money.' };
    f.money -= w.price;
    giveWeapon(f, id);
    pushEvent(state, { kind: 'buy', fighter: f.id, item: id });
    return { ok: true, reason: `${w.name} purchased.` };
  }
  if (id === 'armor') {
    if (f.armor > 0) return { ok: false, reason: 'Armour already worn.' };
    if (f.money < ARMOR_PRICE) return { ok: false, reason: 'Not enough money.' };
    f.money -= ARMOR_PRICE;
    giveArmor(f);
    pushEvent(state, { kind: 'buy', fighter: f.id, item: id });
    return { ok: true, reason: 'Armour purchased.' };
  }
  if (GRENADES[id]) {
    const g = GRENADES[id];
    const total = f.grenades.frag + f.grenades.flash + f.grenades.smoke;
    if (total >= MAX_GRENADES) return { ok: false, reason: 'Grenade pouch full.' };
    if (f.money < g.price) return { ok: false, reason: 'Not enough money.' };
    f.money -= g.price;
    f.grenades[id] += 1;
    f.heldGrenade = id;
    pushEvent(state, { kind: 'buy', fighter: f.id, item: id });
    return { ok: true, reason: `${g.name} grenade purchased.` };
  }
  return { ok: false, reason: 'Unknown item.' };
}
