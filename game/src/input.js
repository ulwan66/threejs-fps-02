// BREACHLINE — input: keyboard, mouse and pointer lock. Edge-triggered
// presses are consumed (take*) by whoever acts on them; anything left over
// is dropped at the end of the frame by the main loop, so a press never
// fires twice and never leaks into the next frame.

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDown = [false, false, false];
    this.mousePressed = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.locked = false;
    this.sensitivity = 0.0023;
    this.onLockLost = null;
    this.onLockGained = null;
  }

  attach(canvas) {
    this.canvas = canvas;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown.fill(false); });
    canvas.addEventListener('mousedown', (e) => {
      this.mouseDown[e.button] = true;
      this.mousePressed.add(e.button);
    });
    addEventListener('mouseup', (e) => { this.mouseDown[e.button] = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX || 0;
      this.lookY += e.movementY || 0;
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked && this.onLockLost) this.onLockLost();
      if (!was && this.locked && this.onLockGained) this.onLockGained();
    });
  }

  requestLock() {
    if (!this.locked && this.canvas) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { /* user gesture required; click again */ });
    }
  }
  releaseLock() {
    if (this.locked) document.exitPointerLock();
  }
  isDown(code) { return this.keys.has(code); }
  takePressed(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }
  takeClick(button) {
    if (!this.mousePressed.has(button)) return false;
    this.mousePressed.delete(button);
    return true;
  }
  takeLook() {
    const dx = this.lookX, dy = this.lookY;
    this.lookX = 0; this.lookY = 0;
    return { dx, dy };
  }
  endFrame() {
    this.pressed.clear();
    this.mousePressed.clear();
  }
}
