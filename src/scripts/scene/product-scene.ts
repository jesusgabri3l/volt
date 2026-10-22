import {
  Box3,
  Color,
  Group,
  HalfFloatType,
  Mesh,
  NeutralToneMapping,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Texture,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createStudioLighting } from "./studio-lighting";
import { createContactShadow } from "./contact-shadow";
import { createKeyPresses } from "./key-presses";
import { createUnderglow } from "./underglow";
import { createOrbitControl } from "./orbit-control";
import { restingProgress, sceneStateAt, type CameraView } from "./timeline";
import { CHASSIS, KEYCAPS, LEDS, type Customization } from "../customization";

/**
 * The only module that talks to three.js. It owns the renderer, the studio lighting, the
 * model, and the camera. The scroll narrative drives it through `setProgress`; the visitor
 * can also drag to turn the keyboard and type or click to press its keys. It renders once
 * per animation frame only while something changes, never while idle.
 */

export interface ProductSceneOptions {
  canvas: HTMLCanvasElement;
  modelUrl: string;
  /** Called after every frame with each component's anchor in canvas pixels, for hotspots. */
  onAnchors?: (anchors: Record<string, ScreenAnchor>) => void;
}

export interface ScreenAnchor {
  x: number;
  y: number;
  /** False when the anchor is behind the camera or outside the canvas. */
  visible: boolean;
}

export interface ProductScene {
  /** Moves the scene to a point of the scroll narrative (0–1). */
  setProgress(progress: number): void;
  /** Applies the visitor's chassis, keycap, and LED choices to the model's materials. */
  setCustomization(config: Customization): void;
  /** Stops rendering and frees GPU resources. */
  dispose(): void;
}

const NARROW_BREAKPOINT = 760;
/**
 * A progress change this large in one step is a jump (anchor link, section indicator,
 * Home/End), not scrolling. The experience spans seven viewports of scroll, so 0.17 is about
 * 1.2 screens in one frame, as in KLAK: a fast wheel flick stays below it, and a jump to an
 * adjacent section (one screen) simply plays its short transition.
 */
const JUMP = 0.17;
/** Smoothing of ordinary scrolling (per second); a jump or reduced motion skips it. */
const SCROLL_DAMPING = 9;
/** Fade-in after a jump cut. */
const CUT_FADE_MS = 450;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const EXPOSURE = 1.0;
/** Minimum LED-to-keycap luminance contrast for a lit legend on a coloured cap. */
const LEGEND_CONTRAST = 2;
/**
 * The large flat metal faces (the case floor, the plate) catch the studio softboxes as hard
 * white glints once the keyboard is apart and they face the camera. While exploded they
 * turn a little rougher and reflect less, which keeps the metal reading but drops the glare.
 */
const GLINT_MATERIALS = ["VOLT / Chassis", "VOLT / Satin Black Aluminum", "VOLT / Anodized Base", "VOLT / Switch Plate"];
const GLINT_ROUGHNESS = 0.16;
const GLINT_REFLECTION = 0.45;
/** The HDRI alone (without Cycles' direct light sampling) otherwise lifts the keycaps. */
const ENVIRONMENT_INTENSITY = 0.7;

/**
 * Hotspot anchors: a node per component and where on its bounds to pin the marker,
 * as fractions of its world bounding box (x left→right, y bottom→top, z back→front).
 */
const ANCHORS: Record<string, { node: string; at: [number, number, number] }> = {
  keycaps: { node: "Keycap_0", at: [0.5, 1, 0.5] },
  switches: { node: "Switches", at: [0.12, 1, 0.8] },
  plate: { node: "SwitchPlate", at: [0.2, 1, 0.85] },
  pcb: { node: "PCB_Board", at: [0.28, 1, 0.85] },
  chassis: { node: "Chassis_Shell", at: [0.06, 1, 0.92] },
};

/**
 * World-space lift of each component group when fully exploded, in metres, bottom to top.
 * Group names are the GLB node names (the loader replaces spaces with underscores).
 */
const EXPLODE_LIFT: Record<string, number> = {
  BottomPlate: 0,
  Chassis: 0.025,
  PCB: 0.06,
  SwitchPlate: 0.09,
  Switches: 0.12,
  Keycaps: 0.165,
};

