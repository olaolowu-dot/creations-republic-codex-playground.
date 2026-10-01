import { FRAME_RATES, type FrameRate } from "./types";

export function frameRate(label: string): FrameRate {
  return FRAME_RATES.find((r) => r.label === label) ?? FRAME_RATES[2];
}

/** Nominal integer rate used for timecode counting (29.97 counts as 30, non-drop). */
export function nominalFps(rate: FrameRate): number {
  return Math.round(rate.num / rate.den);
}

export function secondsToFrames(seconds: number, rate: FrameRate): number {
  return Math.round((seconds * rate.num) / rate.den);
}

/** Non-drop-frame SMPTE timecode, HH:MM:SS:FF. */
export function framesToTimecode(frames: number, rate: FrameRate): string {
  const fps = nominalFps(rate);
  const f = Math.max(0, Math.round(frames));
  const ff = f % fps;
  const totalSeconds = Math.floor(f / fps);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return [hh, mm, ss, ff].map((n) => String(n).padStart(2, "0")).join(":");
}

export function timecodeToFrames(tc: string, rate: FrameRate): number {
  const parts = tc.trim().split(/[:;.]/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid timecode: ${tc}`);
  }
  const [hh, mm, ss, ff] = parts;
  return ((hh * 60 + mm) * 60 + ss) * nominalFps(rate) + ff;
}

/** Short human clock for the UI, e.g. 1:05 or 1:02:09. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
