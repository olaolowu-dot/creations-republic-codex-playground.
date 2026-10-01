// Parses timelines exported from DaVinci Resolve (FCPXML, FCP7 XML, EDL)
// into a flat list of clips with source and record (timeline) times in seconds.

export interface TimelineClip {
  id: string;
  timeline: string;
  name: string;
  /** Media file name (basename), used to link to files picked from disk. */
  file: string;
  /** Full path as written by Resolve, for display only. */
  path: string;
  kind: "video" | "audio";
  srcIn: number;
  srcOut: number;
  recIn: number;
  recOut: number;
}

export interface Timeline {
  name: string;
  source: string;
  clips: TimelineClip[];
}

const basename = (p: string) => {
  try {
    p = decodeURIComponent(p);
  } catch {
    // keep as is
  }
  return p.replace(/^file:\/\/(localhost)?/, "").split(/[\\/]/).pop() || p;
};

/** FCPXML rational time: "0s", "10s", "1001/30000s", "3600/1s". */
export function rationalTime(v: string | null | undefined): number {
  if (!v) return 0;
  const m = v.trim().match(/^(-?\d+(?:\.\d+)?)(?:\/(\d+))?s?$/);
  if (!m) return 0;
  return Number(m[1]) / (m[2] ? Number(m[2]) : 1);
}

