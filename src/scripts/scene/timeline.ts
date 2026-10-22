/**
 * The scroll narrative as data: for any progress (0–1) through the experience, where the
 * camera is and how far the keyboard is taken apart. Pure and deterministic, so scrolling
 * backwards or jumping to an anchor always lands on the same state.
 */

export interface CameraView {
  /** Camera position and look target, in metres, relative to the keyboard centre on the floor. */
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  /** Screen position (0–1, from the left and from the top) where the target should appear. */
  focusX: number;
  focusY: number;
  /** Screen position of the target on narrow (portrait) screens. */
  narrowFocusX: number;
  narrowFocusY: number;
  /** Extra camera pull-back on narrow screens, where the copy leaves less room (1 = none). */
  narrowDistance: number;
}

export interface SceneState {
  view: CameraView;
  /** 0 = assembled, 1 = every component lifted apart. */
  explode: number;
  /**
   * How much each component (in `COMPONENTS` order) is in focus, 0–1: the one being
   * described grows a little and the stack opens around it.
   */
  focus: number[];
}

/** Component order of the narrative, matching the HTML steps. */
export const COMPONENTS = ["keycaps", "switches", "plate", "pcb", "chassis"] as const;

interface Keyframe {
  at: number;
  state: SceneState;
}

const view = (
  position: [number, number, number],
  target: [number, number, number],
  focusX: number,
  focusY: number,
  narrowFocusY = Math.min(0.78, focusY + 0.2),
  narrowDistance = 1,
  narrowFocusX = NARROW_FOCUS_X,
): CameraView => ({ position, target, fov: 30, focusX, focusY, narrowFocusX, narrowFocusY, narrowDistance });

/**
 * Every view looks at the keyboard from its front left, so its near (left) end reads larger;
 * on narrow screens placing the target a little right of centre balances it. The whole,
 * assembled keyboard (hero, customization, purchase) needs less of that than the open stack.
 */
const NARROW_FOCUS_X = 0.55;
const NARROW_ASSEMBLED_X = 0.5;

// Hero: the whole keyboard, small and to the right, low three-quarter view.
const HERO = view([-0.44, 0.19, 0.47], [0, 0.01, 0], 0.68, 0.56, undefined, 1, NARROW_ASSEMBLED_X);
// Per component: the opened stack moves to the left of the copy, and the camera drifts with
// the part being described, far enough back to keep the whole stack in frame.
const COMPONENT_VIEWS: Record<(typeof COMPONENTS)[number], CameraView> = {
  keycaps: view([-0.448, 0.455, 0.56], [0, 0.125, 0], 0.36, 0.5, 0.62),
  switches: view([-0.459, 0.445, 0.571], [0, 0.12, 0], 0.36, 0.5, 0.62),
  plate: view([-0.47, 0.434, 0.582], [0, 0.115, 0], 0.36, 0.5, 0.62),
  pcb: view([-0.482, 0.424, 0.594], [0, 0.11, 0], 0.36, 0.5, 0.62),
  chassis: view([-0.493, 0.413, 0.605], [0, 0.105, 0], 0.36, 0.5, 0.62),
};
// Customization: elevated three-quarter view on the right of the copy and controls, a little
// closer than the other views. Narrow screens keep their framing (narrowDistance undoes the
// closer camera).
const CUSTOMIZE_CLOSER = 0.84;
const CUSTOMIZE = view(
  [-0.3 * CUSTOMIZE_CLOSER, 0.5 * CUSTOMIZE_CLOSER, 0.64 * CUSTOMIZE_CLOSER],
  [0, 0, 0],
  0.66,
  0.54,
  0.41,
  1 / CUSTOMIZE_CLOSER,
  NARROW_ASSEMBLED_X,
);
// Purchase: the configured keyboard on the left, the order summary on the right.
const PURCHASE = view([-0.31, 0.29, 0.52], [0, 0.01, 0], 0.32, 0.52, 0.22, 1.3, NARROW_ASSEMBLED_X);

/**
 * The experience has eight scroll stops: hero, five components, customization, and the end
 * of the purchase section (`data-scene-stop` in the markup; see observeNarrativeProgress).
 * Progress k / 7 is the moment stop k reaches the top of the viewport, so each component
 * holds its view around that point. The keyboard reassembles on the way from the last
 * component to customization.
 */
const STEP = 1 / 7;
const HOLD = 0.035;

/** Progress at which each component's step fills the viewport, matching the HTML steps. */
export const COMPONENT_AT = COMPONENTS.map((_, i) => (i + 1) * STEP);

const NO_FOCUS = COMPONENTS.map(() => 0);
const focusOn = (index: number) => COMPONENTS.map((_, i) => (i === index ? 1 : 0));

const KEYFRAMES: Keyframe[] = [
  { at: 0, state: { view: HERO, explode: 0, focus: NO_FOCUS } },
  // One continuous move from the hero to the first component: the camera rises while the
  // parts separate, eased over the whole stretch (the hero has extra scroll for it).
  { at: 0.02, state: { view: HERO, explode: 0, focus: NO_FOCUS } },
  ...COMPONENTS.flatMap((name, i) => {
    const at = COMPONENT_AT[i];
    const state = { view: COMPONENT_VIEWS[name], explode: 1, focus: focusOn(i) };
    return [
      { at: at - HOLD, state },
      { at: at + HOLD, state },
    ];
  }),
  { at: 6 * STEP - HOLD, state: { view: CUSTOMIZE, explode: 0, focus: NO_FOCUS } },
  { at: 6 * STEP + HOLD, state: { view: CUSTOMIZE, explode: 0, focus: NO_FOCUS } },
  { at: 1, state: { view: PURCHASE, explode: 0, focus: NO_FOCUS } },
];

/** The held state of the section nearest to `progress`, for reduced motion. */
export function restingProgress(progress: number): number {
  return Math.round(Math.min(1, Math.max(0, progress)) / STEP) * STEP;
}

export function sceneStateAt(progress: number): SceneState {
  const p = Math.min(1, Math.max(0, progress));
  const next = KEYFRAMES.findIndex((k) => k.at >= p);
  if (next <= 0) return KEYFRAMES[0].state;
  const a = KEYFRAMES[next - 1];
  const b = KEYFRAMES[next];
  const t = smoothstep((p - a.at) / (b.at - a.at));
  return {
    view: mixView(a.state.view, b.state.view, t),
    explode: mix(a.state.explode, b.state.explode, t),
    focus: a.state.focus.map((f, i) => mix(f, b.state.focus[i], t)),
  };
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function mix3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

function mixView(a: CameraView, b: CameraView, t: number): CameraView {
  return {
    position: mix3(a.position, b.position, t),
    target: mix3(a.target, b.target, t),
    fov: mix(a.fov, b.fov, t),
    focusX: mix(a.focusX, b.focusX, t),
    focusY: mix(a.focusY, b.focusY, t),
    narrowFocusX: mix(a.narrowFocusX, b.narrowFocusX, t),
    narrowFocusY: mix(a.narrowFocusY, b.narrowFocusY, t),
    narrowDistance: mix(a.narrowDistance, b.narrowDistance, t),
  };
}
