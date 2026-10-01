import { useState } from "react";
import { cutToRanges, download, toEdl, toFcpxml, toScript, totalDuration } from "../lib/exporters";
import { clock, frameRate } from "../lib/timecode";
import { FRAME_RATES, type Project } from "../lib/types";
import { Modal } from "./Modal";

interface Props {
  project: Project;
  onChange: (p: Partial<Project>) => void;
  onClose: () => void;
}

export function ExportDialog({ project, onChange, onClose }: Props) {
  const [sourceTc, setSourceTc] = useState("00:00:00:00");
  const [folder, setFolder] = useState("");
  const [pad, setPad] = useState(0.2);
  const [error, setError] = useState<string | null>(null);

  const ranges = cutToRanges(project.cut, project.segments, pad, project.mediaDuration || Infinity);
  const base = project.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "storycut";
  const opts = () => ({
    title: project.name,
    mediaName: project.mediaName || "media.mov",
    mediaFolder: folder,
    mediaDuration: project.mediaDuration,
    width: project.width,
    height: project.height,
    rate: frameRate(project.fpsLabel),
    sourceStartTc: sourceTc,
    padSeconds: pad,
  });

  const run = (fn: () => void) => {
    setError(null);
    try {
      fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal title="Export to your editor" onClose={onClose}>
      <p className="muted">
        {ranges.length} edits · {clock(totalDuration(ranges))} · source “{project.mediaName || "unnamed"}”. The timeline points at your
        original media, nothing is rendered.
      </p>
      <div className="form-grid">
        <label>
          Frame rate
          <select value={project.fpsLabel} onChange={(e) => onChange({ fpsLabel: e.target.value })}>
            {FRAME_RATES.map((r) => (
              <option key={r.label}>{r.label}</option>
            ))}
          </select>
        </label>
        <label>
          Source start timecode
          <input value={sourceTc} onChange={(e) => setSourceTc(e.target.value)} pattern="\d\d:\d\d:\d\d:\d\d" />
        </label>
        <label>
          Handles (seconds)
          <input type="number" step={0.05} min={0} max={2} value={pad} onChange={(e) => setPad(Number(e.target.value) || 0)} />
        </label>
        <label>
          Resolution
          <span className="row">
            <input type="number" value={project.width} onChange={(e) => onChange({ width: Number(e.target.value) || 1920 })} aria-label="Width" />
            ×
            <input type="number" value={project.height} onChange={(e) => onChange({ height: Number(e.target.value) || 1080 })} aria-label="Height" />
          </span>
        </label>
        <label className="wide">
          Media folder on disk (optional, FCPXML links media automatically)
          <input placeholder="/Volumes/Footage/Lantern/A001" value={folder} onChange={(e) => setFolder(e.target.value)} />
        </label>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="export-buttons">
        <button className="primary" onClick={() => run(() => download(`${base}.fcpxml`, toFcpxml(ranges, opts()), "application/xml"))}>
          FCPXML
          <small>Final Cut Pro · DaVinci Resolve</small>
        </button>
        <button className="primary" onClick={() => run(() => download(`${base}.edl`, toEdl(ranges, opts())))}>
          EDL (CMX3600)
          <small>Premiere Pro · Resolve · Avid</small>
        </button>
        <button onClick={() => run(() => download(`${base}_script.txt`, toScript(ranges, project.segments, project.cut, project.name)))}>
          Script
          <small>Paper edit for review</small>
        </button>
      </div>
    </Modal>
  );
}
