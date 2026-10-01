import Anthropic from "@anthropic-ai/sdk";
import type { Segment, StoryBrief, StoryPlan } from "../src/lib/types.ts";

const MODEL = process.env.STORYCUT_MODEL || "claude-opus-5-5";

const SYSTEM = `You are a senior documentary and branded-content editor. You build paper edits: you read a transcript and choose which lines to use, in what order, so the finished piece tells a clear, emotionally true story.

How you work:
- Find the spine first: who is this about, what do they want or believe, what changed, why should a viewer care.
- Structure the cut in sections (for example Hook, Setup, Turn, Payoff, Button). Name sections for this story; don't force a template.
- Open with the strongest, most specific line you have, not a greeting or throat-clearing.
- Prefer complete thoughts that stand alone without the interviewer's question. Skip interviewer lines unless the answer is meaningless without them.
- You may reorder lines freely for story, but never change meaning or splice lines to imply something the speaker did not say.
- Land within about 15% of the target runtime. Each line's duration is given; add them up.
- Use each line at most once. Use only the line ids provided.
- Soundbites: the 3-8 lines that would work as pull quotes, social clips or a trailer, whether or not they are in the cut.
- Reasons are short editor's notes (under 20 words) saying what the line does for the story.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "logline", "sections", "soundbites", "editorNotes"],
  properties: {
    title: { type: "string", description: "Working title for the piece" },
    logline: { type: "string", description: "One sentence: what this story is about" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "purpose", "beats"],
        properties: {
          name: { type: "string" },
          purpose: { type: "string" },
          beats: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["segmentId", "reason"],
              properties: { segmentId: { type: "string" }, reason: { type: "string" } },
            },
          },
        },
      },
    },
    soundbites: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["segmentId", "why"],
        properties: { segmentId: { type: "string" }, why: { type: "string" } },
      },
    },
    editorNotes: {
      type: "string",
      description: "What was left out and why, gaps worth a pickup, alternate openings",
    },
  },
} as const;

function transcriptBlock(segments: Segment[]): string {
  return segments
    .map((s) => `[${s.id}] ${s.start.toFixed(1)}s (${(s.end - s.start).toFixed(1)}s) ${s.speaker}: ${s.text}`)
    .join("\n");
}

export class StoryError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

export async function findStory(segments: Segment[], brief: StoryBrief): Promise<StoryPlan> {
  const user = `<brief>
Format: ${brief.format}
Target runtime: ${brief.targetSeconds} seconds
Tone: ${brief.tone}
Notes from the editor: ${brief.notes || "(none)"}
</brief>

<transcript>
Each line: [id] start (duration) speaker: text
${transcriptBlock(segments)}
</transcript>

Build the paper edit.`;

  let message;
  try {
    message = await getClient()
      .beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        output_config: { effort: "high", format: { type: "json_schema", schema } },
        messages: [{ role: "user", content: user }],
      })
      .finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new StoryError("The server's Anthropic API key is missing or invalid. Set ANTHROPIC_API_KEY.", 503);
    }
    if (err instanceof Anthropic.RateLimitError) throw new StoryError("Rate limited by the Claude API. Try again shortly.", 429);
    if (err instanceof Anthropic.APIError) throw new StoryError(`Claude API error: ${err.message}`, 502);
    if (err instanceof Error && /api key|apiKey|authToken/i.test(err.message)) {
      throw new StoryError("No Anthropic API key configured on the server. Set ANTHROPIC_API_KEY.", 503);
    }
    throw err;
  }

  if (message.stop_reason === "refusal") throw new StoryError("Claude declined to edit this transcript.", 422);
  if (message.stop_reason === "max_tokens") throw new StoryError("The response was cut off. Try a shorter transcript.", 502);

  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let plan: StoryPlan;
  try {
    plan = JSON.parse(text) as StoryPlan;
  } catch {
    throw new StoryError("Claude returned an unreadable story plan. Try again.", 502);
  }
  return sanitize(plan, segments);
}

/** Drops ids Claude invented or repeated, and empty sections. */
export function sanitize(plan: StoryPlan, segments: Segment[]): StoryPlan {
  const known = new Set(segments.map((s) => s.id));
  const used = new Set<string>();
  const sections = plan.sections
    .map((sec) => ({
      ...sec,
      beats: sec.beats.filter((b) => {
        if (!known.has(b.segmentId) || used.has(b.segmentId)) return false;
        used.add(b.segmentId);
        return true;
      }),
    }))
    .filter((sec) => sec.beats.length > 0);
  const soundbites = plan.soundbites.filter((s) => known.has(s.segmentId));
  return { ...plan, sections, soundbites };
}
