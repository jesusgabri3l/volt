import { Box3, Vector3, type Object3D } from "three";

/**
 * Makes the 3D keycaps travel when the visitor types or clicks them. Each physical key
 * (`KeyboardEvent.code`) is matched to its keycap by layout position in the model: caps
 * are grouped into rows by depth and sorted by x, then read against the VOLT layout below.
 */

// The VOLT 75 % layout, row by row from the back, left to right (78 keys).
// `null` is the Fn key, which has no KeyboardEvent code.
const LAYOUT: (string | null)[][] = [
  ["Escape", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "Delete"],
  ["Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal", "Backspace"],
  ["Tab", "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight", "Backslash"],
  ["CapsLock", "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote", "Enter"],
  ["ShiftLeft", "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash", "ShiftRight", "ArrowUp"],
  ["ControlLeft", "MetaLeft", "AltLeft", "Space", "AltRight", null, "ControlRight", "ArrowLeft", "ArrowDown", "ArrowRight"],
];

/** Key travel, in metres, like a full-travel mechanical switch. */
const TRAVEL = 0.0035;
/**
 * Two springs, like a real switch: pressing bottoms out fast with no bounce (critically
 * damped); releasing snaps back with only a hint of overshoot from the spring.
 */
const PRESS = { stiffness: 12000, damping: 2 * Math.sqrt(12000) };
const RELEASE = { stiffness: 2200, damping: 0.75 * 2 * Math.sqrt(2200) };
/** Fixed integration step, for a stable spring whatever the frame rate. */
const SUBSTEP = 1 / 480;

export interface KeyPresses {
  /** The keycap object for a pointer hit, or undefined. */
  keyForObject(object: Object3D): Object3D | undefined;
  press(cap: Object3D): void;
  release(cap: Object3D): void;
  pressCode(code: string): boolean;
  /** The keycap a physical key maps to, if any. */
  capForCode(code: string): Object3D | undefined;
  /** The physical key a keycap maps to, if any (the Fn key has none). */
  codeForCap(cap: Object3D): string | undefined;
  releaseCode(code: string): void;
  /** Advances the springs; returns true while any key is still moving. */
  update(dt: number): boolean;
}

interface KeyState {
  cap: Object3D;
  rest: Vector3;
  /** Parent-space offset for one metre of travel into the plate (along its normal). */
  down: Vector3;
  pressed: boolean;
  depth: number;
  velocity: number;
}

export function createKeyPresses(keycapsGroup: Object3D): KeyPresses {
  const caps = keycapsGroup.children.filter((c) => c.name.startsWith("Keycap"));
  const states = new Map<Object3D, KeyState>();
  const byCode = new Map<string, KeyState>();
  const codes = new Map<Object3D, string>();

  // The caps' parent is tilted with the plate (typing angle), and the exporter keeps Y as
  // the local up axis, so the plate normal is the parent's local -Y, scaled to metres.
  const parent = keycapsGroup;
  parent.updateWorldMatrix(true, false);
  const unit = parent.localToWorld(new Vector3(0, 0, 0)).distanceTo(parent.localToWorld(new Vector3(0, 1, 0)));
  const down = new Vector3(0, -1 / unit, 0);
  for (const cap of caps) {
    states.set(cap, { cap, rest: cap.position.clone(), down, pressed: false, depth: 0, velocity: 0 });
  }

  // Rows: cluster caps by world depth (z grows toward the front), then sort each by x.
  const centres = caps.map((cap) => ({ cap, c: new Box3().setFromObject(cap).getCenter(new Vector3()) }));
  centres.sort((a, b) => a.c.z - b.c.z);
  const rows: (typeof centres)[] = [];
  for (const item of centres) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(item.c.z - row[0].c.z) < 0.009) row.push(item);
    else rows.push([item]);
  }
  rows.forEach((row, r) => {
    row.sort((a, b) => a.c.x - b.c.x);
    row.forEach((item, i) => {
      const code = LAYOUT[r]?.[i];
      if (!code) return;
      byCode.set(code, states.get(item.cap)!);
      codes.set(item.cap, code);
    });
  });

  const set = (state: KeyState | undefined, pressed: boolean) => {
    if (state) state.pressed = pressed;
  };

  return {
    keyForObject(object) {
      let node: Object3D | null = object;
      while (node && !states.has(node)) node = node.parent;
      return node ?? undefined;
    },
    press: (cap) => set(states.get(cap), true),
    release: (cap) => set(states.get(cap), false),
    pressCode(code) {
      const state = byCode.get(code);
      set(state, true);
      return !!state;
    },
    releaseCode: (code) => set(byCode.get(code), false),
    capForCode: (code) => byCode.get(code)?.cap,
    codeForCap: (cap) => codes.get(cap),
    update(dt) {
      let moving = false;
      const steps = Math.ceil(Math.min(dt, 1 / 20) / SUBSTEP);
      for (const state of states.values()) {
        const target = state.pressed ? TRAVEL : 0;
        if (state.depth === target && state.velocity === 0) continue;
        const spring = state.pressed ? PRESS : RELEASE;
        for (let i = 0; i < steps; i++) {
          const force = (target - state.depth) * spring.stiffness - state.velocity * spring.damping;
          state.velocity += force * SUBSTEP;
          state.depth += state.velocity * SUBSTEP;
        }
        // The cap cannot go past the bottom of its travel.
        if (state.depth > TRAVEL) {
          state.depth = TRAVEL;
          state.velocity = 0;
        }
        if (Math.abs(state.depth - target) < 2e-6 && Math.abs(state.velocity) < 2e-4) {
          state.depth = target;
          state.velocity = 0;
        } else {
          moving = true;
        }
        state.cap.position.copy(state.rest).addScaledVector(state.down, state.depth);
      }
      return moving;
    },
  };
}
