import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { findStory, StoryError } from "./story.ts";

const app = express();
app.use(express.json({ limit: "20mb" }));

const StoryRequest = z.object({
  segments: z
    .array(
      z.object({
        id: z.string().max(64),
        start: z.number(),
        end: z.number(),
        speaker: z.string().max(80),
        text: z.string().max(4000),
      }),
    )
    .min(1)
    .max(20000),
  brief: z.object({
    format: z.string().max(200),
    targetSeconds: z.number().min(5).max(7200),
    tone: z.string().max(300),
    notes: z.string().max(4000),
  }),
});

app.get("/api/health", (_req, res) => {
  res.json({ ai: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
});

app.post("/api/story", async (req, res) => {
  const parsed = StoryRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: " + parsed.error.issues[0]?.message });
    return;
  }
  try {
    const plan = await findStory(parsed.data.segments, parsed.data.brief);
    res.json(plan);
  } catch (err) {
    const status = err instanceof StoryError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[story]", message);
    res.status(status).json({ error: message });
  }
});

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`Storycut API on http://localhost:${port}`));
