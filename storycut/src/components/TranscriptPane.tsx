import { useEffect, useMemo, useRef, useState } from "react";
import { clock } from "../lib/timecode";
import type { CutItem, Segment, StoryPlan } from "../lib/types";

interface Props {
  segments: Segment[];
  cut: CutItem[];
  story: StoryPlan | null;
  activeId: string | null;
  selection: Set<string>;
  setSelection: (s: Set<string>) => void;
  onSeek: (t: number) => void;
  onAdd: (ids: string[], section: string) => void;
  onRenameSpeaker: (from: string, to: string) => void;
  onEditText: (id: string, text: string) => void;
  canSeek: boolean;
}

export function TranscriptPane(p: Props) {
  const [query, setQuery] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [section, setSection] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const lastClicked = useRef<string | null>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  const inCut = useMemo(() => new Set(p.cut.map((c) => c.segmentId)), [p.cut]);
  const soundbites = useMemo(() => new Map(p.story?.soundbites.map((s) => [s.segmentId, s.why]) ?? []), [p.story]);
  const speakers = useMemo(() => [...new Set(p.segments.map((s) => s.speaker))], [p.segments]);
  const sections = useMemo(() => [...new Set(p.cut.map((c) => c.section))], [p.cut]);

  const visible = p.segments.filter(
    (s) =>
      (!speaker || s.speaker === speaker) &&
      (!query || s.text.toLowerCase().includes(query.toLowerCase())),
  );

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [p.activeId]);

  const toggle = (id: string, shift: boolean) => {
    const next = new Set(p.selection);
    if (shift && lastClicked.current) {
      const ids = visible.map((s) => s.id);
      const [a, b] = [ids.indexOf(lastClicked.current), ids.indexOf(id)].sort((x, y) => x - y);
      if (a >= 0) ids.slice(a, b + 1).forEach((x) => next.add(x));
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    lastClicked.current = id;
    p.setSelection(next);
  };

  const rename = (from: string) => {
    const to = window.prompt(`Rename speaker “${from}” to:`, from)?.trim();
    if (to && to !== from) p.onRenameSpeaker(from, to);
  };

  const add = () => p.onAdd([...p.selection], section.trim() || sections[sections.length - 1] || "Selects");

  return (
    <section className="pane transcript">
      <header className="pane-header">
        <h2>Transcript</h2>
        <span className="muted small">{p.segments.length} lines</span>
      </header>
      <div className="filters">
        <input type="search" placeholder="Search words…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={speaker} onChange={(e) => setSpeaker(e.target.value)} aria-label="Filter speaker">
          <option value="">All speakers</option>
          {speakers.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>

      <ul className="lines">
        {visible.map((s) => {
          const why = soundbites.get(s.id);
          return (
            <li
              key={s.id}
              ref={s.id === p.activeId ? activeRef : undefined}
              className={[
                "line",
                p.selection.has(s.id) && "selected",
                inCut.has(s.id) && "used",
                s.id === p.activeId && "active",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <input
                type="checkbox"
                checked={p.selection.has(s.id)}
                onChange={() => {}}
                onClick={(e) => toggle(s.id, e.shiftKey)}
                aria-label="Select line"
              />
              <div className="line-body">
                <div className="line-meta">
                  <button className="tc" disabled={!p.canSeek} onClick={() => p.onSeek(s.start)} title="Play from here">
                    {clock(s.start)}
                  </button>
                  <button className="speaker" onClick={() => rename(s.speaker)} title="Rename speaker">
                    {s.speaker}
                  </button>
                  {why && (
                    <span className="badge star" title={why}>
                      ★ soundbite
                    </span>
                  )}
                  {inCut.has(s.id) && <span className="badge">in cut</span>}
                </div>
                {editing === s.id ? (
                  <textarea
                    autoFocus
                    defaultValue={s.text}
                    onBlur={(e) => {
                      p.onEditText(s.id, e.target.value.trim() || s.text);
                      setEditing(null);
                    }}
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                  />
                ) : (
                  <p onDoubleClick={() => setEditing(s.id)} title="Double-click to correct">
                    {s.text}
                  </p>
                )}
              </div>
            </li>
          );
        })}
        {!visible.length && <li className="muted pad">Nothing matches.</li>}
      </ul>

      {p.selection.size > 0 && (
        <footer className="selection-bar">
          <span>{p.selection.size} selected</span>
          <input
            list="sections"
            placeholder={sections[sections.length - 1] || "Section"}
            value={section}
            onChange={(e) => setSection(e.target.value)}
            aria-label="Section"
          />
          <datalist id="sections">
            {sections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button className="primary" onClick={add}>
            Add to cut
          </button>
          <button className="ghost" onClick={() => p.setSelection(new Set())}>
            Clear
          </button>
        </footer>
      )}
    </section>
  );
}
