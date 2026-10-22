/**
 * Reports how far the page has scrolled through an element (0 when its top reaches the
 * top of the viewport, 1 when its bottom reaches the bottom), at most once per frame.
 * Native scrolling is never intercepted.
 */
export function observeScrollProgress(element: HTMLElement, onProgress: (progress: number) => void): () => void {
  let frame = 0;
  const measure = () => {
    frame = 0;
    const rect = element.getBoundingClientRect();
    const travel = rect.height - window.innerHeight;
    const progress = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
    onProgress(progress);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  measure();
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
  };
}

/**
 * Reports where the page is in the scroll narrative (0–1), at most once per frame. The
 * narrative is split into equal steps between stops: each element marked `data-scene-stop`
 * (or `data-scene-stops="n"` for n stops spread evenly through a tall element) is a stop
 * when its top reaches the top of the viewport, and the end of `experience` is the last.
 * Stops are measured from the real layout, so a section taller than the viewport (a short
 * landscape screen) delays the scenes after it instead of throwing them out of step.
 * Positions are measured on resize only; scrolling reads `scrollY`.
 */
export function observeNarrativeProgress(experience: HTMLElement, onProgress: (progress: number) => void): () => void {
  let stops: number[] = [];
  let frame = 0;
  const measureStops = () => {
    stops = [];
    for (const element of experience.querySelectorAll<HTMLElement>("[data-scene-stop], [data-scene-stops]")) {
      const rect = element.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const count = Number(element.dataset.sceneStops ?? 1);
      for (let i = 0; i < count; i++) stops.push(top + (rect.height * i) / count);
    }
    const end = experience.getBoundingClientRect().bottom + window.scrollY - window.innerHeight;
    stops.push(Math.max(end, stops.at(-1) ?? 0));
  };
  const report = () => {
    frame = 0;
    const y = window.scrollY;
    const steps = stops.length - 1;
    if (steps < 1 || y <= stops[0]) return onProgress(0);
    if (y >= stops[steps]) return onProgress(1);
    let k = 0;
    while (y >= stops[k + 1]) k++;
    const span = stops[k + 1] - stops[k];
    onProgress((k + (span > 0 ? (y - stops[k]) / span : 1)) / steps);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(report);
  };
  const resize = () => {
    measureStops();
    schedule();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(experience);
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", resize);
  measureStops();
  report();
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", resize);
  };
}
