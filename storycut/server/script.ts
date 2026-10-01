import type { ScriptRequest, ScriptResponse } from "../src/lib/script.ts";
import { getClient, MODEL, StoryError } from "./story.ts";

const SYSTEM = `You are a script supervisor. You receive transcripts of the clips on one or more editing timelines, plus reference material the filmmaker wrote while making the clips: character descriptions, scene and shot prompts written for Claude, GPT or Higgsfield, treatments and draft dialogue.

Your job is to turn the transcripts into a clean script:
- Assign every transcript line to the character who speaks it. Use the reference material: character names and descriptions, which prompt produced which clip (match on clip/file names, scene descriptions and dialogue wording), who is in each scene, and conversational turn-taking. A clip generated from one prompt usually features the characters that prompt describes.
- Use the character names exactly as the references spell them. If a speaker is truly unidentifiable, use "UNKNOWN" rather than guessing; a narrator or voice-over is "NARRATOR" unless the references name it.
- Keep each line's text to what was actually said. You may fix words the transcription clearly misheard (names, invented words from the references, obvious homophones) and fix punctuation; do not rewrite, add or remove dialogue.
- Parenthetical: a short delivery note only when the references or context make it clear (e.g. "whispering", "V.O.", "to Mara"); otherwise empty.
- Scenes: start a new scene where the location, time or situation changes, typically at the first clip of a new prompt/setting. Give each scene a screenplay heading (INT./EXT. PLACE - TIME) and one or two lines of present-tense action drawn from the references. Every timeline's first clip starts a scene.
- characters: everyone who speaks, with a one-line description from the references.
- notes: lines you were unsure about and why, clips whose dialogue seems missing or doesn't match the references.
Return every line id you were given exactly once.`;

const str = { type: "string" } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const schema = obj({
  title: str,
  logline: str,
  characters: { type: "array", items: obj({ name: str, description: str }) },
  scenes: { type: "array", items: obj({ firstClipId: str, heading: str, action: str }) },
  lines: { type: "array", items: obj({ id: str, character: str, parenthetical: str, text: str }) },
  notes: str,
});

const clock = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

export function scriptPrompt(req: ScriptRequest): string {
  const refs = req.references.length
    ? req.references.map((r) => `<reference name="${r.name}">\n${r.text}\n</reference>`).join("\n\n")
    : "(no reference material provided)";
  const timelines = req.timelines
    .map((t) => {
      const clips = t.clips
        .map((c) => {
          const head = `[clip ${c.id}] at ${clock(c.recIn)}–${clock(c.recOut)} name="${c.name}" file="${c.file}"`;
          const lines = c.lines.length ? c.lines.map((l) => `  [${l.id}] ${l.text}`).join("\n") : "  (no dialogue)";
          return `${head}\n${lines}`;
        })
        .join("\n");
      return `<timeline name="${t.name}">\n${clips}\n</timeline>`;
    })
    .join("\n\n");
  return `<references>\n${refs}\n</references>\n\n<timelines>\n${timelines}\n</timelines>\n\nFilmmaker's notes: ${req.notes || "(none)"}\n\nWrite the script.`;
}

export async function writeScript(req: ScriptRequest): Promise<ScriptResponse> {
  let message;
  try {
    message = await getClient()
      .beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        output_config: { effort: "high", format: { type: "json_schema", schema } },
        messages: [{ role: "user", content: scriptPrompt(req) }],
      })
      .finalMessage();
  } catch (err) {
    throw StoryError.from(err);
  }
  if (message.stop_reason === "refusal") throw new StoryError("Claude declined to write this script.", 422);
  if (message.stop_reason === "max_tokens") throw new StoryError("The script was too long for one pass. Try fewer timelines at once.", 502);

  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let out: ScriptResponse;
  try {
    out = JSON.parse(text) as ScriptResponse;
  } catch {
    throw new StoryError("Claude returned an unreadable script. Try again.", 502);
  }
  return sanitizeScript(out, req);
}

/** Keeps only ids that exist in the request; one assignment per line, one scene per clip. */
export function sanitizeScript(out: ScriptResponse, req: ScriptRequest): ScriptResponse {
  const lineIds = new Set(req.timelines.flatMap((t) => t.clips.flatMap((c) => c.lines.map((l) => l.id))));
  const clipIds = new Set(req.timelines.flatMap((t) => t.clips.map((c) => c.id)));
  const seenLines = new Set<string>();
  const seenScenes = new Set<string>();
  return {
    ...out,
    lines: out.lines.filter((l) => lineIds.has(l.id) && !seenLines.has(l.id) && seenLines.add(l.id)),
    scenes: out.scenes.filter((s) => clipIds.has(s.firstClipId) && !seenScenes.has(s.firstClipId) && seenScenes.add(s.firstClipId)),
  };
}
