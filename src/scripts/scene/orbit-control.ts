import { MathUtils } from "three";

/**
 * Drag-to-rotate, adapted from the KLAK proof of concept: yaw follows the pointer with
 * inertia, pitch is clamped and eases back to rest after a pause. Touch drives yaw only,
 * so vertical swipes keep scrolling the page (the canvas uses `touch-action: pan-y`).
 */

export interface OrbitControl {
  /** Offsets added to the narrative's camera, in radians. */
  readonly yaw: number;
  readonly pitch: number;
  /** Advances inertia and easing; returns true while still moving. */
  update(dt: number): boolean;
  dispose(): void;
}

export interface OrbitOptions {
  maxPitch: number;
  /** A press-and-release that barely moved: a click or tap rather than a drag. */
  onTap?: (clientX: number, clientY: number) => void;
}

const YAW_PER_PX = 0.006;
const PITCH_PER_PX = 0.003;
const INERTIA_DECAY = 4;
const RELEASE_STILL_MS = 80;
const IDLE_DELAY = 1.2;
const TAP_SLOP_PX = 6;
const TAP_MAX_MS = 400;

export function createOrbitControl(element: HTMLElement, { maxPitch, onTap }: OrbitOptions): OrbitControl {
  let yaw = 0;
  let yawVelocity = 0;
  let pitch = 0;
  let pitchTarget = 0;
  let sinceInteraction = Infinity;
  let pointer: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let lastTime = 0;
  let downX = 0;
  let downY = 0;
  let downTime = 0;

  const onDown = (event: PointerEvent) => {
    if (pointer !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
    pointer = event.pointerId;
    element.setPointerCapture(event.pointerId);
    lastX = downX = event.clientX;
    lastY = downY = event.clientY;
    lastTime = downTime = event.timeStamp;
    yawVelocity = 0;
    element.dataset.dragging = "";
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    const dt = Math.max((event.timeStamp - lastTime) / 1000, 1 / 240);
    const deltaYaw = (event.clientX - lastX) * YAW_PER_PX;
    yaw += deltaYaw;
    yawVelocity = deltaYaw / dt;
    if (event.pointerType === "mouse") {
      pitchTarget = MathUtils.clamp(pitchTarget + (event.clientY - lastY) * PITCH_PER_PX, -maxPitch, maxPitch);
    }
    lastX = event.clientX;
    lastY = event.clientY;
    lastTime = event.timeStamp;
    sinceInteraction = 0;
  };

  const onEnd = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    if (event.timeStamp - lastTime > RELEASE_STILL_MS) yawVelocity = 0;
    pointer = null;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    delete element.dataset.dragging;
    sinceInteraction = 0;
    const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
    if (event.type === "pointerup" && moved < TAP_SLOP_PX && event.timeStamp - downTime < TAP_MAX_MS) {
      onTap?.(event.clientX, event.clientY);
    }
  };

  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointermove", onMove);
  element.addEventListener("pointerup", onEnd);
  element.addEventListener("pointercancel", onEnd);

  return {
    get yaw() {
      return yaw;
    },
    get pitch() {
      return pitch;
    },
    update(dt) {
      const before = yaw + pitch;
      if (pointer === null) {
        yaw += yawVelocity * dt;
        yawVelocity *= Math.exp(-INERTIA_DECAY * dt);
        sinceInteraction += dt;
        if (sinceInteraction > IDLE_DELAY) pitchTarget = MathUtils.damp(pitchTarget, 0, 1.5, dt);
      }
      pitch = MathUtils.damp(pitch, pitchTarget, 10, dt);
      return pointer !== null || Math.abs(yawVelocity) > 1e-3 || Math.abs(yaw + pitch - before) > 1e-5;
    },
    dispose() {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onEnd);
      element.removeEventListener("pointercancel", onEnd);
    },
  };
}
