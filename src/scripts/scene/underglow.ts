import {
  AdditiveBlending,
  Box3,
  Color,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Object3D,
} from "three";

/**
 * Per-key LED glow under the keycaps, as in the KLAK proof of concept: one soft halo per
 * key on a plane just below the caps, tinted with the LED colour and seen through the gaps.
 * A pressed key flares and fades back. The plane lives in the Keycaps group, so it follows
 * the typing angle and the visitor's drag. A wide, soft spill of the same colour lies on the
 * floor under the keyboard (in `floorParent`, at y = 0), as light escaping the case would.
 */
export interface Underglow {
  setColor(color: string): void;
  /** Flares the halo under one keycap. */
  pulse(cap: Object3D): void;
  /** 0 hides the glow (e.g. while the keyboard is apart), 1 shows it fully. */
  setStrength(strength: number): void;
  /** Advances the fades; returns true while any halo is still changing. */
  update(dt: number): boolean;
  dispose(): void;
}

const RESTING = 1;
const FLARE = 1.8;
/** Halo fade time constant, in seconds. */
const FADE = 0.45;

/**
 * Floor spill strength at full glow: light leaking from under the case, never a disc. The
 * output pass tone-maps it, which crushes dim light, so it is stronger than it looks here.
 */
const SPILL = 0.4;
/** A fully saturated LED colour spills this share of white's strength: colour reads strong. */
const SATURATED_SPILL = 0.5;

export function createUnderglow(keycapsGroup: Object3D, floorParent: Object3D): Underglow {
  const caps = keycapsGroup.children.filter((c): c is Mesh => c instanceof Mesh && c.name.startsWith("Keycap"));
  const boxes = caps.map((cap) => {
    cap.geometry.computeBoundingBox();
    return new Box3().copy(cap.geometry.boundingBox!).applyMatrix4(cap.matrix);
  });
  const all = boxes.reduce((acc, b) => acc.union(b), new Box3());
  const width = all.max.x - all.min.x;
  const depth = all.max.z - all.min.z;

  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = Math.round((1024 * depth) / width);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const plane = new Mesh(new PlaneGeometry(width, depth).rotateX(-Math.PI / 2), material);
  // Just below the bottoms of the caps.
  plane.position.set((all.min.x + all.max.x) / 2, all.min.y - (all.max.y - all.min.y) * 0.02, (all.min.z + all.max.z) / 2);
  plane.renderOrder = 2;
  keycapsGroup.add(plane);

  const spill = createSpill(keycapsGroup);
  floorParent.add(spill);
  const spillMaterial = spill.material as MeshBasicMaterial;

  const levels = new Map<Object3D, number>(caps.map((cap) => [cap, RESTING]));
  let dirty = true;
  let strength = 1;
  let spillShare = 1;
  const applySpill = () => {
    spillMaterial.opacity = strength * SPILL * spillShare;
  };

  const redraw = () => {
    const ctx = canvas.getContext("2d")!;
    const sx = canvas.width / width;
    const sz = canvas.height / depth;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";
    caps.forEach((cap, i) => {
      const b = boxes[i];
      const cx = ((b.min.x + b.max.x) / 2 - all.min.x) * sx;
      const cz = ((b.min.z + b.max.z) / 2 - all.min.z) * sz;
      const rx = ((b.max.x - b.min.x) / 2) * sx * 1.18;
      const rz = ((b.max.z - b.min.z) / 2) * sz * 1.18;
      const level = levels.get(cap)!;
      ctx.save();
      ctx.translate(cx, cz);
      ctx.scale(rx, rz);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(255,255,255,${level})`);
      g.addColorStop(0.7, `rgba(255,255,255,${level * 0.45})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    });
    texture.needsUpdate = true;
    dirty = false;
  };

  return {
    setColor(color) {
      material.color.set(color);
      spillMaterial.color.set(color);
      // HSV saturation (HSL calls near-white tints saturated): 0 for white, 1 for pure hues.
      const { r, g, b } = new Color(color).convertLinearToSRGB();
      const saturation = 1 - Math.min(r, g, b) / Math.max(r, g, b, 1e-6);
      spillShare = 1 - (1 - SATURATED_SPILL) * saturation;
      applySpill();
    },
    pulse(cap) {
      if (!levels.has(cap)) return;
      levels.set(cap, FLARE);
      dirty = true;
    },
    setStrength(value) {
      strength = value;
      material.opacity = strength;
      plane.visible = strength > 0.01;
      applySpill();
      spill.visible = plane.visible;
    },
    update(dt) {
      let changing = false;
      const k = Math.exp(-dt / FADE);
      for (const [cap, level] of levels) {
        if (level <= RESTING + 1e-3) continue;
        levels.set(cap, RESTING + (level - RESTING) * k);
        changing = true;
      }
      if (changing || dirty) redraw();
      return changing;
    },
    dispose() {
      keycapsGroup.remove(plane);
      plane.geometry.dispose();
      material.dispose();
      texture.dispose();
      floorParent.remove(spill);
      spill.geometry.dispose();
      spillMaterial.map?.dispose();
      spillMaterial.dispose();
    },
  };
}

/** A soft elliptical glow on the floor, a little wider than the keyboard's footprint. */
function createSpill(keycapsGroup: Object3D): Mesh {
  const footprint = new Box3().setFromObject(keycapsGroup);
  const width = (footprint.max.x - footprint.min.x) * 1.5;
  const depth = (footprint.max.z - footprint.min.z) * 1.8;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  // Brightest under the case, then a long falloff with no visible rim, like light
  // bouncing off the floor.
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.6)");
  g.addColorStop(0.5, "rgba(255,255,255,0.2)");
  g.addColorStop(0.75, "rgba(255,255,255,0.04)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const spill = new Mesh(
    new PlaneGeometry(width, depth).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({
      map: texture,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: SPILL,
    }),
  );
  // Just above the contact shadow, centred under the keys.
  spill.position.set((footprint.min.x + footprint.max.x) / 2, 0.0004, (footprint.min.z + footprint.max.z) / 2);
  spill.renderOrder = 3;
  return spill;
}
