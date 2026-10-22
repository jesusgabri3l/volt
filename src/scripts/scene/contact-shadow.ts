import {
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  OrthographicCamera,
  PlaneGeometry,
  ShaderMaterial,
  WebGLRenderTarget,
  type Scene,
  type WebGLRenderer,
} from "three";
import { HorizontalBlurShader } from "three/addons/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/addons/shaders/VerticalBlurShader.js";

export interface ContactShadowOptions {
  /** Floor area covered, in metres (square, centred on the origin). */
  size: number;
  /** How far above the floor objects still cast shadow, in metres. */
  height: number;
  /** Blur radius in shadow-map texels; larger is softer. */
  blur: number;
  /** Shadow strength, 0–1. */
  opacity: number;
  resolution?: number;
}

export interface ContactShadow {
  /** Re-renders the shadow from the scene's current geometry. Call after anything moves. */
  update(): void;
  dispose(): void;
}

/**
 * A soft contact shadow on the floor plane (y = 0), like the soft occlusion under an
 * object in a studio photograph. The scene is rendered from below as darkness-by-height
 * into a texture, which is blurred and laid on the floor. It replaces shadow maps,
 * whose hard texels read as pixelated at this scale.
 */
export function createContactShadow(
  renderer: WebGLRenderer,
  scene: Scene,
  { size, height, blur, opacity, resolution = 1024 }: ContactShadowOptions,
): ContactShadow {
  const group = new Group();
  group.position.y = 0.0002;
  scene.add(group);

  const target = new WebGLRenderTarget(resolution, resolution);
  target.texture.generateMipmaps = false;
  const blurTarget = new WebGLRenderTarget(resolution, resolution);
  blurTarget.texture.generateMipmaps = false;

  const plane = new Mesh(
    new PlaneGeometry(size, size).rotateX(Math.PI / 2),
    new MeshBasicMaterial({ map: target.texture, opacity, transparent: true, depthWrite: false }),
  );
  plane.renderOrder = 1;
  plane.scale.y = -1; // the shadow camera looks up, so its image is mirrored
  group.add(plane);

  const blurPlane = new Mesh(plane.geometry);
  blurPlane.visible = false;
  group.add(blurPlane);

  const shadowCamera = new OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, height);
  shadowCamera.rotation.x = Math.PI / 2; // look up from the floor
  group.add(shadowCamera);

  // Depth rendered as black with alpha fading by height: close to the floor is darkest.
  const depthMaterial = new MeshDepthMaterial();
  depthMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );",
      "gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) );",
    );
  };
  depthMaterial.depthTest = false;
  depthMaterial.depthWrite = false;

  const horizontal = new ShaderMaterial(HorizontalBlurShader);
  const vertical = new ShaderMaterial(VerticalBlurShader);
  horizontal.depthTest = vertical.depthTest = false;

  const blurPass = (amount: number) => {
    blurPlane.visible = true;
    blurPlane.material = horizontal;
    horizontal.uniforms.tDiffuse.value = target.texture;
    horizontal.uniforms.h.value = amount / 256;
    renderer.setRenderTarget(blurTarget);
    renderer.render(blurPlane, shadowCamera);

    blurPlane.material = vertical;
    vertical.uniforms.tDiffuse.value = blurTarget.texture;
    vertical.uniforms.v.value = amount / 256;
    renderer.setRenderTarget(target);
    renderer.render(blurPlane, shadowCamera);
    blurPlane.visible = false;
  };

  return {
    update() {
      const background = scene.background;
      const previousTarget = renderer.getRenderTarget();
      const clearAlpha = renderer.getClearAlpha();
      scene.background = null;
      plane.visible = false;
      scene.overrideMaterial = depthMaterial;
      renderer.setClearAlpha(0);
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, shadowCamera);
      scene.overrideMaterial = null;
      blurPass(blur);
      blurPass(blur * 0.4); // a second, finer pass removes the blur's banding
      renderer.setRenderTarget(previousTarget);
      renderer.setClearAlpha(clearAlpha);
      scene.background = background;
      plane.visible = true;
    },
    dispose() {
      scene.remove(group);
      target.dispose();
      blurTarget.dispose();
      plane.geometry.dispose();
      (plane.material as MeshBasicMaterial).dispose();
      depthMaterial.dispose();
      horizontal.dispose();
      vertical.dispose();
    },
  };
}
