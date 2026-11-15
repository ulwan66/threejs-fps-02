// BREACHLINE — HUD: every DOM element the player reads, plus the menus.
// Text is only rewritten when it changes, the minimap redraws at 6 Hz, and
// the buy menu is built once from the same tables the sim prices from, so
// the menu can never disagree with the game.

import { GRENADES, WEAPONS, ARMOR_PRICE } from './config.js';
import { SOLIDS, SITES, siteAt } from './map.js';
import { lineOfSight } from './collision.js';
import { currentAmmo, currentWeapon, spreadNow } from './weapons.js';
import { eyeHeight } from './state.js';
import { clamp } from './utils.js';

const $ = (id) => document.getElementById(id);

const BUY_KEYS = [
  { key: '1', id: 'k7' }, { key: '2', id: 'ar4' }, { key: '3', id: 'm870' },
  { key: '4', id: 'dmr9' }, { key: '5', id: 'armor' }, { key: '6', id: 'frag' },
  { key: '7', id: 'flash' }, { key: '8', id: 'smoke' },
];

export class HUD {
  constructor(callbacks) {
    this.cb = callbacks;
    this.cache = {};
    this.hitUntil = 0;
    this.hitKill = false;
    this.dmgDirUntil = 0;
    this.dmgDirAngle = 0;
    this.mapAt = 0;
    this.buyMsg = '';
    this.buyMsgUntil = 0;
  }

  bind() {
    this.el = {};
    for (const id of ['hud', 'crosshair', 'hitmarker', 'health-num', 'health-fill', 'armor-num',
      'ammo-mag', 'ammo-reserve', 'weapon-name', 'grenade-pips', 'money', 'timer',
      'score-v', 'score-s', 'round-label', 'phase-label', 'killfeed', 'announce',
      'announce-text', 'announce-sub', 'bomb-bar', 'bomb-fill', 'bomb-label',
      'channel-bar', 'channel-fill', 'channel-label', 'minimap', 'damage-vignette',
      'flash-overlay', 'scope-overlay', 'dir-indicator', 'buy-menu', 'buy-items',
      'buy-money', 'buy-msg', 'start-menu', 'pause-menu', 'end-menu', 'end-title',
      'end-stats', 'down-banner', 'buy-hint', 'charge-tag', 'plant-hint', 'reload-hint',
    ]) this.el[id] = $(id);
    this.mapCtx = this.el['minimap'].getContext('2d');
    $('deploy-btn').addEventListener('click', () => this.cb.onDeploy());
    $('resume-btn').addEventListener('click', () => this.cb.onResume());
    $('again-btn').addEventListener('click', () => this.cb.onRestart());
    $('buy-close').addEventListener('click', () => this.cb.onCloseBuy());
    this.buildBuyMenu();
  }

  buildBuyMenu() {
    const wrap = this.el['buy-items'];
    wrap.innerHTML = '';
    for (const { key, id } of BUY_KEYS) {
      const def = WEAPONS[id] || GRENADES[id];
      const name = id === 'armor' ? 'KEVLAR ARMOUR' : def.name;
      const price = id === 'armor' ? ARMOR_PRICE : def.price;
      const desc = WEAPONS[id]
        ? `${def.damage} dmg · ${def.mag} rounds · ${def.auto ? 'auto' : 'semi'}`
        : id === 'armor' ? 'Absorbs half of each hit'
        : id === 'frag' ? 'Explosive · 6.5 m blast'
        : id === 'flash' ? 'Blinds anyone facing it'
        : 'Blocks sight for 14 s';
      const btn = document.createElement('button');
      btn.className = 'buy-item';
      btn.innerHTML = `<span class="buy-key">${key}</span><span class="buy-name">${name}</span><span class="buy-desc">${desc}</span><span class="buy-price">$${price}</span>`;
      btn.addEventListener('click', () => this.cb.onBuy(id));
      btn.dataset.item = id;
      wrap.appendChild(btn);
    }
  }

