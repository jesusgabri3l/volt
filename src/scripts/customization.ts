/**
 * The customization options, shared by the controls (markup) and the 3D scene (materials),
 * so names and colours live in one place. Colours are sRGB hex.
 */

export interface ChassisFinish {
  id: string;
  label: string;
  color: string;
  /** Anodized metals are fully metallic; the off-white finish reads as a painted coat. */
  metalness: number;
  roughness: number;
}

export interface KeycapColour {
  id: string;
  label: string;
  color: string;
  /**
   * Legend colour on this cap, or null for shine-through legends that take the LED colour
   * (only on black, where a lit legend reads best). Coloured caps keep a fixed
   * high-contrast legend with only a hint of the LED.
   */
  legend: string | null;
}

export interface LedColour {
  id: string;
  label: string;
  color: string;
}

export const CHASSIS: ChassisFinish[] = [
  { id: "graphite", label: "Grafito", color: "#6f7276", metalness: 1, roughness: 0.36 },
  { id: "silver", label: "Plata", color: "#c4c7cb", metalness: 1, roughness: 0.3 },
  { id: "off-white", label: "Blanco hueso", color: "#e4ddd0", metalness: 0.15, roughness: 0.45 },
];

// Dark tones only, all with shine-through legends: the backlight reads on every cap.
export const KEYCAPS: KeycapColour[] = [
  { id: "black", label: "Negro", color: "#1d1f21", legend: null },
  { id: "graphite", label: "Grafito", color: "#2a2c30", legend: null },
  { id: "forest", label: "Verde bosque", color: "#17221c", legend: null },
  { id: "midnight", label: "Azul noche", color: "#141a26", legend: null },
  { id: "wine", label: "Vino", color: "#26131a", legend: null },
];

export const LEDS: LedColour[] = [
  { id: "white", label: "Blanco", color: "#f3f7ff" },
  { id: "red", label: "Rojo", color: "#ff2a2a" },
  { id: "blue", label: "Azul", color: "#3d6bff" },
  { id: "green", label: "Verde", color: "#2bff7a" },
  { id: "pink", label: "Rosado", color: "#ff5fb8" },
];

export interface Customization {
  chassis: string;
  keycaps: string;
  led: string;
}

export const PRESETS: { id: string; label: string; config: Customization }[] = [
  { id: "stealth", label: "Stealth", config: { chassis: "graphite", keycaps: "black", led: "white" } },
  { id: "classic", label: "Classic", config: { chassis: "silver", keycaps: "midnight", led: "white" } },
  { id: "contrast", label: "Contrast", config: { chassis: "off-white", keycaps: "black", led: "red" } },
];

export const DEFAULT_CUSTOMIZATION: Customization = PRESETS[0].config;

/** The event the controls dispatch on `document` when the visitor changes an option. */
export const CUSTOMIZE_EVENT = "volt:customize";

export function presetFor(config: Customization): string | undefined {
  return PRESETS.find(
    (p) => p.config.chassis === config.chassis && p.config.keycaps === config.keycaps && p.config.led === config.led,
  )?.id;
}