/** The explode group of each narrative component, in `COMPONENTS` order (timeline.ts). */
const FOCUS_GROUPS = ["Keycaps", "Switches", "SwitchPlate", "PCB", "Chassis"];
/** The component in focus grows by this share, around its own centre. */
const FOCUS_SCALE = 0.1;
/** Extra gap opened below and above the component in focus, in metres. */
const FOCUS_GAP = 0.024;

/**
 * Render quality. Ambient occlusion and supersampling cost about two thirds of a frame on an
 * integrated GPU, so they run only once the scene rests: while anything moves, a light
 * pipeline renders at native resolution without AO; after a short rest the full pipeline
 * takes over and fades the AO in. Each pipeline keeps its own fixed-size targets, because
 * resizing them on the fly stalls for over 100 ms. Touch and narrow screens never use AO
 * and supersample less.
 */
const STILL_DELAY = 0.15;
const AO_FADE = 0.3;
const AO_STRENGTH = 1.4;

export async function createProductScene({
  canvas,
  modelUrl,
  onAnchors,
}: ProductSceneOptions): Promise<ProductScene> {
  // Transparent: the page's CSS gradient shows through, so the background is the
  // same before, during, and after the scene loads, on every section.
  // No antialiasing on the canvas itself: the composers' multisampled targets provide it,
  // and a multisampled drawing buffer at this size costs tens of megabytes of GPU memory.
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const lowPower = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < NARROW_BREAKPOINT;
  const dpr = Math.max(window.devicePixelRatio, 1);
  // At rest, supersampled: crisp keycap edges and legends.
  const stillRatio = lowPower ? Math.min(dpr, 1.5) : Math.min(dpr * 1.5, 2);
  const motionRatio = Math.min(dpr, lowPower ? 1.25 : 1);
  // Neutral keeps the black keycaps black; AgX lifted them to gray.
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = EXPOSURE;

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.01, 20);
  scene.environmentIntensity = ENVIRONMENT_INTENSITY;

  const [studio, gltf] = await Promise.all([
    createStudioLighting(scene, "/assets/studio/studio-env.hdr"),
    // The site model is meshopt-compressed (gltf-transform meshopt): about a third of the size.
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(modelUrl),
  ]);
  const model = gltf.scene;
  placeOnFloor(model);
  sharpenTextures(model, renderer.capabilities.getMaxAnisotropy());
  await yieldToMain();
  // Dragging turns the keyboard itself, like a turntable, around its centre.
  const pivot = new Group();
  pivot.add(model);
  scene.add(pivot);
  const explodeGroups = collectExplodeGroups(model);
  const chassisMaterial = findMaterial(model, "VOLT / Chassis") as MeshStandardMaterial | undefined;
  const keycapMaterial = findMaterial(model, "VOLT / Keycap") as MeshStandardMaterial | undefined;
  const legendMaterial = findMaterial(model, "VOLT / Legend") as MeshStandardMaterial | undefined;
  const ledMaterial = findMaterial(model, "VOLT / LED") as MeshStandardMaterial | undefined;
  const glintMaterials = GLINT_MATERIALS.flatMap((name) => {
    const material = findMaterial(model, name) as MeshStandardMaterial | undefined;
    return material ? [material] : [];
  });
  // The roughness each glint material has when assembled (the chassis finish changes it).
  const restRoughness = new Map(glintMaterials.map((m) => [m, m.roughness]));
  for (const material of glintMaterials) {
    // three.js ignores `envMapIntensity` for the scene environment; an own envMap honours it.
    material.envMap = scene.environment;
    material.needsUpdate = true;
  }
  const applyGlint = (explode: number) => {
    for (const material of glintMaterials) {
      material.roughness = Math.min(1, restRoughness.get(material)! + GLINT_ROUGHNESS * explode);
      material.envMapIntensity = ENVIRONMENT_INTENSITY * (1 - (1 - GLINT_REFLECTION) * explode);
    }
  };
  // The exported strength (3) reads as a hard white bar; keep the side strips a soft accent.
  if (ledMaterial) ledMaterial.emissiveIntensity = 0.35;
  // The exported gap strips are replaced by the per-key underglow (KLAK style).
  const backlight = findMaterial(model, "VOLT / Backlight");
  if (backlight) backlight.visible = false;
  const underglow = createUnderglow(model.getObjectByName("Keycaps")!, pivot);
  underglow.setColor("#f3f7ff");
  const anchorNodes = Object.entries(ANCHORS).flatMap(([name, anchor]) => {
    const node = model.getObjectByName(anchor.node);
    return node ? [{ name, node, at: anchor.at }] : [];
  });

  // Soft contact shadow under the keyboard, over the page backdrop.
  const shadow = createContactShadow(renderer, scene, { size: 0.7, height: 0.06, blur: 6, opacity: 0.9 });

  // Multisampled HDR targets: the composer's default target has no antialiasing.
  const target = () => new WebGLRenderTarget(1, 1, { samples: 4, type: HalfFloatType });
  const motionComposer = new EffectComposer(renderer, target());
  motionComposer.addPass(new RenderPass(scene, camera));
  motionComposer.addPass(new OutputPass());
  const composer = new EffectComposer(renderer, target());
  // Only the scene render needs multisampling; the AO pass writes to the second target.
  composer.renderTarget2.samples = 0;
  composer.addPass(new RenderPass(scene, camera));
  // Ambient occlusion: the soft darkening between keys and in corners.
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.updateGtaoMaterial({ radius: 0.012, distanceExponent: 1.5, thickness: 0.004, scale: 1 });
  ao.blendIntensity = AO_STRENGTH;
  composer.addPass(ao);
  composer.addPass(new OutputPass());

  let progress = 0; // shown
  let targetProgress = 0;
  let cutFrame = 0;
  let appliedExplode = -1;
  let appliedExplodeKey = "";
  let frame = 0;
  let lastTime = 0;
  /** Seconds since anything last moved; the first frame counts as rested. */
  let rest = Infinity;
  let aoLevel = lowPower ? 0 : 1;

  const keys = createKeyPresses(model.getObjectByName("Keycaps")!);
  const raycaster = new Raycaster();
  const orbit = createOrbitControl(canvas, {
    maxPitch: 0.6,
    // A click on a keycap presses it briefly.
    onTap(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(model, true)[0];
      const cap = hit && keys.keyForObject(hit.object);
      if (!cap) return;
      keys.press(cap);
      underglow.pulse(cap);
      window.setTimeout(() => {
        keys.release(cap);
        requestDraw();
      }, 120);
      requestDraw();
    },
  });
  canvas.style.touchAction = "pan-y";

  const isTyping = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || isTyping(event.target)) return;
    if (keys.pressCode(event.code)) {
      const cap = keys.capForCode(event.code);
      if (cap) underglow.pulse(cap);
      requestDraw();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    keys.releaseCode(event.code);
    requestDraw();
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  // A press starts the loop; the drag keeps it running until the keyboard comes to rest.
  const onPointerDown = () => requestDraw();
  canvas.addEventListener("pointerdown", onPointerDown);

  const draw = (time = performance.now()) => {
    frame = 0;
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 1 / 60;
    lastTime = time;
    const { clientWidth: width, clientHeight: height } = canvas;
    if (width === 0 || height === 0) return;
    const settling = Math.abs(targetProgress - progress) > 1e-4;
    progress = settling ? targetProgress + (progress - targetProgress) * Math.exp(-SCROLL_DAMPING * dt) : targetProgress;
    const animating = [settling, orbit.update(dt), keys.update(dt), underglow.update(dt)].some(Boolean);
    rest = animating ? 0 : rest + dt;
    const still = rest >= STILL_DELAY;
    aoLevel = !still || lowPower ? 0 : Math.min(1, aoLevel + dt / AO_FADE);
    ao.enabled = aoLevel > 0;
    ao.blendIntensity = AO_STRENGTH * aoLevel;
    const state = sceneStateAt(progress);
    const base = width < NARROW_BREAKPOINT ? narrow(state.view, width / height) : state.view;
    // Yaw turns the keyboard; pitch tilts the camera slightly over it.
    const turned = pivot.rotation.y !== orbit.yaw;
    pivot.rotation.y = orbit.yaw;
    const view = orbitView(base, 0, orbit.pitch);
    applyView(camera, view, width, height);
    const explodeKey = `${state.explode}|${state.focus.join()}`;
    if (explodeKey !== appliedExplodeKey) {
      applyExplode(explodeGroups, state.explode, state.focus);
      // The glow only makes sense with the keys in place; it fades as they lift.
      underglow.setStrength(Math.max(0, 1 - state.explode * 5));
      applyGlint(state.explode);
      shadow.update();
      appliedExplode = state.explode;
      appliedExplodeKey = explodeKey;
    } else if (turned) {
      shadow.update();
    }
    (still ? composer : motionComposer).render();
    // Hotspots appear only once the keyboard is fully apart, not while it is separating.
    if (onAnchors) onAnchors(projectAnchors(anchorNodes, camera, width, height, state.explode > 0.98));
    // Keep drawing while moving, and after it until full quality has faded in.
    if (animating || !still || (!lowPower && aoLevel < 1)) requestDraw();
    else lastTime = 0;
  };
  const requestDraw = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const setSizes = () => {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (width === 0 || height === 0) return false;
    renderer.setPixelRatio(stillRatio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(stillRatio);
    composer.setSize(width, height);
    ao.setSize(width * stillRatio, height * stillRatio);
    motionComposer.setPixelRatio(motionRatio);
    motionComposer.setSize(width, height);
    return true;
  };

  // Startup in steps, so the page stays responsive while the scene prepares: the model's
  // shaders compile in parallel where the browser supports it, and each pipeline's first
  // render (target allocation, pass shaders) runs in its own task.
  setSizes();
  await renderer.compileAsync(scene, camera);
  await yieldToMain();
  // The light pipeline, now rather than on the first scroll.
  motionComposer.render();
  await yieldToMain();
  draw();
  const observer = new ResizeObserver(() => {
    if (setSizes()) requestDraw();
  });
  observer.observe(canvas);

  if (import.meta.env.DEV) {
    // Lets framing and lighting be tuned live from the browser console during development.
    Object.assign(window, {
      __voltScene: {
        scene, camera, ao, shadow, renderer, composer, requestDraw, keys,
        // Renders one frame at `progress` and waits for the GPU; returns milliseconds. `still`
        // picks the full-quality pipeline, otherwise the light one used while moving.
        frameCost(value: number, still = false) {
          targetProgress = progress = value;
          rest = still ? Infinity : 0;
          aoLevel = still && !lowPower ? 1 : 0;
          const gl = renderer.getContext();
          const pixel = new Uint8Array(4);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          const start = performance.now();
          draw();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return performance.now() - start;
        },
        // Draws and reads the frame in one task (the drawing buffer is not preserved), for posters.
        capture: (type = "image/webp", quality = 0.92) => {
          draw();
          return canvas.toDataURL(type, quality);
        },
      },
    });
  }

  return {
    setProgress(raw) {
      // Reduced motion: no camera travel; each section shows its held state.
      const value = reducedMotion.matches ? restingProgress(raw) : raw;
      if (value === targetProgress) return;
      const jumped = Math.abs(value - targetProgress) > JUMP;
      targetProgress = value;
      if (reducedMotion.matches) {
        progress = value;
        requestDraw();
        return;
      }
      if (!jumped) {
        requestDraw();
        return;
      }
      // Cut, as in KLAK: hide the canvas at once, move straight to the new state, and fade
      // back in, instead of playing the whole explode and reassembly on the way there.
      progress = value;
      canvas.style.transition = "none";
      canvas.style.opacity = "0";
      draw();
      cancelAnimationFrame(cutFrame);
      cutFrame = requestAnimationFrame(() => {
        cutFrame = requestAnimationFrame(() => {
          canvas.style.transition = `opacity ${CUT_FADE_MS}ms ease`;
          canvas.style.opacity = "";
        });
      });
    },
    setCustomization(config) {
      const chassis = CHASSIS.find((c) => c.id === config.chassis);
      const keycaps = KEYCAPS.find((k) => k.id === config.keycaps);
      const led = LEDS.find((l) => l.id === config.led);
      if (chassis && chassisMaterial) {
        chassisMaterial.color.set(chassis.color);
        chassisMaterial.metalness = chassis.metalness;
        chassisMaterial.roughness = chassis.roughness;
        restRoughness.set(chassisMaterial, chassis.roughness);
        applyGlint(appliedExplode < 0 ? 0 : appliedExplode);
      }
      if (keycaps && keycapMaterial) keycapMaterial.color.set(keycaps.color);
      if (led) {
        ledMaterial?.emissive.set(led.color);
        underglow.setColor(led.color);
        if (legendMaterial && keycaps) {
          // Shine-through legends take the LED colour, so the backlight reads on every cap.
          // When the LED would barely stand out against a coloured cap (white on ivory, blue
          // on steel), the cap's own high-contrast legend stays, so it remains readable.
          if (keycaps.legend === null || contrast(led.color, keycaps.color) >= LEGEND_CONTRAST) {
            legendMaterial.color.set(led.color).multiplyScalar(0.2);
            // Saturated LEDs (blue, red) carry less luminance than white; boost them so
            // every colour lights the legends about as clearly.
            legendMaterial.emissiveIntensity = keycaps.legend === null ? 1.2 + 1.2 * (1 - luminance(led.color)) : 2.5;
          } else {
            legendMaterial.color.set(keycaps.legend);
            legendMaterial.emissiveIntensity = 0.06;
          }
          legendMaterial.emissive.set(led.color);
        }
      }
      requestDraw();
    },
    dispose() {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(cutFrame);
      orbit.dispose();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", onPointerDown);
      observer.disconnect();
      shadow.dispose();
      underglow.dispose();
      studio.dispose();
      composer.dispose();
      motionComposer.dispose();
      model.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
      renderer.dispose();
    },
  };
}

/** Ends the current task, letting the browser handle input and paint before continuing. */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function projectAnchors(
  nodes: { name: string; node: Object3D; at: [number, number, number] }[],
  camera: PerspectiveCamera,
  width: number,
  height: number,
  shown: boolean,
): Record<string, ScreenAnchor> {
  const anchors: Record<string, ScreenAnchor> = {};
  const box = new Box3();
  const point = new Vector3();
  for (const { name, node, at } of nodes) {
    box.setFromObject(node);
    point.set(
      box.min.x + (box.max.x - box.min.x) * at[0],
      box.min.y + (box.max.y - box.min.y) * at[1],
      box.min.z + (box.max.z - box.min.z) * at[2],
    );
    point.project(camera);
    const x = ((point.x + 1) / 2) * width;
    const y = ((1 - point.y) / 2) * height;
    anchors[name] = { x, y, visible: shown && point.z < 1 && x >= 0 && x <= width && y >= 0 && y <= height };
  }
  return anchors;
}

/** Relative luminance (0–1) of an sRGB hex colour. */
function luminance(hex: string): number {
  const c = new Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // Color stores linear components
}

/** WCAG contrast ratio between two sRGB hex colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function findMaterial(model: Object3D, name: string): Material | undefined {
  let found: Material | undefined;
  model.traverse((object) => {
    if (!found && object instanceof Mesh) {
      found = [object.material].flat().find((m: Material) => m.name === name);
    }
  });
  return found;
}

interface ExplodeGroup {
  object: Object3D;
  rest: Vector3;
  restScale: Vector3;
  /** Centre of the group's bounds at rest, in its parent's space: the focus grows it from here. */
  center: Vector3;
  lift: number;
  /** Index into the timeline's focus weights, or -1 for a group never in focus. */
  focusIndex: number;
}

