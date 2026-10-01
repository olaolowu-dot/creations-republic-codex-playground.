import { describe, expect, it } from "vitest";
import { sanitize } from "../server/story";
import { cutToRanges, toEdl, toFcpxml, toScript, totalDuration } from "../src/lib/exporters";
import { mergeChunks, parseClock, parseCues, parseJson } from "../src/lib/parsers";
import { frameRate, framesToTimecode, secondsToFrames, timecodeToFrames } from "../src/lib/timecode";
import type { CutItem, Segment, StoryPlan } from "../src/lib/types";

const segs: Segment[] = [
  { id: "a", start: 0, end: 2, speaker: "Q", text: "Question?" },
  { id: "b", start: 2.1, end: 5, speaker: "Maya", text: "First answer." },
  { id: "c", start: 5.2, end: 8, speaker: "Maya", text: "Second answer." },
  { id: "d", start: 20, end: 24, speaker: "Maya", text: "Later line." },
];
const item = (segmentId: string, section = "Hook"): CutItem => ({ uid: segmentId, segmentId, section });

describe("timecode", () => {
  it("round-trips non-drop timecode", () => {
    const r = frameRate("25");
    expect(framesToTimecode(timecodeToFrames("01:02:03:04", r), r)).toBe("01:02:03:04");
    expect(framesToTimecode(secondsToFrames(61.5, r), r)).toBe("00:01:01:13");
  });
  it("counts 29.97 at nominal 30", () => {
    const r = frameRate("29.97");
    expect(secondsToFrames(1001 / 30000, r)).toBe(1);
    expect(framesToTimecode(30, r)).toBe("00:00:01:00");
  });
});

describe("parsers", () => {
  it("parses clock formats", () => {
    expect(parseClock("00:01:02,500")).toBe(62.5);
    expect(parseClock("01:02.5")).toBe(62.5);
  });
  it("parses SRT with speaker prefixes", () => {
    const out = parseCues("1\n00:00:01,000 --> 00:00:03,000\nMAYA: Hello there.\n\n2\n00:00:03,500 --> 00:00:05,000\nAnd more.\n");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ start: 1, end: 3, speaker: "MAYA", text: "Hello there." });
    expect(out[1].speaker).toBe("MAYA");
  });
  it("parses VTT voice tags", () => {
    const out = parseCues("WEBVTT\n\n00:00.000 --> 00:02.000 align:start\n<v Sam>Hi <b>all</b></v>\n");
    expect(out[0]).toMatchObject({ speaker: "Sam", text: "Hi all", end: 2 });
  });
  it("parses Whisper JSON", () => {
    const out = parseJson(JSON.stringify({ segments: [{ start: 0, end: 1.5, text: " hi " }] }));
    expect(out[0]).toMatchObject({ start: 0, end: 1.5, text: "hi" });
  });
  it("merges whisper chunks into sentences", () => {
    const out = mergeChunks([
      { start: 0, end: 1, text: " So I" },
      { start: 1, end: 2, text: " quit." },
      { start: 2, end: 3, text: " Then" },
    ]);
    expect(out.map((s) => s.text)).toEqual(["So I quit.", "Then"]);
  });
});

describe("exporters", () => {
  it("merges adjacent source lines in the same section", () => {
    const r = cutToRanges([item("b"), item("c"), item("d")], segs);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ start: 2.1, end: 8 });
    expect(totalDuration(r)).toBeCloseTo(9.9);
  });
  it("does not merge across sections or out of order", () => {
    expect(cutToRanges([item("b"), item("c", "Turn")], segs)).toHaveLength(2);
    expect(cutToRanges([item("c"), item("b")], segs)).toHaveLength(2);
  });
  it("pads without overlapping neighbours", () => {
    const r = cutToRanges([item("b"), item("d")], segs, 0.5, 30);
    expect(r[0]).toMatchObject({ start: 1.6, end: 5.5 });
    expect(r[1]).toMatchObject({ start: 19.5, end: 24.5 });
  });

  const opts = {
    title: "Test",
    mediaName: "A001 clip.mov",
    mediaFolder: "/Volumes/Media",
    mediaDuration: 30,
    width: 1920,
    height: 1080,
    rate: frameRate("25"),
    sourceStartTc: "10:00:00:00",
    padSeconds: 0,
  };

  it("writes a CMX3600 EDL with source TC offset", () => {
    const edl = toEdl(cutToRanges([item("b"), item("d", "End")], segs), opts);
    expect(edl).toContain("FCM: NON-DROP FRAME");
    expect(edl).toMatch(/001 {2}AX {7}AA\/V {2}C {8}10:00:02:03 10:00:05:00 01:00:00:00 01:00:02:22/);
    expect(edl).toContain("002  AX");
    expect(edl).toContain("* COMMENT: END");
  });

  it("writes frame-accurate FCPXML", () => {
    const xml = toFcpxml(cutToRanges([item("b"), item("d")], segs), opts);
    expect(xml).toContain('frameDuration="1/25s"');
    expect(xml).toContain('src="file:///Volumes/Media/A001%20clip.mov"');
    // b: 2.1s -> frame 53, source TC 10h = 900000 frames
    expect(xml).toContain(`start="${900000 + 53}/25s"`);
    expect(xml).toContain('offset="0s"');
    expect(xml).not.toMatch(/NaN|undefined/);
  });

  it("writes a script grouped by section", () => {
    const cut = [item("b"), item("d", "End")];
    const txt = toScript(cutToRanges(cut, segs), segs, cut, "Test");
    expect(txt).toContain("== HOOK ==");
    expect(txt).toContain("MAYA: Later line.");
  });
});

describe("story sanitize", () => {
  it("drops unknown and duplicate ids and empty sections", () => {
    const plan: StoryPlan = {
      title: "t",
      logline: "l",
      sections: [
        { name: "Hook", purpose: "", beats: [{ segmentId: "b", reason: "" }, { segmentId: "zzz", reason: "" }] },
        { name: "Dup", purpose: "", beats: [{ segmentId: "b", reason: "" }] },
      ],
      soundbites: [{ segmentId: "nope", why: "" }, { segmentId: "c", why: "" }],
      editorNotes: "",
    };
    const out = sanitize(plan, segs);
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].beats.map((b) => b.segmentId)).toEqual(["b"]);
    expect(out.soundbites.map((s) => s.segmentId)).toEqual(["c"]);
  });
});

describe("edl safety", () => {
  it("keeps EDL ASCII-only", () => {
    const s: Segment[] = [{ id: "x", start: 0, end: 1, speaker: "A", text: "“Café” — it’s\nfine" }];
    const edl = toEdl(cutToRanges([item("x")], s), {
      title: "Lantern — story", mediaName: "clip.mov", mediaFolder: "", mediaDuration: 1,
      width: 1920, height: 1080, rate: frameRate("25"), sourceStartTc: "00:00:00:00", padSeconds: 0,
    });
    expect(edl).toMatch(/^[\x0a\x20-\x7e]*$/);
    expect(edl).toContain(`"Cafe" - it's fine`);
    expect(edl).toContain("TITLE: LANTERN - STORY");
  });
});
