import { EquirectangularReflectionMapping, type Scene, type Texture } from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

export interface StudioLighting {
  dispose(): void;
}

/**
 * Lights and reflects the keyboard with the Cycles hero studio: an equirectangular HDRI
 * rendered from the keyboard's position (`tools/blender/bake_studio.py`), so the metal and
 * the chamfers pick up the same softboxes as the Cycles render. The studio itself is not
 * drawn; the transparent canvas shows the page gradient behind it.
 */
export async function createStudioLighting(scene: Scene, environmentUrl: string): Promise<StudioLighting> {
  const environment: Texture = await new HDRLoader().loadAsync(environmentUrl);
  environment.mapping = EquirectangularReflectionMapping;
  scene.environment = environment;
  return {
    dispose() {
      environment.dispose();
    },
  };
}