function collectExplodeGroups(model: Object3D): ExplodeGroup[] {
  return Object.entries(EXPLODE_LIFT).flatMap(([name, lift]) => {
    const object = model.getObjectByName(name);
    if (!object) return [];
    const center = object.parent!.worldToLocal(new Box3().setFromObject(object).getCenter(new Vector3()));
    return [
      {
        object,
        rest: object.position.clone(),
        restScale: object.scale.clone(),
        center,
        lift,
        focusIndex: FOCUS_GROUPS.indexOf(name),
      },
    ];
  });
}

/**
 * Lifts each group straight up in world space by its share of the explode amount, opens a
 * gap around the component in focus, and grows that component about its centre. The lift
 * is converted into the group's parent space, so the inherited node scale and the case's
 * typing angle do not matter, and amount 0 restores the exact assembled transform.
 */
function applyExplode(groups: ExplodeGroup[], amount: number, focus: number[]) {
  const weight = (group: ExplodeGroup) => (group.focusIndex < 0 ? 0 : focus[group.focusIndex]);
  groups.forEach((group, index) => {
    const { object, rest, restScale, center, lift } = group;
    const own = weight(group);
    // Groups are listed bottom to top: a focused group lower down pushes this one up.
    const below = groups.slice(0, index).reduce((sum, g) => sum + weight(g), 0);
    const rise = (lift + FOCUS_GAP * (below + own / 2)) * amount;
    const scale = 1 + FOCUS_SCALE * own * amount;
    const parent = object.parent!;
    parent.updateWorldMatrix(true, false);
    const origin = parent.worldToLocal(new Vector3(0, 0, 0));
    const lifted = parent.worldToLocal(new Vector3(0, rise, 0)).sub(origin);
    object.position.copy(center).sub(rest).multiplyScalar(1 - scale).add(rest).add(lifted);
    object.scale.copy(restScale).multiplyScalar(scale);
  });
}

