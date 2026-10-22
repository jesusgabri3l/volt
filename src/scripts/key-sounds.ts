import { withBase } from "../lib/url";

/**
 * Keystroke sounds, from a real switch recording: a few takes of an ordinary key and of the
 * large stabilized keys, picked at random (never the same take twice in a row) and varied a
 * little in pitch and level, so fast typing does not sound like a loop. Off until the visitor
 * turns it on; nothing is downloaded or decoded before that.
 *
 * Source: "Mechanical Keyboard Typing (Cherry Blue switches)" by simeonradivoev, Freesound
 * #638035, CC0. Cut into single strokes, softened with EQ; the large keys are pitched down.
 */

const SAMPLES = {
  key: ["key-1", "key-2", "key-3"],
  large: ["key-large-1", "key-large-2"],
};

/** Stabilized keys, which sound deeper on a real board. */
const LARGE_KEYS = new Set(["Space", "Enter", "Backspace", "ShiftLeft", "ShiftRight", "CapsLock"]);
const VOLUME = 0.55;
const PITCH_VARIATION = 0.04;
const LEVEL_VARIATION = 0.15;

export interface KeySounds {
  enabled: boolean;
  /** Plays one keystroke for a `KeyboardEvent.code`; undefined plays an ordinary key. */
  play(code?: string): void;
}

type Kind = keyof typeof SAMPLES;

const vary = (value: number, amount: number) => value * (1 + (Math.random() * 2 - 1) * amount);

export function createKeySounds(): KeySounds {
  let context: AudioContext | null = null;
  let output: GainNode | null = null;
  let buffers: Record<Kind, AudioBuffer[]> | null = null;
  let loading: Promise<void> | null = null;
  const last: Record<Kind, number> = { key: -1, large: -1 };
  let enabled = false;

  const load = () => {
    if (loading) return loading;
    try {
      context = new AudioContext();
    } catch {
      return (loading = Promise.resolve());
    }
    output = context.createGain();
    output.gain.value = VOLUME;
    output.connect(context.destination);
    const ctx = context;
    const decode = (name: string) =>
      fetch(withBase(`/assets/sounds/${name}.wav`))
        .then((response) => response.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data));
    loading = Promise.all([Promise.all(SAMPLES.key.map(decode)), Promise.all(SAMPLES.large.map(decode))])
      .then(([key, large]) => {
        buffers = { key, large };
      })
      .catch((error: unknown) => console.error("[VOLT] key sounds failed to load", error));
    return loading;
  };

  // Pick a take other than the previous one.
  const pick = (kind: Kind) => {
    const takes = buffers![kind];
    let index = Math.floor(Math.random() * takes.length);
    if (takes.length > 1 && index === last[kind]) index = (index + 1) % takes.length;
    last[kind] = index;
    return takes[index];
  };

  return {
    get enabled() {
      return enabled;
    },
    set enabled(value) {
      enabled = value;
      // Turned on from a click, which also lets the browser start audio.
      if (value) void load().then(() => context?.resume());
    },
    play(code) {
      if (!enabled || !context || !output || !buffers) return;
      // A keystroke is a user gesture, so a context the browser held back can start now.
      if (context.state === "suspended") void context.resume();
      const source = context.createBufferSource();
      source.buffer = pick(code && LARGE_KEYS.has(code) ? "large" : "key");
      source.playbackRate.value = vary(1, PITCH_VARIATION);
      const level = context.createGain();
      level.gain.value = vary(1, LEVEL_VARIATION);
      source.connect(level).connect(output);
      source.start();
    },
  };
}