  setText(id, value) {
    if (this.cache[id] !== value) {
      this.cache[id] = value;
      this.el[id].textContent = value;
    }
  }

  handleEvent(state, ev) {
    const p = state.player;
    if (ev.kind === 'damaged' && ev.attacker === p.id) {
      this.hitUntil = state.time + 0.12;
      this.hitKill = false;
    }
    if (ev.kind === 'kill' && ev.killer === p.id) {
      this.hitUntil = state.time + 0.28;
      this.hitKill = true;
    }
    if (ev.kind === 'damaged' && ev.victim === p.id && ev.attacker >= 0) {
      const a = state.fighters[ev.attacker];
      const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      // Bearing of the attacker relative to the facing: 0 = ahead, + = right.
      const fComp = (dx * -Math.sin(p.yaw) + dz * -Math.cos(p.yaw)) / d;
      const rComp = (dx * Math.cos(p.yaw) + dz * -Math.sin(p.yaw)) / d;
      this.dmgDirAngle = Math.atan2(rComp, fComp);
      this.dmgDirUntil = state.time + 1.1;
      this.dmgFlash = state.time + 0.35;
    }
  }

  update(state, input, dt) {
    const p = state.player;
    const now = state.time;
    const playing = state.phase === 'live' || state.phase === 'freeze' || state.phase === 'roundEnd';

    // Overlays.
    this.el['start-menu'].classList.toggle('hidden', state.phase !== 'menu');
    this.el['end-menu'].classList.toggle('hidden', state.phase !== 'matchEnd');
    this.el['pause-menu'].classList.toggle('hidden', !(state.paused && playing && !state.buyOpen));
    this.el['buy-menu'].classList.toggle('hidden', !state.buyOpen);
    this.el['hud'].classList.toggle('hidden', !playing);

    if (state.phase === 'matchEnd' && state.matchWinner) {
      const won = state.matchWinner === 'vanguard';
      this.setText('end-title', won ? 'VANGUARD TAKES THE MATCH' : 'SENTINELS TAKE THE MATCH');
      this.setText('end-stats',
        `Final score ${state.score.vanguard} — ${state.score.sentinel} · ` +
        `You: ${p.kills} kills, ${p.deaths} deaths, ${Math.round(p.damageDealt)} damage`);
    }
    if (!playing) return;

    // Buy menu keys while it is open.
    if (state.buyOpen) {
      if (input.takePressed('Escape')) this.cb.onCloseBuy();
      for (const { key, id } of BUY_KEYS) {
        if (input.takePressed('Digit' + key)) this.cb.onBuy(id);
      }
      this.setText('buy-money', `$${p.money}`);
      for (const btn of this.el['buy-items'].children) {
        const id = btn.dataset.item;
        const def = WEAPONS[id] || GRENADES[id];
        const price = id === 'armor' ? ARMOR_PRICE : def.price;
        btn.classList.toggle('cant', p.money < price);
        const owned = WEAPONS[id] && p.weapons[WEAPONS[id].slot] === id;
        btn.classList.toggle('owned', !!owned);
      }
      if (now < this.buyMsgUntil) this.setText('buy-msg', this.buyMsg);
      else this.setText('buy-msg', 'Re-buying a weapon refills its ammo. Grenade pouch holds 3.');
    }

    // Vital signs.
    this.setText('health-num', String(Math.max(0, Math.ceil(p.hp))));
    const hpFrac = clamp(p.hp / 100, 0, 1);
    this.el['health-fill'].style.width = `${hpFrac * 100}%`;
    this.el['health-fill'].className = 'fill ' + (hpFrac > 0.5 ? 'ok' : hpFrac > 0.25 ? 'low' : 'crit');
    this.setText('armor-num', p.armor > 0 ? `◈ ${Math.ceil(p.armor)}` : '');
    const w = currentWeapon(p);
    const ammo = currentAmmo(p);
    if (p.current === 'grenade') {
      this.setText('weapon-name', `${GRENADES[p.heldGrenade].name} GRENADE`);
      this.setText('ammo-mag', String(p.grenades[p.heldGrenade]));
      this.setText('ammo-reserve', '');
    } else {
      this.setText('weapon-name', w.name);
      this.setText('ammo-mag', String(ammo.mag));
      this.setText('ammo-reserve', `/ ${ammo.reserve}`);
    }
    this.el['reload-hint'].classList.toggle('hidden', !(p.reloading || (ammo && ammo.mag === 0 && p.current !== 'grenade' && p.alive)));
    this.setText('reload-hint', p.reloading ? 'RELOADING…' : 'PRESS R — RELOAD');
    const pips = ['frag', 'flash', 'smoke'].map((g) => `${GRENADES[g].name[0]}×${p.grenades[g]}`).join('  ');
    this.setText('grenade-pips', pips);
    this.setText('money', `$${p.money}`);

    // Round state.
    const t = Math.max(0, Math.ceil(state.roundTime));
    this.setText('timer', state.charge.state === 'planted' ? '💣' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    this.el['timer'].classList.toggle('urgent', t <= 10 && state.phase === 'live' && state.charge.state !== 'planted');
    this.setText('score-v', String(state.score.vanguard));
    this.setText('score-s', String(state.score.sentinel));
    this.setText('round-label', `ROUND ${state.round}/${state.maxRounds}`);
    this.setText('phase-label', state.phase === 'freeze' ? 'BUY PHASE' : state.phase === 'live' ? 'LIVE' : state.phase.toUpperCase());
    this.el['buy-hint'].classList.toggle('hidden', !(now < state.buyUntil && p.alive && !state.buyOpen));

    // Charge + plant.
    this.el['charge-tag'].classList.toggle('hidden', !p.hasCharge);
    const inSite = p.alive && p.hasCharge && siteAt(p.pos.x, p.pos.z) && state.phase === 'live';
    this.el['plant-hint'].classList.toggle('hidden', !inSite || !!p.channel);
    if (p.channel) {
      const frac = 1 - (p.channel.until - now) / p.channel.total;
      this.el['channel-bar'].classList.remove('hidden');
      this.el['channel-fill'].style.width = `${clamp(frac, 0, 1) * 100}%`;
      this.setText('channel-label', p.channel.kind === 'plant' ? 'PLANTING CHARGE…' : 'DEFUSING…');
    } else {
      this.el['channel-bar'].classList.add('hidden');
    }

    // Bomb bar.
    if (state.charge.state === 'planted') {
      this.el['bomb-bar'].classList.remove('hidden');
      this.el['bomb-fill'].style.width = `${clamp(state.charge.fuse / 35, 0, 1) * 100}%`;
      this.setText('bomb-label', `CHARGE AT SITE ${state.charge.site} — ${state.charge.fuse.toFixed(1)}s`);
    } else {
      this.el['bomb-bar'].classList.add('hidden');
    }

    // Killfeed.
    const feed = state.killfeed.map((k) => `<div class="kf ${k.team || ''}">${k.text}</div>`).join('');
    if (this.cache.feed !== feed) { this.cache.feed = feed; this.el['killfeed'].innerHTML = feed; }

    // Announcements.
    const msg = state.messages[state.messages.length - 1];
    if (msg) {
      this.el['announce'].classList.remove('hidden');
      this.setText('announce-text', msg.text);
      this.setText('announce-sub', msg.sub);
    } else {
      this.el['announce'].classList.add('hidden');
    }

    // Crosshair: gap follows the live spread cone (no weapon when a
    // grenade is held, so the gap falls back to its resting size).
    const spread = w ? spreadNow(p, w, !!p.zoomed) : 0;
    const gap = 5 + spread * 300;
    this.el['crosshair'].style.setProperty('--gap', `${gap.toFixed(1)}px`);
    this.el['crosshair'].classList.toggle('hidden', !p.alive || state.buyOpen || !!p.zoomed || p.current === 'grenade');
    this.el['scope-overlay'].classList.toggle('hidden', !p.zoomed || !p.alive);

    // Hitmarker + damage direction + vignette.
    this.el['hitmarker'].classList.toggle('hidden', now >= this.hitUntil);
    this.el['hitmarker'].classList.toggle('kill', this.hitKill && now < this.hitUntil);
    if (now < this.dmgDirUntil) {
      this.el['dir-indicator'].classList.remove('hidden');
      this.el['dir-indicator'].style.transform = `translate(-50%,-50%) rotate(${this.dmgDirAngle}rad)`;
      this.el['dir-indicator'].style.opacity = String(clamp((this.dmgDirUntil - now) / 1.1, 0, 1));
    } else {
      this.el['dir-indicator'].classList.add('hidden');
    }
    const lowHp = p.alive ? clamp(1 - p.hp / 45, 0, 1) * 0.5 : 0;
    const flash = now < (this.dmgFlash || 0) ? 0.45 : 0;
    this.el['damage-vignette'].style.opacity = String(clamp(lowHp + flash, 0, 0.85));
    const blind = now < p.flashUntil ? clamp(p.flashPeak * (p.flashUntil - now) / 2.6 + 0.25, 0, 1) : 0;
    this.el['flash-overlay'].style.opacity = String(blind);

    // Down / spectate banner.
    if (!p.alive && state.phase === 'live') {
      this.el['down-banner'].classList.remove('hidden');
      const mate = state.spectate >= 0 ? state.fighters[state.spectate] : null;
      this.setText('down-banner', mate ? `YOU ARE DOWN — SPECTATING ${mate.name.toUpperCase()}` : 'YOU ARE DOWN');
    } else {
      this.el['down-banner'].classList.add('hidden');
    }

    if (now - this.mapAt > 0.15) {
      this.mapAt = now;
      this.drawMinimap(state);
    }
  }

  drawMinimap(state) {
    const ctx = this.mapCtx;
    const W = 168, H = 128;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(16,18,26,0.82)';
    ctx.fillRect(0, 0, W, H);
    const sx = (x) => (x + 33) / 66 * W;
    const sz = (z) => (z + 25) / 50 * H;
    ctx.fillStyle = '#565b66';
    for (const s of SOLIDS) {
      ctx.fillRect(sx(s.x0), sz(s.z0), Math.max(1, sx(s.x1) - sx(s.x0)), Math.max(1, sz(s.z1) - sz(s.z0)));
    }
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      ctx.fillStyle = state.charge.state === 'planted' && state.charge.site === key ? '#ff5a3c' : '#ffd27a';
      ctx.fillText(key, sx(s.cx), sz(s.cz) + 4);
    }
    if (state.charge.state === 'dropped') {
      ctx.fillStyle = '#ff5a3c';
      ctx.beginPath();
      ctx.arc(sx(state.charge.pos.x), sz(state.charge.pos.z), 3, 0, 7);
      ctx.fill();
    }
    // Enemies only when the player can actually see them.
    const p = state.player;
    const px = p.pos.x, py = p.pos.y + eyeHeight(p), pz = p.pos.z;
    for (const f of state.fighters) {
      if (!f.alive || f.isPlayer) continue;
      if (f.team !== p.team) {
        const seen = lineOfSight(px, py, pz, f.pos.x, f.pos.y + 1.2, f.pos.z, SOLIDS, state.smokes) &&
          Math.hypot(f.pos.x - px, f.pos.z - pz) < 46;
        if (!seen) continue;
      }
      ctx.fillStyle = f.team === 'vanguard' ? '#e08a2e' : '#3fa7c4';
      ctx.beginPath();
      ctx.arc(sx(f.pos.x), sz(f.pos.z), 3, 0, 7);
      ctx.fill();
    }
    // Player wedge, rotated by yaw.
    ctx.save();
    ctx.translate(sx(p.pos.x), sz(p.pos.z));
    ctx.rotate(-p.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -5); ctx.lineTo(3.6, 4); ctx.lineTo(-3.6, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  setBuyMessage(text, until) {
    this.buyMsg = text;
    this.buyMsgUntil = until;
  }
}
