import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CutBoard } from "./components/CutBoard";
import { ExportDialog } from "./components/ExportDialog";
import { ImportDialog } from "./components/ImportDialog";
import { ScriptMode } from "./components/ScriptMode";
import { StoryPanel } from "./components/StoryPanel";
import { TranscriptPane } from "./components/TranscriptPane";
import { cutToRanges, totalDuration, type Range } from "./lib/exporters";
import { loadProject, saveProject, storyToCut } from "./lib/storage";
import type { CutItem, Project, Segment, StoryBrief, StoryPlan } from "./lib/types";
import { emptyProject } from "./lib/types";

export interface Busy {
  message: string;
  progress?: number;
}

type Mode = "story" | "script";
const MODE_KEY = "storycut:mode";

export default function App() {
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === "script" ? "script" : "story";
    } catch {
      return "story";
    }
  });
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // ignore
    }
  };
  const [project, setProject] = useState<Project>(loadProject);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(true);
  const [time, setTime] = useState(0);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<"import" | "export" | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState<{ ranges: Range[]; index: number } | null>(null);
  const mediaRef = useRef<HTMLVideoElement>(null);
  const playRef = useRef(playing);
  playRef.current = playing;

  useEffect(() => saveProject(project), [project]);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { ai: boolean }) => setAiReady(d.ai))
      .catch(() => setAiReady(false));
  }, []);
  useEffect(() => () => void (mediaUrl && URL.revokeObjectURL(mediaUrl)), [mediaUrl]);

  const update = useCallback((patch: Partial<Project> | ((p: Project) => Partial<Project>)) => {
    setProject((p) => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) }));
  }, []);

  const segById = useMemo(() => new Map(project.segments.map((s) => [s.id, s])), [project.segments]);
  const ranges = useMemo(() => cutToRanges(project.cut, project.segments), [project.cut, project.segments]);
  const runtime = totalDuration(ranges);

  const activeSegment = useMemo(
    () => project.segments.find((s) => time >= s.start && time < s.end)?.id ?? null,
    [project.segments, time],
  );
  const activeCutUid = useMemo(() => {
    if (!playing) return null;
    const r = playing.ranges[playing.index];
    return (
      project.cut.find((c) => {
        const s = segById.get(c.segmentId);
        return s && s.start >= r.start - 0.01 && s.end <= r.end + 0.01 && time >= s.start && time < s.end;
      })?.uid ?? null
    );
  }, [playing, project.cut, segById, time]);

  // ---- media -------------------------------------------------------------

  const onMedia = (file: File) => {
    setMediaFile(file);
    setMediaUrl(URL.createObjectURL(file));
    setIsVideo(file.type.startsWith("video") || /\.(mov|mp4|m4v|mxf|webm|mkv)$/i.test(file.name));
    update({ mediaName: file.name });
  };

  const onLoadedMetadata = () => {
    const el = mediaRef.current;
    if (!el) return;
    update({
      mediaDuration: el.duration || 0,
      ...(el.videoWidth ? { width: el.videoWidth, height: el.videoHeight } : {}),
    });
  };

  const seek = (seconds: number, play = true) => {
    setPlaying(null);
    const el = mediaRef.current;
    if (!el || !mediaUrl) return;
    el.currentTime = seconds;
    if (play) void el.play();
  };

  const playCut = () => {
    const el = mediaRef.current;
    if (!el || !ranges.length) return;
    if (playing) {
      el.pause();
      setPlaying(null);
      return;
    }
    setPlaying({ ranges, index: 0 });
    el.currentTime = ranges[0].start;
    void el.play();
  };

  const onTimeUpdate = () => {
    const el = mediaRef.current;
    if (!el) return;
    setTime(el.currentTime);
    const p = playRef.current;
    if (!p) return;
    const r = p.ranges[p.index];
    if (el.currentTime >= r.end) {
      const next = p.index + 1;
      if (next >= p.ranges.length) {
        el.pause();
        setPlaying(null);
      } else {
        el.currentTime = p.ranges[next].start;
        setPlaying({ ...p, index: next });
      }
    }
  };

  // ---- transcript & cut --------------------------------------------------

  const onSegments = (segments: Segment[]) => {
    update({ segments, cut: [], story: null });
    setSelection(new Set());
    setDialog(null);
  };

  const onDemo = (segments: Segment[]) => {
    setProject({
      ...emptyProject(),
      name: "Lantern — founder story",
      mediaName: "lantern_interview_A001.mov",
      mediaDuration: 133,
      segments,
    });
    setMediaFile(null);
    setMediaUrl(null);
    setSelection(new Set());
    setDialog(null);
  };

  const addToCut = (ids: string[], section: string) => {
    const ordered = project.segments.filter((s) => ids.includes(s.id)).map((s) => s.id);
    const items: CutItem[] = ordered.map((segmentId) => ({ uid: crypto.randomUUID(), segmentId, section }));
    update((p) => ({ cut: [...p.cut, ...items] }));
    setSelection(new Set());
  };

  const renameSpeaker = (from: string, to: string) =>
    update((p) => ({ segments: p.segments.map((s) => (s.speaker === from ? { ...s, speaker: to } : s)) }));

  const editText = (id: string, text: string) =>
    update((p) => ({ segments: p.segments.map((s) => (s.id === id ? { ...s, text } : s)) }));

  // ---- story -------------------------------------------------------------

  const findStory = async (brief: StoryBrief) => {
    update({ brief });
    setError(null);
    setBusy({ message: "Reading the transcript and finding the story…" });
    try {
      const res = await fetch("/api/story", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segments: project.segments, brief }),
      });
      const data = (await res.json()) as StoryPlan & { error?: string };
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      update({
        story: data,
        cut: storyToCut(data),
        name: project.name === "Untitled story" ? data.title : project.name,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const hasTranscript = project.segments.length > 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◐
          </span>
          Storycut
        </div>
        <nav className="tabs" aria-label="Mode">
          <button className={mode === "story" ? "active" : ""} onClick={() => setMode("story")}>
            Story cut
          </button>
          <button className={mode === "script" ? "active" : ""} onClick={() => setMode("script")}>
            Resolve → Script
          </button>
        </nav>
        {mode === "story" && (
          <>
            <input
              className="title-input"
              value={project.name}
              onChange={(e) => update({ name: e.target.value })}
              aria-label="Project name"
            />
            <div className="topbar-actions">
              <button onClick={() => setDialog("import")}>Import</button>
              <button className="primary" disabled={!project.cut.length} onClick={() => setDialog("export")}>
                Export to editor
              </button>
            </div>
          </>
        )}
      </header>

      {mode === "script" ? (
        <ScriptMode />
      ) : (
        <>
          {error && (
            <div className="banner error" role="alert">
              {error}
              <button className="ghost" onClick={() => setError(null)} aria-label="Dismiss">
                ✕
              </button>
            </div>
          )}
          {busy && (
            <div className="banner busy" role="status">
              <span className="spinner" /> {busy.message}
              {busy.progress != null && <progress max={100} value={busy.progress} />}
            </div>
          )}

          {!hasTranscript ? (
            <main className="empty">
              <h1>Find the story in your footage.</h1>
              <p>
                Bring in an interview, speech or vlog. Storycut transcribes it on your machine, builds a paper edit with
                AI, and hands a cut back to Final Cut, Resolve or Premiere.
              </p>
              <button className="primary" onClick={() => setDialog("import")}>
                Start a project
              </button>
            </main>
          ) : (
            <main className="workspace">
              <TranscriptPane
                segments={project.segments}
                cut={project.cut}
                story={project.story}
                activeId={activeSegment}
                selection={selection}
                setSelection={setSelection}
                onSeek={seek}
                onAdd={addToCut}
                onRenameSpeaker={renameSpeaker}
                onEditText={editText}
                canSeek={Boolean(mediaUrl)}
              />

              <section className="center">
                <div className={`player ${isVideo ? "" : "audio"} ${mediaUrl ? "" : "offline"}`}>
                  {mediaUrl ? (
                    <video
                      ref={mediaRef}
                      src={mediaUrl}
                      controls
                      onLoadedMetadata={onLoadedMetadata}
                      onTimeUpdate={onTimeUpdate}
                      onEnded={() => setPlaying(null)}
                    />
                  ) : (
                    <div className="player-placeholder">
                      <p>{project.mediaName ? `Relink “${project.mediaName}” to preview` : "No media loaded"}</p>
                      <label className="button">
                        Choose media
                        <input
                          type="file"
                          accept="video/*,audio/*"
                          hidden
                          onChange={(e) => e.target.files?.[0] && onMedia(e.target.files[0])}
                        />
                      </label>
                    </div>
                  )}
                </div>
                <StoryPanel
                  brief={project.brief}
                  story={project.story}
                  segById={segById}
                  aiReady={aiReady}
                  busy={Boolean(busy)}
                  onFind={findStory}
                  onApply={() => project.story && update({ cut: storyToCut(project.story) })}
                  onSeek={seek}
                />
              </section>

              <CutBoard
                cut={project.cut}
                segById={segById}
                runtime={runtime}
                target={project.brief.targetSeconds}
                activeUid={activeCutUid}
                playing={Boolean(playing)}
                canPlay={Boolean(mediaUrl)}
                onPlay={playCut}
                onSeek={seek}
                onChange={(cut) => update({ cut })}
              />
            </main>
          )}

          {dialog === "import" && (
            <ImportDialog
              mediaFile={mediaFile}
              onMedia={onMedia}
              onSegments={onSegments}
              onDemo={onDemo}
              onClose={() => setDialog(null)}
              setBusy={setBusy}
              setError={setError}
            />
          )}
          {dialog === "export" && <ExportDialog project={project} onChange={update} onClose={() => setDialog(null)} />}
        </>
      )}
    </div>
  );
}
