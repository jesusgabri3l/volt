import {
  ConstantAlphaFactor,
  CustomBlending,
  HalfFloatType,
  NoBlending,
  OneMinusConstantAlphaFactor,
  ShaderMaterial,
  UniformsUtils,
  WebGLRenderTarget,
} from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { CopyShader } from "three/addons/shaders/CopyShader.js";
import type { WebGLRenderer } from "three";

/**
 * Progressive supersampling for a resting scene. Each frame rendered with a different
 * sub-pixel camera offset is folded into a running mean (`sample` 0 starts over), so after a
 * handful of frames thin, foreshortened details — keycap legends seen at a grazing angle, the
 * engraved wordmark — resolve smoothly at every angle. Runs in linear HDR, before tone
 * mapping; the caller disables it while anything moves.
 */
export class AccumulatePass extends Pass {
  /** Index of the frame being added; 0 replaces the accumulated image. */
  sample = 0;
  private readonly target = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  // Mixes every channel (alpha too, the canvas is transparent) by a constant weight.
  private readonly blend = new ShaderMaterial({
    uniforms: UniformsUtils.clone(CopyShader.uniforms),
    vertexShader: CopyShader.vertexShader,
    fragmentShader: CopyShader.fragmentShader,
    blending: CustomBlending,
    blendSrc: ConstantAlphaFactor,
    blendDst: OneMinusConstantAlphaFactor,
    blendSrcAlpha: ConstantAlphaFactor,
    blendDstAlpha: OneMinusConstantAlphaFactor,
    depthTest: false,
    depthWrite: false,
  });
  private readonly copy = new ShaderMaterial({
    uniforms: UniformsUtils.clone(CopyShader.uniforms),
    vertexShader: CopyShader.vertexShader,
    fragmentShader: CopyShader.fragmentShader,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  private readonly quad = new FullScreenQuad();

  setSize(width: number, height: number) {
    this.target.setSize(width, height);
  }

  render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget) {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    // Running mean: the new frame weighs 1 / (n + 1) against the n already accumulated.
    this.blend.uniforms.tDiffuse.value = readBuffer.texture;
    this.blend.blendAlpha = 1 / (this.sample + 1);
    this.blend.blending = this.sample === 0 ? NoBlending : CustomBlending;
    this.quad.material = this.blend;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);

    this.copy.uniforms.tDiffuse.value = this.target.texture;
    this.quad.material = this.copy;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }

  dispose() {
    this.target.dispose();
    this.blend.dispose();
    this.copy.dispose();
    this.quad.dispose();
  }
}
