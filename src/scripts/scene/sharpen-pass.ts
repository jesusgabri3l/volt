import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

/**
 * Contrast-adaptive sharpening (after AMD FidelityFX CAS), as the last pass in display space.
 * The multisampled render is clean but soft at native resolution: thin keycap legends and
 * edges read as faint when the keyboard rests. This lifts local contrast on edges, more where
 * contrast is low and less where it is already high, so it adds crispness without halos or
 * noise. Alpha passes through, so the transparent canvas still shows the page behind.
 */
export function createSharpenPass(strength: number): ShaderPass {
  return new ShaderPass({
    name: "SharpenShader",
    uniforms: {
      tDiffuse: { value: null },
      texel: { value: [1, 1] },
      strength: { value: strength },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 texel;
      uniform float strength;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
        vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
        vec3 e = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
        vec3 w = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;
        vec3 lo = min(c.rgb, min(min(n, s), min(e, w)));
        vec3 hi = max(c.rgb, max(max(n, s), max(e, w)));
        // Adaptive amount: full where the neighbourhood is low-contrast, none at hard edges.
        vec3 amp = sqrt(clamp(min(lo, 1.0 - hi) / max(hi, 1e-4), 0.0, 1.0));
        vec3 weight = -amp * mix(0.125, 0.2, strength);
        vec3 sharpened = (c.rgb + (n + s + e + w) * weight) / (1.0 + 4.0 * weight);
        gl_FragColor = vec4(clamp(sharpened, 0.0, 1.0), c.a);
      }
    `,
  });
}
