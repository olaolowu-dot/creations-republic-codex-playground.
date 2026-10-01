import type { Timeline, TimelineClip } from "./timeline";
import { transcribableClips } from "./timeline";

/** A transcribed line, timed on its timeline (seconds from timeline start). */
export interface ScriptLine {
  id: string;
  clipId: string;
  timeline: string;
  start: number;
  end: number;
  text: string;
  character: string;
  parenthetical: string;
}

/** Reference material: prompts, character sheets, treatments, scripts. */
export interface Reference {
  id: string;
  name: string;
  text: string;
}

export interface ScriptScene {
  firstClipId: string;
  heading: string;
  action: string;
}

export interface ScriptCharacter {
  name: string;
  description: string;
}

export interface ScriptPlan {
  title: string;
  logline: string;
  characters: ScriptCharacter[];
  scenes: ScriptScene[];
  notes: string;
}

export type ClipStatus = "done" | "silent" | "missing" | "error";

export interface ScriptProject {
  title: string;
  timelines: Timeline[];
  references: Reference[];
  lines: ScriptLine[];
  clipStatus: Record<string, ClipStatus>;
  plan: ScriptPlan | null;
  notes: string;
}

export function emptyScriptProject(): ScriptProject {
  return { title: "", timelines: [], references: [], lines: [], clipStatus: {}, plan: null, notes: "" };
}

/** Assignment Claude returns for one line. */
export interface LineAssignment {
  id: string;
  character: string;
  parenthetical: string;
  text: string;
}

export interface ScriptRequestClip {
  id: string;
  name: string;
  file: string;
  recIn: number;
  recOut: number;
  lines: { id: string; start: number; text: string }[];
}

export interface ScriptRequest {
  timelines: { name: string; clips: ScriptRequestClip[] }[];
  references: { name: string; text: string }[];
  notes: string;
}

export interface ScriptResponse extends ScriptPlan {
  lines: LineAssignment[];
}

export function buildScriptRequest(p: ScriptProject): ScriptRequest {
  return {
    timelines: p.timelines.map((t) => ({
      name: t.name,
      clips: transcribableClips(t).map((c) => ({
        id: c.id,
        name: c.name,
        file: c.file,
        recIn: c.recIn,
        recOut: c.recOut,
        lines: p.lines
          .filter((l) => l.clipId === c.id)
          .sort((a, b) => a.start - b.start)
          .map((l) => ({ id: l.id, start: l.start, text: l.text })),
      })),
    })),
    references: p.references.map((r) => ({ name: r.name, text: r.text })),
    notes: p.notes,
  };
}

// ------------------------------------------------------------- assembly

export type ScriptBlock =
  | { kind: "timeline"; name: string }
  | { kind: "scene"; heading: string; action: string; clip: TimelineClip }
  | { kind: "clip"; clip: TimelineClip; status?: ClipStatus }
  | { kind: "line"; line: ScriptLine };

/** Script in reading order: timeline → clip (by record time) → lines. */
export function assemble(p: ScriptProject): ScriptBlock[] {
  const scenes = new Map(p.plan?.scenes.map((s) => [s.firstClipId, s]) ?? []);
  const out: ScriptBlock[] = [];
  for (const t of p.timelines) {
    out.push({ kind: "timeline", name: t.name });
    for (const clip of transcribableClips(t)) {
      const scene = scenes.get(clip.id);
      if (scene) out.push({ kind: "scene", heading: scene.heading, action: scene.action, clip });
      out.push({ kind: "clip", clip, status: p.clipStatus[clip.id] });
      p.lines
        .filter((l) => l.clipId === clip.id)
        .sort((a, b) => a.start - b.start)
        .forEach((line) => out.push({ kind: "line", line }));
    }
  }
  return out;
}

export function applyAssignments(lines: ScriptLine[], assignments: LineAssignment[]): ScriptLine[] {
  const byId = new Map(assignments.map((a) => [a.id, a]));
  return lines.map((l) => {
    const a = byId.get(l.id);
    if (!a) return l;
    return {
      ...l,
      character: a.character.trim() || l.character,
      parenthetical: a.parenthetical.trim().replace(/^\((.*)\)$/, "$1").trim(),
      text: a.text.trim() || l.text,
    };
  });
}

export function characters(lines: ScriptLine[]): string[] {
  return [...new Set(lines.map((l) => l.character).filter(Boolean))].sort();
}

// --------------------------------------------------------------- export

const SCENE_PREFIX = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. ]/i;

/** Fountain screenplay — opens in Highland, Final Draft, WriterSolo, Fade In, Slugline. */
export function toFountain(p: ScriptProject): string {
  const out: string[] = [
    `Title: ${p.plan?.title || p.title || "Untitled"}`,
    "Credit: Transcribed from timelines with Storycut",
    `Draft date: ${new Date().toISOString().slice(0, 10)}`,
    "",
  ];
  for (const b of assemble(p)) {
    if (b.kind === "timeline") out.push("", `# ${b.name}`, "");
    else if (b.kind === "scene") {
      const heading = b.heading.trim().toUpperCase();
      out.push("", SCENE_PREFIX.test(heading) ? heading : `.${heading}`, "");
      if (b.action.trim()) out.push(b.action.trim(), "");
    } else if (b.kind === "line") {
      const name = (b.line.character || "Unknown").toUpperCase();
      // Fountain needs a Latin capital to recognise a character cue; force it otherwise.
      out.push(/[A-Z]/.test(name) ? name : `@${name}`);
      if (b.line.parenthetical) out.push(`(${b.line.parenthetical.replace(/^\(|\)$/g, "")})`);
      out.push(b.line.text, "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function srtTime(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const sec = Math.floor(ms / 1000) % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)},${pad(ms % 1000, 3)}`;
}

/** Subtitles for one timeline, "CHARACTER: line", for Resolve's subtitle track. */
export function toSrt(p: ScriptProject, timeline: string, offsetSeconds = 0): string {
  return p.lines
    .filter((l) => l.timeline === timeline)
    .sort((a, b) => a.start - b.start)
    .map((l, i) => {
      const who = l.character ? `${l.character.toUpperCase()}: ` : "";
      return `${i + 1}\n${srtTime(l.start + offsetSeconds)} --> ${srtTime(l.end + offsetSeconds)}\n${who}${l.text}\n`;
    })
    .join("\n");
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(p: ScriptProject): string {
  const rows: (string | number)[][] = [["timeline", "start", "end", "clip", "file", "character", "parenthetical", "text"]];
  const clipById = new Map(p.timelines.flatMap((t) => t.clips.map((c) => [c.id, c] as const)));
  for (const b of assemble(p)) {
    if (b.kind !== "line") continue;
    const c = clipById.get(b.line.clipId);
    rows.push([b.line.timeline, srtTime(b.line.start).replace(",", "."), srtTime(b.line.end).replace(",", "."), c?.name ?? "", c?.file ?? "", b.line.character, b.line.parenthetical, b.line.text]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
