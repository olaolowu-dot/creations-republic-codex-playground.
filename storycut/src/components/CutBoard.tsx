import { useState } from "react";
import { clock } from "../lib/timecode";
import type { CutItem, Segment } from "../lib/types";

interface Props {
  cut: CutItem[];
  segById: Map<string, Segment>;
  runtime: number;
  target: number;
  activeUid: string | null;
  playing: boolean;
  canPlay: boolean;
  onPlay: () => void;
  onSeek: (t: number) => void;
  onChange: (cut: CutItem[]) => void;
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to > from ? to - 1 : to, 0, item);
  return next;
}

export function CutBoard({ cut, segById, runtime, target, activeUid, playing, canPlay, onPlay, onSeek, onChange }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const ratio = target ? runtime / target : 0;
  const status = ratio > 1.15 ? "over" : ratio < 0.85 ? "under" : "on";

  const renameSection = (from: string) => {
    const to = window.prompt("Rename section:", from)?.trim();
    if (to && to !== from) onChange(cut.map((c) => (c.section === from ? { ...c, section: to } : c)));
  };

  const drop = (index: number) => {
    if (dragFrom != null && dragFrom !== index && dragFrom + 1 !== index) {
      const next = move(cut, dragFrom, index);
      // A line takes the section of the line it was dropped above (or the last section at the end).
      const landed = index > dragFrom ? index - 1 : index;
      const section = (next[landed + 1] ?? next[landed - 1])?.section;
      if (section) next[landed] = { ...next[landed], section };
      onChange(next);
    }
    setDragFrom(null);
    setDropAt(null);
  };

  return (
    <section className="pane board">
      <header className="pane-header">
        <h2>Paper edit</h2>
        <button className="primary small" disabled={!canPlay || !cut.length} onClick={onPlay}>
          {playing ? "■ Stop" : "▶ Play cut"}
        </button>
      </header>

      <div className={`runtime ${status}`} title="Runtime vs target">
        <div className="runtime-bar">
          <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
        <span>
          {clock(runtime)} / {clock(target)}
        </span>
      </div>

      {!cut.length ? (
        <p className="muted pad">
          Run “Find the story”, or select lines in the transcript and add them here. Drag to reorder.
        </p>
      ) : (
        <ol className="cut" onDragLeave={() => setDropAt(null)}>
          {cut.map((item, i) => {
            const seg = segById.get(item.segmentId);
            const newSection = i === 0 || cut[i - 1].section !== item.section;
            return (
              <li key={item.uid} className="cut-row">
                {newSection && (
                  <button className="section-header" onClick={() => renameSection(item.section)} title="Rename section">
                    {item.section}
                  </button>
                )}
                <div
                  className={`cut-item ${item.uid === activeUid ? "active" : ""} ${dropAt === i ? "drop-before" : ""} ${dragFrom === i ? "dragging" : ""}`}
                  draggable
                  onDragStart={(e) => {
                    setDragFrom(i);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setDropAt(e.clientY > rect.top + rect.height / 2 ? i + 1 : i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(dropAt ?? i);
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDropAt(null);
                  }}
                >
                  <span className="grip" aria-hidden>
                    ⋮⋮
                  </span>
                  <div className="cut-body">
                    {seg ? (
                      <>
                        <div className="line-meta">
                          <button className="tc" disabled={!canPlay} onClick={() => onSeek(seg.start)}>
                            {clock(seg.start)}
                          </button>
                          <span className="speaker-static">{seg.speaker}</span>
                          <span className="muted small">{(seg.end - seg.start).toFixed(1)}s</span>
                        </div>
                        <p>{seg.text}</p>
                        {item.note && <p className="note">{item.note}</p>}
                      </>
                    ) : (
                      <p className="muted">Missing line</p>
                    )}
                  </div>
                  <div className="cut-actions">
                    <button className="ghost small" disabled={i === 0} onClick={() => onChange(move(cut, i, i - 1))} aria-label="Move up">
                      ↑
                    </button>
                    <button
                      className="ghost small"
                      disabled={i === cut.length - 1}
                      onClick={() => onChange(move(cut, i, i + 2))}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button className="ghost small" onClick={() => onChange(cut.filter((c) => c.uid !== item.uid))} aria-label="Remove">
                      ✕
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
          <li
            className={`cut-end ${dropAt === cut.length ? "drop-before" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDropAt(cut.length);
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(cut.length);
            }}
          />
        </ol>
      )}
    </section>
  );
}
