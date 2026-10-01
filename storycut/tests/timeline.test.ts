// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { sanitizeScript, scriptPrompt } from "../server/script";
import {
  applyAssignments,
  assemble,
  buildScriptRequest,
  emptyScriptProject,
  toCsv,
  toFountain,
  toSrt,
  type ScriptProject,
} from "../src/lib/script";
import { parseEdl, parseFcpxml, parseTimelineFile, parseXmeml, rationalTime, transcribableClips } from "../src/lib/timeline";
import { isSilent, sliceAudio } from "../src/lib/transcribe";

// Shaped like a DaVinci Resolve 19 FCPXML 1.10 export (timeline starts at 01:00:00:00).
const RESOLVE_FCPXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat1080p24" frameDuration="1/24s" width="1920" height="1080"/>
    <asset id="r2" name="hf_scene01_kai.mp4" start="0/1s" hasVideo="1" hasAudio="1" duration="120/24s" format="r1">
      <media-rep kind="original-media" src="file:///Users/me/Higgsfield/hf_scene01_kai.mp4"/>
    </asset>
    <asset id="r3" name="hf scene02 mara.mp4" start="0/1s" hasVideo="1" hasAudio="1" duration="240/24s" format="r1">
      <media-rep kind="original-media" src="file:///Users/me/Higgsfield/hf%20scene02%20mara.mp4"/>
    </asset>
    <asset id="r4" name="vo_kai.wav" start="0/1s" hasAudio="1" duration="96/24s">
      <media-rep kind="original-media" src="file:///Users/me/VO/vo_kai.wav"/>
    </asset>
    <asset id="r5" name="cam_A001.mov" start="86400/24s" hasVideo="1" hasAudio="1" duration="480/24s" format="r1" src="file:///Volumes/A/cam_A001.mov"/>
  </resources>
  <library>
    <event name="Ep 1">
      <project name="Episode 1">
        <sequence format="r1" duration="600/24s" tcStart="86400/24s" tcFormat="NDF">
          <spine>
            <asset-clip name="hf_scene01_kai.mp4" ref="r2" offset="86400/24s" start="0/1s" duration="120/24s" format="r1"/>
            <asset-clip name="Mara close" ref="r3" offset="86520/24s" start="24/24s" duration="96/24s" format="r1">
              <asset-clip name="vo_kai.wav" ref="r4" lane="-1" offset="48/24s" start="0/1s" duration="48/24s"/>
            </asset-clip>
            <gap name="Gap" offset="86616/24s" start="86400/24s" duration="48/24s">
              <asset-clip name="cam" ref="r5" lane="1" offset="86412/24s" start="86424/24s" duration="24/24s"/>
            </gap>
            <transition name="Cross Dissolve" offset="86650/24s" duration="12/24s"/>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;

describe("Resolve FCPXML", () => {
  it("parses rational times", () => {
    expect(rationalTime("86400/24s")).toBe(3600);
    expect(rationalTime("0s")).toBe(0);
    expect(rationalTime("1001/30000s")).toBeCloseTo(0.0333667);
  });

  it("reads spine, connected and gap clips with timeline-relative record times", () => {
    const [t] = parseFcpxml(RESOLVE_FCPXML, "ep1.fcpxml");
    expect(t.name).toBe("Episode 1");
    const by = Object.fromEntries(t.clips.map((c) => [c.file, c]));
    expect(by["hf_scene01_kai.mp4"]).toMatchObject({ recIn: 0, recOut: 5, srcIn: 0, srcOut: 5, kind: "video" });
    expect(by["hf scene02 mara.mp4"]).toMatchObject({ name: "Mara close", recIn: 5, recOut: 9, srcIn: 1, srcOut: 5 });
    // connected audio at parent local 2s, parent start 1s -> 1s after the parent's record in
    expect(by["vo_kai.wav"]).toMatchObject({ recIn: 6, recOut: 8, kind: "audio" });
    // gap child: asset timecode starts at 01:00:00:00, so source in is 1s into the file
    expect(by["cam_A001.mov"]).toMatchObject({ recIn: 9.5, srcIn: 1, srcOut: 2 });
    expect(t.clips.map((c) => c.recIn)).toEqual([...t.clips.map((c) => c.recIn)].sort((a, b) => a - b));
  });

  it("detects format by content", () => {
    expect(parseTimelineFile("x.xml", RESOLVE_FCPXML)[0].clips).toHaveLength(4);
    expect(() => parseTimelineFile("x.txt", "hello")).toThrow(/FCPXML/);
  });
});

