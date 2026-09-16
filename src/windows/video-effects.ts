export type VideoEffect = {
  id: string;
  kind: "zoom" | "mask";
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function activeVideoEffects(effects: VideoEffect[], time: number): VideoEffect[] {
  return effects.filter(effect => time >= effect.start && time < effect.end);
}

export function validVideoEffect(effect: VideoEffect, effects: VideoEffect[], duration: number): boolean {
  if (![effect.start, effect.end, effect.x, effect.y, effect.width, effect.height, duration].every(Number.isFinite)) return false;
  if (effect.start < 0 || effect.end > duration || effect.end - effect.start < 0.05 - 1e-9) return false;
  if (effect.x < 0 || effect.y < 0 || effect.width < 0.02 || effect.height < 0.02 || effect.x + effect.width > 1.000001 || effect.y + effect.height > 1.000001) return false;
  if (effect.kind === "zoom") {
    if (Math.abs(effect.width - effect.height) > 0.000001 || effect.width < 0.25 || effect.width > 1 / 1.5) return false;
    if (effects.some(other => other.id !== effect.id && other.kind === "zoom" && effect.start < other.end && effect.end > other.start)) return false;
  }
  return true;
}

export function createVideoEffect(kind: VideoEffect["kind"], time: number, duration: number, effects: VideoEffect[]): VideoEffect | null {
  if (effects.length >= 128) return null;
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration < 0.05) return null;
  const start = clamp(time, 0, duration - 0.05);
  let end = Math.min(duration, start + 3);
  if (kind === "zoom") {
    if (effects.some(effect => effect.kind === "zoom" && effect.start <= start && effect.end > start)) return null;
    for (const effect of effects) if (effect.kind === "zoom" && effect.start > start) end = Math.min(end, effect.start);
  }
  if (end - start < 0.05 - 1e-9) return null;
  const size = kind === "zoom" ? 0.5 : 0.25;
  return {id: crypto.randomUUID(), kind, start, end, x: (1 - size) / 2, y: (1 - size) / 2, width: size, height: size};
}

export function moveVideoEffect(effect: VideoEffect, dx: number, dy: number): VideoEffect {
  return {...effect, x: clamp(effect.x + dx, 0, 1 - effect.width), y: clamp(effect.y + dy, 0, 1 - effect.height)};
}

export function resizeVideoEffect(effect: VideoEffect, dx: number, dy: number): VideoEffect {
  if (effect.kind === "zoom") {
    const size = clamp(effect.width + (Math.abs(dx) > Math.abs(dy) ? dx : dy), 0.25, 1 / 1.5);
    return {...effect, width: size, height: size, x: Math.min(effect.x, 1 - size), y: Math.min(effect.y, 1 - size)};
  }
  return {...effect, width: clamp(effect.width + dx, 0.02, 1 - effect.x), height: clamp(effect.height + dy, 0.02, 1 - effect.y)};
}
