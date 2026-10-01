import { useEffect, useState } from "react";
import type { Segment, StoryBrief, StoryPlan } from "../lib/types";

const FORMATS = [
  "Interview highlight",
  "Founder / brand story",
  "Wedding speech highlight",
  "Documentary scene",
  "Vlog",
  "Testimonial",
  "Social clip (vertical)",
  "Podcast highlight",
];

interface Props {
  brief: StoryBrief;
  story: StoryPlan | null;
  segById: Map<string, Segment>;
  aiReady: boolean | null;
  busy: boolean;
  onFind: (b: StoryBrief) => void;
  onApply: () => void;
  onSeek: (t: number) => void;
}

export function StoryPanel({ brief, story, segById, aiReady, busy, onFind, onApply, onSeek }: Props) {
  const [draft, setDraft] = useState(brief);
  const [open, setOpen] = useState(!story);
  useEffect(() => setDraft(brief), [brief]);
  useEffect(() => setOpen(!story), [story]);

  const set = <K extends keyof StoryBrief>(k: K, v: StoryBrief[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="pane story">
      <header className="pane-header">
        <h2>Story</h2>
        {story && (
          <button className="ghost small" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide brief" : "Edit brief"}
          </button>
        )}
      </header>

      {open && (
        <form
          className="brief"
          onSubmit={(e) => {
            e.preventDefault();
            onFind(draft);
          }}
        >
          <label>
            Format
            <input list="formats" value={draft.format} onChange={(e) => set("format", e.target.value)} />
            <datalist id="formats">
              {FORMATS.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
          <label>
            Target length (seconds)
            <input
              type="number"
              min={5}
              max={7200}
              value={draft.targetSeconds}
              onChange={(e) => set("targetSeconds", Number(e.target.value) || 60)}
            />
          </label>
          <label className="wide">
            Tone
            <input value={draft.tone} onChange={(e) => set("tone", e.target.value)} />
          </label>
          <label className="wide">
            Notes for the editor
            <textarea
              rows={2}
              placeholder="e.g. End on the school program. Avoid naming investors."
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </label>
          <div className="wide row">
            <button className="primary" type="submit" disabled={busy || aiReady === false}>
              {story ? "Find the story again" : "Find the story"}
            </button>
            {aiReady === false && (
              <span className="muted small">AI is off: start the server with ANTHROPIC_API_KEY set. You can still cut by hand.</span>
            )}
          </div>
        </form>
      )}

      {story && (
        <article className="plan">
          <h3>{story.title}</h3>
          <p className="logline">{story.logline}</p>
          <ol className="sections">
            {story.sections.map((sec) => (
              <li key={sec.name}>
                <div className="section-name">{sec.name}</div>
                <div className="muted small">{sec.purpose}</div>
                <ul>
                  {sec.beats.map((b) => {
                    const s = segById.get(b.segmentId);
                    if (!s) return null;
                    return (
                      <li key={b.segmentId}>
                        <button className="beat" onClick={() => onSeek(s.start)}>
                          “{s.text}”
                        </button>
                        <span className="muted small"> — {b.reason}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
          {story.editorNotes && (
            <details>
              <summary>Editor’s notes</summary>
              <p>{story.editorNotes}</p>
            </details>
          )}
          <button className="ghost small" onClick={onApply}>
            Reset board to this story
          </button>
        </article>
      )}
    </div>
  );
}
