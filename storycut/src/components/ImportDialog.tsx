import { useState } from "react";
import type { Busy } from "../App";
import { demoSegments } from "../lib/demo";
import { parseTranscriptFile } from "../lib/parsers";
import { transcribe, whisperError, WHISPER_MODELS } from "../lib/transcribe";
import type { Segment } from "../lib/types";
import { Modal } from "./Modal";

interface Props {
  mediaFile: File | null;
  onMedia: (f: File) => void;
  onSegments: (s: Segment[]) => void;
  onDemo: (s: Segment[]) => void;
  onClose: () => void;
  setBusy: (b: Busy | null) => void;
  setError: (e: string | null) => void;
}

export function ImportDialog({ mediaFile, onMedia, onSegments, onDemo, onClose, setBusy, setError }: Props) {
  const [model, setModel] = useState(WHISPER_MODELS[1].id);
  const [language, setLanguage] = useState("english");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Busy | null>(null);

  const report = (b: Busy | null) => {
    setStatus(b);
    setBusy(b);
  };

  const runWhisper = async () => {
    if (!mediaFile) return;
    setError(null);
    setRunning(true);
    try {
      const segs = await transcribe(mediaFile, model, language, (message, progress) => report({ message, progress }));
      if (!segs.length) throw new Error("No speech found in this file.");
      onSegments(segs);
    } catch (e) {
      setError(whisperError(e));
    } finally {
      report(null);
      setRunning(false);
    }
  };

  const importFile = async (file: File) => {
    setError(null);
    try {
      onSegments(parseTranscriptFile(file.name, await file.text()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const multilingual = !model.endsWith(".en");

  return (
    <Modal title="Import" onClose={running ? undefined : onClose}>
      <ol className="steps">
        <li>
          <h3>Media</h3>
          <p className="muted">Video or audio of the interview. It stays on this computer.</p>
          <label className="button">
            {mediaFile ? "Change media" : "Choose media"}
            <input type="file" accept="video/*,audio/*,.mov,.mxf" hidden onChange={(e) => e.target.files?.[0] && onMedia(e.target.files[0])} />
          </label>
          {mediaFile && <span className="file-chip">{mediaFile.name}</span>}
        </li>

        <li>
          <h3>Transcript</h3>
          <div className="option">
            <div>
              <strong>Transcribe on this computer</strong>
              <p className="muted">Whisper runs in your browser. The model downloads once (40–250 MB) and is cached.</p>
              <div className="row">
                <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Whisper model">
                  {WHISPER_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {multilingual && (
                  <input value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language" placeholder="language" />
                )}
                <button className="primary" disabled={!mediaFile || running} onClick={runWhisper}>
                  {running ? "Transcribing…" : "Transcribe"}
                </button>
              </div>
              {status && (
                <p className="muted small">
                  {status.message} {status.progress != null && `${Math.round(status.progress)}%`}
                </p>
              )}
            </div>
          </div>
          <div className="option">
            <div>
              <strong>Or import a transcript</strong>
              <p className="muted">
                SRT or VTT from Resolve, Premiere or Descript, or JSON with start/end/text. Speaker names written as
                “NAME: text” are kept.
              </p>
              <label className="button">
                Choose transcript
                <input type="file" accept=".srt,.vtt,.json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
              </label>
            </div>
          </div>
        </li>
      </ol>
      <footer className="modal-footer">
        <button className="ghost" disabled={running} onClick={() => onDemo(demoSegments())}>
          Try the demo interview
        </button>
      </footer>
    </Modal>
  );
}