/** Turns the narrative camera around its target by the visitor's drag offsets. */
function orbitView(view: CameraView, yaw: number, pitch: number): CameraView {
  if (yaw === 0 && pitch === 0) return view;
  const target = new Vector3(...view.target);
  const offset = new Vector3(...view.position).sub(target);
  const radius = offset.length();
  const azimuth = Math.atan2(offset.x, offset.z) - yaw;
  const elevation = Math.min(1.3, Math.max(0.08, Math.asin(offset.y / radius) + pitch));
  const position = new Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  )
    .multiplyScalar(radius)
    .add(target);
  return { ...view, position: position.toArray() as [number, number, number] };
}

/**
 * Narrow screens: centre the keyboard below the copy and pull the camera back far enough
 * for its width to fit. In portrait the horizontal field of view shrinks with the aspect
 * ratio, so the pull-back grows as the screen gets narrower.
 */
const NARROW_FIT = 0.9;
/**
 * Every view looks at the keyboard from its front left, so its near (left) end reads larger;
 * placing the target a little right of centre balances it on screen.
 */
const NARROW_FOCUS_X = 0.55;

function narrow(view: CameraView, aspect: number): CameraView {
  const t = view.target;
  const scale = Math.max(1.55, NARROW_FIT / aspect) * view.narrowDistance;
  return {
    ...view,
    position: [
      t[0] + (view.position[0] - t[0]) * scale,
      t[1] + (view.position[1] - t[1]) * scale,
      t[2] + (view.position[2] - t[2]) * scale,
    ],
    focusX: NARROW_FOCUS_X,
    focusY: view.narrowFocusY,
  };
}