function stem(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

let n = 0;
const clipId = () => `c${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------- FCPXML

export function parseFcpxml(xml: string, fileName = "timeline.fcpxml"): Timeline[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error(`${fileName}: not valid XML`);

  const assets = new Map<string, { name: string; path: string; hasVideo: boolean; start: number }>();
  doc.querySelectorAll("resources > asset").forEach((a) => {
    const src = a.querySelector("media-rep")?.getAttribute("src") ?? a.getAttribute("src") ?? "";
    assets.set(a.getAttribute("id") ?? "", {
      name: a.getAttribute("name") ?? basename(src),
      path: src,
      hasVideo: a.getAttribute("hasVideo") === "1",
      // Clip `start` values are in the asset's own timecode; this is its first frame.
      start: rationalTime(a.getAttribute("start")),
    });
  });

  const timelines: Timeline[] = [];
  doc.querySelectorAll("project").forEach((project, pi) => {
    const sequence = project.querySelector("sequence");
    const spine = sequence?.querySelector(":scope > spine");
    if (!sequence || !spine) return;
    const name = project.getAttribute("name") || `${stem(fileName)}${pi ? ` ${pi + 1}` : ""}`;
    const tcStart = rationalTime(sequence.getAttribute("tcStart"));
    const clips: TimelineClip[] = [];

    // rec = where the element's local time `start` lands on the timeline.
    const walk = (el: Element, parentRec: number, parentStart: number, lane: number) => {
      const tag = el.tagName;
      const offset = rationalTime(el.getAttribute("offset"));
      const start = rationalTime(el.getAttribute("start"));
      const duration = rationalTime(el.getAttribute("duration"));
      const rec = parentRec + (offset - parentStart);
      const elLane = Number(el.getAttribute("lane") ?? lane);

      let ref: string | null = null;
      let srcIn = start;
      if (tag === "asset-clip") ref = el.getAttribute("ref");
      else if (tag === "clip" || tag === "sync-clip") {
        const inner = el.querySelector(":scope > video[ref], :scope > audio[ref]");
        if (inner) {
          ref = inner.getAttribute("ref");
          srcIn = start - rationalTime(inner.getAttribute("offset")) + rationalTime(inner.getAttribute("start"));
        }
      } else if ((tag === "video" || tag === "audio") && el.getAttribute("ref") && el.parentElement?.tagName === "spine") {
        ref = el.getAttribute("ref");
      }

      if (ref && duration > 0) {
        const asset = assets.get(ref);
        if (asset) {
          const isAudio = tag === "audio" || !asset.hasVideo;
          clips.push({
            id: clipId(),
            timeline: name,
            name: el.getAttribute("name") || asset.name,
            file: basename(asset.path) || asset.name,
            path: asset.path,
            kind: isAudio || elLane < 0 ? "audio" : "video",
            srcIn: srcIn - asset.start,
            srcOut: srcIn - asset.start + duration,
            recIn: rec,
            recOut: rec + duration,
          });
        }
      }

      // Connected clips (lane=…) and gap children are timed in this element's local time.
      for (const child of Array.from(el.children)) {
        if (child.hasAttribute("lane") || tag === "gap") walk(child, rec, start, elLane);
      }
    };

    for (const el of Array.from(spine.children)) walk(el, -tcStart, 0, 0);
    timelines.push({ name, source: fileName, clips: sortClips(clips) });
  });
  if (!timelines.length) throw new Error(`${fileName}: no timeline found`);
  return timelines;
}

// ---------------------------------------------------------- FCP 7 XML

export function parseXmeml(xml: string, fileName = "timeline.xml"): Timeline[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error(`${fileName}: not valid XML`);
  const files = new Map<string, { name: string; path: string }>();
  doc.querySelectorAll("file[id]").forEach((f) => {
    const path = f.querySelector(":scope > pathurl")?.textContent ?? "";
    const name = f.querySelector(":scope > name")?.textContent ?? basename(path);
    if (path || name) files.set(f.getAttribute("id")!, { name, path });
  });

  const timelines: Timeline[] = [];
  doc.querySelectorAll("sequence").forEach((seq) => {
    const name = seq.querySelector(":scope > name")?.textContent || stem(fileName);
    const fps = Number(seq.querySelector(":scope > rate > timebase")?.textContent) || 24;
    const ntsc = seq.querySelector(":scope > rate > ntsc")?.textContent === "TRUE";
    const rate = ntsc ? (fps * 1000) / 1001 : fps;
    const clips: TimelineClip[] = [];
    (["video", "audio"] as const).forEach((kind) => {
      seq.querySelectorAll(`:scope > media > ${kind} > track > clipitem`).forEach((ci) => {
        const num = (sel: string) => Number(ci.querySelector(`:scope > ${sel}`)?.textContent ?? NaN);
        const [start, end, inF, outF] = [num("start"), num("end"), num("in"), num("out")];
        if (![start, end, inF, outF].every(Number.isFinite) || start < 0 || end <= start) return;
        const fileId = ci.querySelector(":scope > file")?.getAttribute("id") ?? "";
        const f = files.get(fileId);
        if (!f) return;
        clips.push({
          id: clipId(),
          timeline: name,
          name: ci.querySelector(":scope > name")?.textContent || f.name,
          file: basename(f.path) || f.name,
          path: f.path,
          kind,
          srcIn: inF / rate,
          srcOut: outF / rate,
          recIn: start / rate,
          recOut: end / rate,
        });
      });
    });
    timelines.push({ name, source: fileName, clips: sortClips(clips) });
  });
  if (!timelines.length) throw new Error(`${fileName}: no sequence found`);
  return timelines;
}

// ----------------------------------------------------------------- EDL

function tcToSeconds(tc: string, fps: number): number {
  const [h, m, s, f] = tc.split(/[:;]/).map(Number);
  return h * 3600 + m * 60 + s + f / Math.round(fps);
}

export function parseEdl(text: string, fps: number, fileName = "timeline.edl"): Timeline[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const title = lines.find((l) => l.startsWith("TITLE:"))?.slice(6).trim() || stem(fileName);
  const event = /^(\d{3,})\s+(\S+)\s+(\S+)\s+(\S+)\s+(?:\d+\s+)?(\d\d:\d\d:\d\d[:;]\d\d)\s+(\d\d:\d\d:\d\d[:;]\d\d)\s+(\d\d:\d\d:\d\d[:;]\d\d)\s+(\d\d:\d\d:\d\d[:;]\d\d)/;
  const raw: (TimelineClip & { reel: string })[] = [];
  for (const line of lines) {
    const m = line.match(event);
    if (m) {
      const [, , reel, track, , si, so, ri, ro] = m;
      raw.push({
        id: clipId(),
        timeline: title,
        name: reel,
        file: reel,
        path: "",
        reel,
        kind: track.startsWith("A") ? "audio" : "video",
        srcIn: tcToSeconds(si, fps),
        srcOut: tcToSeconds(so, fps),
        recIn: tcToSeconds(ri, fps),
        recOut: tcToSeconds(ro, fps),
      });
      continue;
    }
    const last = raw[raw.length - 1];
    const clipName = line.match(/^\*\s*FROM CLIP NAME:\s*(.+)$/i);
    if (last && clipName) {
      last.name = clipName[1].trim();
      last.file = clipName[1].trim();
    }
    const source = line.match(/^\*\s*SOURCE FILE:\s*(.+)$/i);
    if (last && source) {
      last.path = source[1].trim();
      last.file = basename(source[1].trim());
    }
  }
  if (!raw.length) throw new Error(`${fileName}: no edit events found`);
  // Timelines usually start at 01:00:00:00; make record times timeline-relative.
  const origin = Math.floor(Math.min(...raw.map((c) => c.recIn)) / 3600) * 3600;
  const clips = raw.filter((c) => c.recOut > c.recIn).map(({ reel: _reel, ...c }) => ({ ...c, recIn: c.recIn - origin, recOut: c.recOut - origin }));
  return [{ name: title, source: fileName, clips: sortClips(clips) }];
}

// --------------------------------------------------------------------

function sortClips(clips: TimelineClip[]): TimelineClip[] {
  return clips.sort((a, b) => a.recIn - b.recIn || (a.kind === b.kind ? 0 : a.kind === "video" ? -1 : 1));
}

export function parseTimelineFile(name: string, content: string, edlFps = 24): Timeline[] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".edl")) return parseEdl(content, edlFps, name);
  if (content.includes("<fcpxml")) return parseFcpxml(content, name);
  if (content.includes("<xmeml")) return parseXmeml(content, name);
  throw new Error(`${name}: export the timeline from Resolve as FCPXML, FCP 7 XML or EDL`);
}

/**
 * Clips worth transcribing: one per distinct piece of source audio. The video and
 * linked audio of the same clip collapse into one; later uses of the same take are kept
 * (they are separate moments in the edit).
 */
export function transcribableClips(timeline: Timeline): TimelineClip[] {
  const out: TimelineClip[] = [];
  for (const c of timeline.clips) {
    const dup = out.find(
      (o) => o.file === c.file && Math.abs(o.recIn - c.recIn) < 0.1 && Math.abs(o.srcIn - c.srcIn) < 0.1,
    );
    if (!dup) out.push(c);
  }
  return out;
}
