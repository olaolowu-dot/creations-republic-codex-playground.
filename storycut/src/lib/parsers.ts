import type { Segment } from "./types";

let counter = 0;
export function segmentId(): string {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}`;
}

/** "00:01:02,500" | "01:02.5" | "62.5" -> seconds */
export function parseClock(value: string): number {
  const v = value.trim().replace(",", ".");
  const parts = v.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) throw new Error(`Bad time: ${value}`);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const SPEAKER_PREFIX = /^([A-Z][\w .'-]{0,30}):\s+/;
const VTT_VOICE = /^<v(?:\.[^ >]*)?\s+([^>]+)>/;

function splitSpeaker(text: string, fallback: string): { speaker: string; text: string } {
  const voice = text.match(VTT_VOICE);
  if (voice) {
    return { speaker: voice[1].trim(), text: text.replace(VTT_VOICE, "").replace(/<\/v>/g, "").trim() };
  }
  const prefix = text.match(SPEAKER_PREFIX);
  if (prefix) return { speaker: prefix[1].trim(), text: text.slice(prefix[0].length).trim() };
  return { speaker: fallback, text: text.trim() };
}

function stripTags(text: string): string {
  return text.replace(/<(?!v[ .])[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** Parses SRT and WebVTT cue files (the two formats every NLE can export captions as). */
export function parseCues(input: string): Segment[] {
  const blocks = input.replace(/\r/g, "").replace(/^WEBVTT[^\n]*\n/, "").split(/\n{2,}/);
  const out: Segment[] = [];
  let lastSpeaker = "Speaker 1";
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const timingIndex = lines.findIndex((l) => l.includes("-->"));
    if (timingIndex === -1) continue;
    const [a, b] = lines[timingIndex].split("-->");
    const start = parseClock(a);
    const end = parseClock(b.trim().split(/\s+/)[0]);
    const raw = stripTags(lines.slice(timingIndex + 1).join(" "));
    if (!raw) continue;
    const { speaker, text } = splitSpeaker(raw, lastSpeaker);
    lastSpeaker = speaker;
    out.push({ id: segmentId(), start, end, speaker, text });
  }
  return out;
}

interface LooseSegment {
  start?: number | string;
  end?: number | string;
  speaker?: string;
  text?: string;
  timestamp?: [number, number | null];
}

/** Accepts [{start,end,text,speaker}], {segments:[...]} (Whisper JSON) or {chunks:[...]}. */
export function parseJson(input: string): Segment[] {
  const data = JSON.parse(input) as unknown;
  const list: LooseSegment[] = Array.isArray(data)
    ? data
    : ((data as { segments?: LooseSegment[]; chunks?: LooseSegment[] }).segments ??
      (data as { chunks?: LooseSegment[] }).chunks ??
      []);
  return list
    .map((s) => {
      const start = s.timestamp ? s.timestamp[0] : Number(typeof s.start === "string" ? parseClock(s.start) : s.start);
      const endRaw = s.timestamp ? s.timestamp[1] : typeof s.end === "string" ? parseClock(s.end) : s.end;
      const end = Number(endRaw ?? start);
      return {
        id: segmentId(),
        start,
        end,
        speaker: s.speaker?.trim() || "Speaker 1",
        text: (s.text ?? "").trim(),
      };
    })
    .filter((s) => s.text && Number.isFinite(s.start) && Number.isFinite(s.end));
}

export function parseTranscriptFile(name: string, content: string): Segment[] {
  const lower = name.toLowerCase();
  const segments = lower.endsWith(".json") ? parseJson(content) : parseCues(content);
  if (!segments.length) throw new Error("No timed lines found. Use .srt, .vtt or .json with start/end times.");
  return segments.sort((a, b) => a.start - b.start);
}

/**
 * Whisper returns short phrase chunks; editors think in sentences.
 * Merge consecutive chunks until a sentence ends or the line gets long.
 */
export function mergeChunks(
  chunks: { start: number; end: number; text: string }[],
  maxSeconds = 14,
): Segment[] {
  const out: Segment[] = [];
  let cur: { start: number; end: number; text: string } | null = null;
  for (const c of chunks) {
    const text = c.text.trim();
    if (!text) continue;
    if (!cur) cur = { ...c, text };
    else {
      cur.end = c.end;
      cur.text = `${cur.text} ${text}`;
    }
    if (/[.!?]["')\]]?$/.test(cur.text) || cur.end - cur.start >= maxSeconds) {
      out.push({ id: segmentId(), speaker: "Speaker 1", ...cur });
      cur = null;
    }
  }
  if (cur) out.push({ id: segmentId(), speaker: "Speaker 1", ...cur });
  return out;
}