/**
 * Full anisotropic filtering on every texture of the model. Without it, the fine grain
 * and brushing normal maps shimmer and alias at grazing angles.
 */
function sharpenTextures(model: Object3D, anisotropy: number) {
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of [object.material].flat()) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) {
          value.anisotropy = anisotropy;
          value.needsUpdate = true;
        }
      }
    }
  });
}

/** Centres the model on the origin and rests it on the floor plane (y = 0). */
function placeOnFloor(model: Object3D) {
  const box = new Box3().setFromObject(model);
  const center = box.getCenter(new Vector3());
  model.position.sub(new Vector3(center.x, box.min.y, center.z));
  model.updateMatrixWorld(true);
}

/**
 * Points the camera at the view target, then shifts the projection so the target lands
 * at (`focusX`, `focusY`) on screen without changing the perspective.
 */
function applyView(camera: PerspectiveCamera, view: CameraView, width: number, height: number) {
  camera.fov = view.fov;
  camera.aspect = width / height;
  camera.position.set(...view.position);
  camera.lookAt(...view.target);
  const shiftX = (0.5 - view.focusX) * width;
  const shiftY = (0.5 - view.focusY) * height;
  camera.setViewOffset(width, height, shiftX, shiftY, width, height);
  camera.updateProjectionMatrix();
}
