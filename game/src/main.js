// BREACHLINE — boot and the frame loop. The simulation runs on a fixed
// 60 Hz step behind an accumulator; rendering, HUD and audio read the
// latest state once per animation frame. The loop never lets the sim fall
// more than five steps behind, so a slow frame costs time, never stability.

import { SIM_DT } from './config.js';
import { createState, spawnFighter } from './state.js';
import { Input } from './input.js';
import { Renderer } from './render.js';
import { HUD } from './hud.js';
import { SoundFX } from './audio.js';
import { stepGame } from './sim.js';
import { buyItem, startMatch } from './rounds.js';
import { applyShotMode } from './shots.js';

const params = new URLSearchParams(location.search);
const seed = Number.parseInt(params.get('seed') || '1337', 10) || 1337;
const state = createState(seed);

// Menu backdrop: fighters at their spawns, the player looking down mid,
// so the title screen sits on the real map instead of a blank frame.
{
  const teamIndex = { vanguard: 0, sentinel: 0 };
  for (const f of state.fighters) spawnFighter(state, f, teamIndex[f.team]++);
  state.player.yaw = -Math.PI / 2;
}

const canvas = document.getElementById('game');
const input = new Input();
input.attach(canvas);
const renderer = new Renderer(canvas, state);
const sfx = new SoundFX();
const hud = new HUD({
  onDeploy() {
    sfx.ensure();
    state.paused = false;
    startMatch(state);
    input.requestLock();
  },
  onResume() {
    input.requestLock();
  },
  onRestart() {
    sfx.ensure();
    state.paused = false;
    startMatch(state);
    input.requestLock();
  },
  onCloseBuy() {
    state.buyOpen = false;
    input.requestLock();
  },
  onBuy(id) {
    const result = buyItem(state, state.player, id);
    hud.setBuyMessage(result.reason, state.time + 2.5);
    if (result.ok) sfx.handleEvent(state, { kind: 'buy' });
  },
});
hud.bind();

// Losing pointer lock mid-round pauses the sim; regaining it resumes.
input.onLockLost = () => {
  const playing = state.phase === 'live' || state.phase === 'freeze';
  if (playing && !state.buyOpen && !state.shotMode) state.paused = true;
};
input.onLockGained = () => { state.paused = false; };
// Clicking the canvas while playing re-locks (after ESC, for example).
canvas.addEventListener('click', () => {
  const playing = state.phase === 'live' || state.phase === 'freeze';
  if (playing && !state.buyOpen && !input.locked && !state.shotMode) input.requestLock();
});

function resize() {
  renderer.resize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

// Screenshot staging (?shot=...): poses a real game state and freezes the
// sim, advancing only the render clock so pulses and smoke stay alive.
const stageFrame = applyShotMode(state, params);
if (stageFrame !== null || params.has('shot')) state.shotMode = params.get('shot') || 'staged';
if (params.has('debug') || params.has('shot')) {
  window.__BREACHLINE__ = { state, input, stepGame, SIM_DT, startMatch, buyItem };
}

let last = performance.now();
let acc = 0;
let frames = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (state.shotMode) {
    state.time += dt;
    if (stageFrame) stageFrame(state, dt);
  } else if (!state.paused && state.phase !== 'menu' && state.phase !== 'matchEnd') {
    acc += dt;
    let steps = 0;
    while (acc >= SIM_DT && steps < 5) {
      stepGame(state, input, SIM_DT);
      acc -= SIM_DT;
      steps++;
    }
    if (steps === 5) acc = 0;
  }

  // Drain the sim's event queue to audio, HUD and renderer effects.
  for (const ev of state.events) {
    sfx.handleEvent(state, ev);
    hud.handleEvent(state, ev);
    renderer.handleEvent(state, ev);
  }
  state.events.length = 0;

  renderer.sync(state, dt);
  renderer.render();
  hud.update(state, input, dt);
  input.endFrame();

  frames++;
  if (state.shotMode && frames >= 4 && !window.__shotReady) window.__shotReady = true;
}
requestAnimationFrame(frame);