describe("FCP7 XML and EDL", () => {
  it("parses xmeml clipitems with shared file ids", () => {
    const xml = `<?xml version="1.0"?><xmeml version="5"><sequence><name>Ep 2</name><rate><timebase>24</timebase><ntsc>FALSE</ntsc></rate>
      <media><video><track>
        <clipitem><name>A</name><start>0</start><end>48</end><in>24</in><out>72</out><file id="f1"><name>a.mp4</name><pathurl>file:///x/a.mp4</pathurl></file></clipitem>
        <clipitem><name>A again</name><start>48</start><end>72</end><in>0</in><out>24</out><file id="f1"/></clipitem>
        <clipitem><name>skip</name><start>-1</start><end>10</end><in>0</in><out>5</out><file id="f1"/></clipitem>
      </track></video></media></sequence></xmeml>`;
    const [t] = parseXmeml(xml);
    expect(t.name).toBe("Ep 2");
    expect(t.clips).toHaveLength(2);
    expect(t.clips[1]).toMatchObject({ name: "A again", file: "a.mp4", recIn: 2, recOut: 3, srcIn: 0, srcOut: 1 });
  });

  it("parses Resolve EDL with clip names", () => {
    const edl = `TITLE: Episode 3
FCM: NON-DROP FRAME

001  AX       V     C        00:00:00:00 00:00:05:00 01:00:00:00 01:00:05:00
* FROM CLIP NAME: hf_a.mp4

002  AX       V     C        00:00:01:12 00:00:03:00 01:00:05:00 01:00:06:12
* FROM CLIP NAME: hf_b.mp4
`;
    const [t] = parseEdl(edl, 24);
    expect(t.name).toBe("Episode 3");
    expect(t.clips[1]).toMatchObject({ file: "hf_b.mp4", srcIn: 1.5, srcOut: 3, recIn: 5, recOut: 6.5 });
  });

  it("collapses linked video+audio of the same take", () => {
    const [t] = parseFcpxml(RESOLVE_FCPXML);
    const dup = { ...t.clips[0], id: "dupe", kind: "audio" as const };
    expect(transcribableClips({ ...t, clips: [...t.clips, dup] })).toHaveLength(4);
  });
});

describe("audio helpers", () => {
  it("slices and detects silence", () => {
    const pcm = new Float32Array(16000 * 2);
    expect(isSilent(pcm)).toBe(true);
    for (let i = 16000; i < 17600; i++) pcm[i] = Math.sin(i / 5) * 0.2;
    expect(isSilent(pcm)).toBe(false);
    expect(isSilent(sliceAudio(pcm, 0, 0.9))).toBe(true);
    expect(sliceAudio(pcm, 1, 5)).toHaveLength(16000);
  });
});

function sampleProject(): ScriptProject {
  const [t] = parseFcpxml(RESOLVE_FCPXML);
  const [kai, mara] = t.clips;
  return {
    ...emptyScriptProject(),
    title: "Episode 1",
    timelines: [t],
    references: [{ id: "r", name: "prompts.md", text: "KAI: a pilot. MARA: an engineer." }],
    lines: [
      { id: "l1", clipId: kai.id, timeline: t.name, start: 0.5, end: 2, text: "We're out of fuel.", character: "", parenthetical: "" },
      { id: "l2", clipId: mara.id, timeline: t.name, start: 5.2, end: 7, text: "Then we glide, Kai.", character: "", parenthetical: "" },
    ],
    plan: {
      title: "Glide",
      logline: "",
      characters: [{ name: "Kai", description: "pilot" }],
      scenes: [{ firstClipId: kai.id, heading: "int. cockpit - night", action: "Alarms blink." }],
      notes: "",
    },
  };
}

describe("script", () => {
  it("builds a request with lines grouped under clips", () => {
    const req = buildScriptRequest(sampleProject());
    expect(req.timelines[0].clips[1].lines.map((l) => l.id)).toEqual(["l2"]);
    const prompt = scriptPrompt(req);
    expect(prompt).toContain('<reference name="prompts.md">');
    expect(prompt).toContain("[l1] We're out of fuel.");
    expect(prompt).toContain("(no dialogue)");
  });

  it("drops unknown ids from Claude's answer", () => {
    const p = sampleProject();
    const req = buildScriptRequest(p);
    const out = sanitizeScript(
      {
        title: "t",
        logline: "",
        characters: [],
        notes: "",
        scenes: [{ firstClipId: "nope", heading: "x", action: "" }, { firstClipId: req.timelines[0].clips[0].id, heading: "y", action: "" }],
        lines: [{ id: "l1", character: "Kai", parenthetical: "", text: "x" }, { id: "l1", character: "Mara", parenthetical: "", text: "" }, { id: "zz", character: "", parenthetical: "", text: "" }],
      },
      req,
    );
    expect(out.lines.map((l) => l.character)).toEqual(["Kai"]);
    expect(out.scenes.map((s) => s.heading)).toEqual(["y"]);
  });

  it("applies assignments and writes Fountain, SRT and CSV", () => {
    const p = sampleProject();
    p.lines = applyAssignments(p.lines, [
      { id: "l1", character: "Kai", parenthetical: "", text: "We're out of fuel." },
      { id: "l2", character: "Mara", parenthetical: "(calm)", text: "" },
    ]);
    expect(p.lines[1].text).toBe("Then we glide, Kai.");
    expect(assemble(p).filter((b) => b.kind === "scene")).toHaveLength(1);

    const f = toFountain(p);
    expect(f).toContain("Title: Glide");
    expect(f).toContain("# Episode 1");
    expect(f).toContain("INT. COCKPIT - NIGHT\n\nAlarms blink.");
    expect(f).toContain("KAI\nWe're out of fuel.");
    expect(f).toContain("MARA\n(calm)\nThen we glide, Kai.");

    expect(toSrt(p, "Episode 1")).toBe(
      "1\n00:00:00,500 --> 00:00:02,000\nKAI: We're out of fuel.\n\n2\n00:00:05,200 --> 00:00:07,000\nMARA: Then we glide, Kai.\n",
    );
    expect(toCsv(p).split("\n")[2]).toContain('Mara close,hf scene02 mara.mp4,Mara,calm,"Then we glide, Kai."');
  });
});
