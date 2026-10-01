import { framesToTimecode, secondsToFrames, timecodeToFrames } from "./timecode";
import type { CutItem, FrameRate, Segment } from "./types";

export interface Range {
  start: number;
  end: number;
  section: string;
  text: string;
  /** True when this range opens a new section on the board. */
  sectionStart: boolean;
}

export interface ExportOptions {
  title: string;
  mediaName: string;
  /** Absolute folder of the media on the editor's machine, used for FCPXML linking. */
  mediaFolder: string;
  mediaDuration: number;
  width: number;
  height: number;
  rate: FrameRate;
  /** Timecode of the first frame of the source file (camera TC). */
  sourceStartTc: string;
  /** Extra seconds kept either side of each line so words aren't clipped. */
  padSeconds: number;
}

/**
 * Resolves the board into source ranges. Lines that follow each other in the
 * source (and on the board) are merged into a single edit so the export is
 * not chopped at every sentence.
 */
export function cutToRanges(cut: CutItem[], segments: Segment[], pad = 0, mediaDuration = Infinity): Range[] {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const ranges: Range[] = [];
  let prevSection: string | null = null;
  for (const item of cut) {
    const seg = byId.get(item.segmentId);
    if (!seg) continue;
    const sectionStart = item.section !== prevSection;
    prevSection = item.section;
    const last = ranges[ranges.length - 1];
    if (last && !sectionStart && seg.start >= last.end - 0.05 && seg.start - last.end < 0.75) {
      last.end = seg.end;
      last.text = `${last.text} ${seg.text}`;
      continue;
    }
    ranges.push({ start: seg.start, end: seg.end, section: item.section, text: seg.text, sectionStart });
  }
  return ranges.map((r, i) => {
    // Pad without overlapping the neighbouring edit's source range when it is adjacent.
    const prev = ranges[i - 1];
    const next = ranges[i + 1];
    let start = Math.max(0, r.start - pad);
    let end = Math.min(mediaDuration || Infinity, r.end + pad);
    if (prev && prev.end <= r.start && start < prev.end) start = r.start;
    if (next && next.start >= r.end && end > next.start) end = r.end;
    return { ...r, start, end };
  });
}

export function totalDuration(ranges: Range[]): number {
  return ranges.reduce((acc, r) => acc + (r.end - r.start), 0);
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// CMX3600 is ASCII-only; many importers choke on anything else.
const edlSafe = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7e]/g, "")
    .slice(0, 120);

/** CMX3600 EDL — imports into Premiere Pro, DaVinci Resolve and Avid. */
export function toEdl(ranges: Range[], o: ExportOptions): string {
  const { rate } = o;
  const srcOffset = timecodeToFrames(o.sourceStartTc, rate);
  let rec = timecodeToFrames("01:00:00:00", rate);
  const lines = [`TITLE: ${edlSafe(o.title).toUpperCase()}`, "FCM: NON-DROP FRAME", ""];
  ranges.forEach((r, i) => {
    const srcIn = srcOffset + secondsToFrames(r.start, rate);
    const srcOut = srcOffset + secondsToFrames(r.end, rate);
    const len = srcOut - srcIn;
    if (len <= 0) return;
    const num = String(i + 1).padStart(3, "0");
    lines.push(
      `${num}  AX       AA/V  C        ${framesToTimecode(srcIn, rate)} ${framesToTimecode(srcOut, rate)} ${framesToTimecode(rec, rate)} ${framesToTimecode(rec + len, rate)}`,
      `* FROM CLIP NAME: ${edlSafe(o.mediaName)}`,
    );
    if (r.sectionStart) lines.push(`* COMMENT: ${edlSafe(r.section.toUpperCase())}`);
    lines.push(`* ${edlSafe(r.text)}`, "");
    rec += len;
  });
  return lines.join("\n");
}

/** FCPXML 1.10 — imports into Final Cut Pro and DaVinci Resolve. */
export function toFcpxml(ranges: Range[], o: ExportOptions): string {
  const { rate } = o;
  // A time of N frames is N * den / num seconds, kept rational so FCP stays frame-accurate.
  const t = (frames: number) => (frames === 0 ? "0s" : `${frames * rate.den}/${rate.num}s`);
  const srcStart = timecodeToFrames(o.sourceStartTc, rate);
  const assetFrames = Math.max(secondsToFrames(o.mediaDuration, rate), ...ranges.map((r) => secondsToFrames(r.end, rate)));
  const folder = o.mediaFolder.trim().replace(/\\/g, "/").replace(/\/$/, "");
  const src = folder ? `file://${folder.startsWith("/") ? "" : "/"}${encodeURI(folder)}/${encodeURIComponent(o.mediaName)}` : encodeURIComponent(o.mediaName);

  let offset = 0;
  const clips = ranges
    .map((r) => {
      const inF = secondsToFrames(r.start, rate);
      const len = secondsToFrames(r.end, rate) - inF;
      if (len <= 0) return "";
      const marker = r.sectionStart
        ? `\n            <marker start="${t(srcStart + inF)}" duration="${t(1)}" value="${xmlEscape(r.section)}"/>`
        : "";
      const clip = `          <asset-clip ref="r2" offset="${t(offset)}" name="${xmlEscape(r.text.slice(0, 60))}" start="${t(srcStart + inF)}" duration="${t(len)}" tcFormat="NDF">${marker}
          </asset-clip>`;
      offset += len;
      return clip;
    })
    .filter(Boolean)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" frameDuration="${t(1)}" width="${o.width}" height="${o.height}"/>
    <asset id="r2" name="${xmlEscape(o.mediaName)}" start="${t(srcStart)}" duration="${t(assetFrames)}" hasVideo="1" hasAudio="1" format="r1" audioSources="1" audioChannels="2" audioRate="48000">
      <media-rep kind="original-media" src="${xmlEscape(src)}"/>
    </asset>
  </resources>
  <library>
    <event name="Storycut">
      <project name="${xmlEscape(o.title)}">
        <sequence format="r1" duration="${t(offset)}" tcStart="${t(timecodeToFrames("01:00:00:00", rate))}" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${clips}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

/** Readable paper edit / script for producers and clients. */
export function toScript(ranges: Range[], segments: Segment[], cut: CutItem[], title: string): string {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const lines = [title.toUpperCase(), `Runtime ≈ ${Math.round(totalDuration(ranges))}s`, ""];
  let section: string | null = null;
  for (const item of cut) {
    const seg = byId.get(item.segmentId);
    if (!seg) continue;
    if (item.section !== section) {
      section = item.section;
      lines.push("", `== ${section.toUpperCase()} ==`, "");
    }
    lines.push(`${seg.speaker.toUpperCase()}: ${seg.text}`);
    if (item.note) lines.push(`   [${item.note}]`);
  }
  return lines.join("\n").trim() + "\n";
}

export function download(filename: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
