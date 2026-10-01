import { useEffect, useMemo, useRef, useState } from "react";
import { download } from "../lib/exporters";
import { mergeChunks, segmentId } from "../lib/parsers";
import {
  applyAssignments,
  assemble,
  buildScriptRequest,
  characters as listCharacters,
  emptyScriptProject,
  toCsv,
  toFountain,
  toSrt,
  type ClipStatus,
  type ScriptLine,
  type ScriptProject,
  type ScriptResponse,
} from "../lib/script";
import { clock } from "../lib/timecode";
import { parseTimelineFile, transcribableClips, type TimelineClip } from "../lib/timeline";
import {
  decodeTo16k,
  isSilent,
  SAMPLE_RATE,
  sliceAudio,
  whisperError,
  WhisperSession,
  WHISPER_MODELS,
} from "../lib/transcribe";

const KEY = "storycut:script:v1";

function load(): ScriptProject {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyScriptProject(), ...(JSON.parse(raw) as Partial<ScriptProject>) };
  } catch {
    // start fresh
  }
  return emptyScriptProject();
}

const REF_TYPES = ".txt,.md,.markdown,.json,.csv,.fountain,.srt,.vtt,.html,.xml,.yaml,.yml";
const norm = (name: string) => name.toLowerCase();
const fileBase = (name: string) => norm(name).replace(/\.[^.]+$/, "");

interface Progress {
  done: number;
  total: number;
  message: string;
}

export function ScriptMode() {
  const [project, setProject] = useState<ScriptProject>(load);
  const [media, setMedia] = useState<Map<string, File>>(new Map());
  const [model, setModel] = useState(WHISPER_MODELS[1].id);
  const [language, setLanguage] = useState("english");
  const [edlFps, setEdlFps] = useState(24);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const cancelRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(project));
    } catch {
      // quota / private mode
    }
  }, [project]);

  const update = (fn: (p: ScriptProject) => Partial<ScriptProject>) => setProject((p) => ({ ...p, ...fn(p) }));

  const allClips = useMemo(() => project.timelines.flatMap((t) => transcribableClips(t)), [project.timelines]);
  const findFile = (clip: TimelineClip) =>
    media.get(norm(clip.file)) ?? media.get(fileBase(clip.file)) ?? media.get(fileBase(clip.name));
  const linked = allClips.filter((c) => findFile(c)).length;
  const missingFiles = [...new Set(allClips.filter((c) => !findFile(c)).map((c) => c.file))];
  const chars = useMemo(() => {
    const fromPlan = project.plan?.characters.map((c) => c.name) ?? [];
    return [...new Set([...fromPlan, ...listCharacters(project.lines)])];
  }, [project.plan, project.lines]);
  const blocks = useMemo(() => assemble(project), [project]);
  const busy = Boolean(progress) || assigning;

  // ---- step 1: timelines ------------------------------------------------

  const addTimelines = async (files: FileList) => {
    setError(null);
    try {
      const parsed = (
        await Promise.all([...files].map(async (f) => parseTimelineFile(f.name, await f.text(), edlFps)))
      ).flat();
      update((p) => {
        const existing = new Set(p.timelines.map((t) => t.name));
        const fresh = parsed.map((t) => {
          let name = t.name;
          for (let i = 2; existing.has(name); i++) name = `${t.name} (${i})`;
          existing.add(name);
          return { ...t, name, clips: t.clips.map((c) => ({ ...c, timeline: name })) };
        });
        return { timelines: [...p.timelines, ...fresh], title: p.title || fresh[0]?.name || "" };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeTimeline = (name: string) =>
    update((p) => {
      const t = p.timelines.find((x) => x.name === name);
      const ids = new Set(t?.clips.map((c) => c.id));
      return {
        timelines: p.timelines.filter((x) => x.name !== name),
        lines: p.lines.filter((l) => !ids.has(l.clipId)),
      };
    });

  const moveTimeline = (i: number, d: -1 | 1) =>
    update((p) => {
      const t = [...p.timelines];
      const j = i + d;
      if (j < 0 || j >= t.length) return {};
      [t[i], t[j]] = [t[j], t[i]];
      return { timelines: t };
    });

  // ---- step 2: media -----------------------------------------------------

  const addMedia = (files: FileList) => {
    const next = new Map(media);
    for (const f of files) {
      if (
        !/^(video|audio)\//.test(f.type) &&
        !/\.(mov|mp4|m4v|mxf|mkv|webm|wav|mp3|m4a|aac|aif|aiff|flac|ogg)$/i.test(f.name)
      )
        continue;
      next.set(norm(f.name), f);
      if (!next.has(fileBase(f.name))) next.set(fileBase(f.name), f);
    }
    setMedia(next);
  };

  // ---- step 3: references ------------------------------------------------

  const addReferenceFiles = async (files: FileList) => {
    const refs = await Promise.all(
      [...files].map(async (f) => ({ id: segmentId(), name: f.name, text: await f.text() })),
    );
    update((p) => ({ references: [...p.references, ...refs] }));
  };

  const addPasted = () => {
    const text = paste.trim();
    if (!text) return;
    const name = text.split("\n")[0].slice(0, 50) || "Pasted notes";
    update((p) => ({ references: [...p.references, { id: segmentId(), name, text }] }));
    setPaste("");
  };

  // ---- step 4: transcribe ------------------------------------------------

  const transcribeAll = async (force = false) => {
    setError(null);
    cancelRef.current = false;
    const todo = allClips.filter((c) => force || !["done", "silent"].includes(project.clipStatus[c.id] ?? ""));
    if (!todo.length) return;
    const session = new WhisperSession(model, language);
    const pcmCache = new Map<File, Float32Array>();
    const setStatus = (id: string, s: ClipStatus) => update((p) => ({ clipStatus: { ...p.clipStatus, [id]: s } }));
    let failure: string | null = null;
    try {
      for (let i = 0; i < todo.length; i++) {
        if (cancelRef.current) break;
        const clip = todo[i];
        setProgress({ done: i, total: todo.length, message: `${clip.name}` });
        const file = findFile(clip);
        if (!file) {
          setStatus(clip.id, "missing");
          continue;
        }
        try {
          let pcm = pcmCache.get(file);
          if (!pcm) {
            pcm = await decodeTo16k(file);
            if (pcmCache.size >= 3) pcmCache.delete(pcmCache.keys().next().value!);
            pcmCache.set(file, pcm);
          }
          let { srcIn, srcOut } = clip;
          // EDL source times are source timecode; fall back to file-relative when out of range.
          if (srcIn * SAMPLE_RATE >= pcm.length && srcIn >= 3600) {
            const hours = Math.floor(srcIn / 3600) * 3600;
            srcIn -= hours;
            srcOut -= hours;
          }
          const audio = sliceAudio(pcm, srcIn, srcOut);
          if (!audio.length || isSilent(audio)) {
            setStatus(clip.id, "silent");
            update((p) => ({ lines: p.lines.filter((l) => l.clipId !== clip.id) }));
            continue;
          }
          const chunks = await session.run(audio, (message, pct) =>
            setProgress({
              done: i,
              total: todo.length,
              message: `${clip.name}: ${message}${pct != null ? ` ${Math.round(pct)}%` : ""}`,
            }),
          );
          const len = clip.recOut - clip.recIn;
          const lines: ScriptLine[] = mergeChunks(chunks).map((s) => ({
            id: segmentId(),
            clipId: clip.id,
            timeline: clip.timeline,
            start: clip.recIn + Math.min(s.start, len),
            end: clip.recIn + Math.min(s.end, len),
            text: s.text,
            character: "",
            parenthetical: "",
          }));
          update((p) => ({
            lines: [...p.lines.filter((l) => l.clipId !== clip.id), ...lines],
            clipStatus: { ...p.clipStatus, [clip.id]: lines.length ? "done" : "silent" },
          }));
        } catch (e) {
          setStatus(clip.id, "error");
          const msg = whisperError(e);
          // A model download failure will fail every clip; stop early.
          if (/download/i.test(msg)) {
            failure = msg;
            break;
          }
          failure = `${clip.name}: ${msg}`;
        }
      }
    } finally {
      session.close();
      setProgress(null);
      if (failure) setError(failure);
    }
  };

  // ---- step 5: assign characters ----------------------------------------

  const assign = async () => {
    setError(null);
    setAssigning(true);
    try {
      const res = await fetch("/api/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildScriptRequest(project)),
      });
      const data = (await res.json()) as ScriptResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      const { lines, ...plan } = data;
      update((p) => ({ lines: applyAssignments(p.lines, lines), plan, title: plan.title || p.title }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssigning(false);
    }
  };

  // ---- editing -------------------------------------------------------------

  const editLine = (id: string, patch: Partial<ScriptLine>) =>
    update((p) => ({ lines: p.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  const setCharacter = (id: string, value: string) => {
    if (value !== "__new") return editLine(id, { character: value });
    const name = window.prompt("New character name:")?.trim();
    if (name) editLine(id, { character: name });
  };

  const renameCharacter = (from: string) => {
    const to = window.prompt(`Rename “${from}” everywhere to:`, from)?.trim();
    if (!to || to === from) return;
    update((p) => ({
      lines: p.lines.map((l) => (l.character === from ? { ...l, character: to } : l)),
      plan: p.plan && {
        ...p.plan,
        characters: p.plan.characters.map((c) => (c.name === from ? { ...c, name: to } : c)),
      },
    }));
  };

  const reset = () => {
    if (!window.confirm("Clear timelines, transcripts and references?")) return;
    setProject(emptyScriptProject());
  };

  const fileStem =
    (project.title || "script")
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "_") || "script";
  const counts = Object.values(project.clipStatus).reduce<Record<string, number>>(
    (acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }),
    {},
  );
  const lineCount = (who: string) => project.lines.filter((l) => l.character === who).length;
  const unassigned = project.lines.filter((l) => !l.character).length;

  return (
    <main className="script-mode">
      <aside className="script-sidebar">
        {error && (
          <div className="banner error inline" role="alert">
            {error}
            <button className="ghost" onClick={() => setError(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        <section className="step">
          <h3>
            <span className="num">1</span> Timelines
          </h3>
          <p className="muted small">
            In Resolve: right-click a timeline in the Media Pool → Timelines → Export → <b>FCPXML</b> (or run the
            included “Export Timelines for Storycut” script). Add every timeline from both projects.
          </p>
          <div className="row">
            <label className="button">
              Add timeline files
              <input
                type="file"
                multiple
                accept=".fcpxml,.xml,.edl,.fcpxmld"
                hidden
                onChange={(e) => e.target.files && addTimelines(e.target.files)}
              />
            </label>
            <label className="small muted">
              EDL fps{" "}
              <select value={edlFps} onChange={(e) => setEdlFps(Number(e.target.value))}>
                {[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
          </div>
          {project.timelines.length > 0 && (
            <ul className="tl-list">
              {project.timelines.map((t, i) => (
                <li key={t.name}>
                  <span className="tl-name">{t.name}</span>
                  <span className="muted small">{transcribableClips(t).length} clips</span>
                  <span className="tl-actions">
                    <button
                      className="ghost small"
                      onClick={() => moveTimeline(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button className="ghost small" onClick={() => removeTimeline(t.name)} aria-label="Remove timeline">
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="step">
          <h3>
            <span className="num">2</span> Media
          </h3>
          <p className="muted small">
            Pick the folder(s) with the clips. Files are matched by name and never uploaded.
          </p>
          <div className="row">
            <label className="button">
              Choose folder
              <input
                type="file"
                hidden
                multiple
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                onChange={(e) => e.target.files && addMedia(e.target.files)}
              />
            </label>
            <label className="button">
              Choose files
              <input
                type="file"
                hidden
                multiple
                accept="video/*,audio/*,.mov,.mxf"
                onChange={(e) => e.target.files && addMedia(e.target.files)}
              />
            </label>
          </div>
          {allClips.length > 0 && (
            <p className={`small ${linked === allClips.length ? "ok" : "muted"}`}>
              {linked}/{allClips.length} clips linked
              {missingFiles.length > 0 && media.size > 0 && (
                <span title={missingFiles.join("\n")}>
                  {" "}
                  · missing: {missingFiles.slice(0, 3).join(", ")}
                  {missingFiles.length > 3 ? "…" : ""}
                </span>
              )}
            </p>
          )}
        </section>

        <section className="step">
          <h3>
            <span className="num">3</span> Reference prompts
          </h3>
          <p className="muted small">
            The prompts and notes you wrote in Claude, GPT and Higgsfield: character descriptions, scene prompts,
            dialogue. Used to work out who is talking.
          </p>
          <label className="button">
            Add files
            <input
              type="file"
              hidden
              multiple
              accept={REF_TYPES}
              onChange={(e) => e.target.files && addReferenceFiles(e.target.files)}
            />
          </label>
          <textarea
            rows={3}
            placeholder="…or paste prompts here"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          {paste.trim() && (
            <button className="small" onClick={addPasted}>
              Add pasted text
            </button>
          )}
          {project.references.length > 0 && (
            <ul className="tl-list">
              {project.references.map((r) => (
                <li key={r.id}>
                  <span className="tl-name" title={r.text.slice(0, 400)}>
                    {r.name}
                  </span>
                  <span className="muted small">{Math.ceil(r.text.length / 1000)}k chars</span>
                  <button
                    className="ghost small"
                    onClick={() => update((p) => ({ references: p.references.filter((x) => x.id !== r.id) }))}
                    aria-label="Remove reference"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="step">
          <h3>
            <span className="num">4</span> Transcribe
          </h3>
          <div className="row">
            <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Whisper model">
              {WHISPER_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {!model.endsWith(".en") && (
              <input value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language" size={8} />
            )}
          </div>
          <div className="row">
            <button className="primary" disabled={busy || !linked} onClick={() => transcribeAll(false)}>
              Transcribe {project.lines.length ? "remaining" : "all"} clips
            </button>
            {progress && (
              <button className="ghost" onClick={() => (cancelRef.current = true)}>
                Stop
              </button>
            )}
            {!progress && project.lines.length > 0 && (
              <button className="ghost small" disabled={busy} onClick={() => transcribeAll(true)}>
                Redo all
              </button>
            )}
          </div>
          {progress && (
            <div className="progress">
              <progress max={progress.total} value={progress.done} />
              <span className="small muted">
                {progress.done}/{progress.total} · {progress.message}
              </span>
            </div>
          )}
          {Object.keys(counts).length > 0 && !progress && (
            <p className="small muted">
              {counts.done ?? 0} with dialogue · {counts.silent ?? 0} silent
              {counts.missing ? ` · ${counts.missing} missing media` : ""}
              {counts.error ? ` · ${counts.error} failed` : ""}
            </p>
          )}
        </section>

        <section className="step">
          <h3>
            <span className="num">5</span> Characters &amp; script
          </h3>
          <textarea
            rows={2}
            placeholder="Notes for Claude, e.g. “Kai is the narrator in timeline 2.”"
            value={project.notes}
            onChange={(e) => update(() => ({ notes: e.target.value }))}
          />
          <button className="primary" disabled={busy || !project.lines.length} onClick={assign}>
            {assigning ? "Writing script…" : project.plan ? "Re-assign with Claude" : "Assign characters with Claude"}
          </button>
          {chars.length > 0 && (
            <ul className="char-list">
              {chars.map((c) => (
                <li key={c}>
                  <button className="ghost small" onClick={() => renameCharacter(c)} title="Rename everywhere">
                    {c}
                  </button>
                  <span className="muted small">
                    {lineCount(c)} {lineCount(c) === 1 ? "line" : "lines"}
                  </span>
                </li>
              ))}
              {unassigned > 0 && <li className="muted small">{unassigned} lines unassigned</li>}
            </ul>
          )}
        </section>

        <section className="step">
          <h3>
            <span className="num">6</span> Export
          </h3>
          <div className="row">
            <button
              disabled={!project.lines.length}
              onClick={() => download(`${fileStem}.fountain`, toFountain(project))}
            >
              Script (.fountain)
            </button>
            <button disabled={!project.lines.length} onClick={() => window.print()}>
              Print / PDF
            </button>
            <button
              disabled={!project.lines.length}
              onClick={() => download(`${fileStem}.csv`, toCsv(project), "text/csv")}
            >
              CSV
            </button>
          </div>
          {project.lines.length > 0 && (
            <>
              <p className="muted small">Subtitles per timeline, for Resolve (File → Import → Subtitle):</p>
              <div className="row">
                {project.timelines.map((t) => (
                  <button
                    key={t.name}
                    className="small"
                    onClick={() => download(`${t.name.replace(/[^\w\- ]+/g, "_")}.srt`, toSrt(project, t.name))}
                  >
                    {t.name}.srt
                  </button>
                ))}
              </div>
            </>
          )}
          <button className="ghost small danger" onClick={reset}>
            Start over
          </button>
        </section>
      </aside>

      <article className="script-doc">
        {!project.timelines.length ? (
          <div className="script-empty">
            <h1>Timelines in. Script out.</h1>
            <p className="muted">
              Load the timelines from your Resolve projects, link the clips, add the prompts you generated them with,
              and Storycut transcribes every clip and works out who is speaking.
            </p>
          </div>
        ) : (
          <div className="screenplay">
            <header className="title-page">
              <input
                className="script-title"
                value={project.plan?.title || project.title}
                onChange={(e) =>
                  update((p) => ({ title: e.target.value, plan: p.plan && { ...p.plan, title: e.target.value } }))
                }
                aria-label="Script title"
              />
              {project.plan?.logline && <p className="muted">{project.plan.logline}</p>}
            </header>
            {project.plan?.notes && (
              <details className="script-notes no-print">
                <summary>Claude’s notes</summary>
                <p>{project.plan.notes}</p>
              </details>
            )}
            {blocks.map((b, i) => {
              if (b.kind === "timeline")
                return (
                  <h2 key={`t${i}`} className="sp-timeline">
                    {b.name}
                  </h2>
                );
              if (b.kind === "scene")
                return (
                  <div key={`s${i}`} className="sp-scene">
                    <div className="sp-heading">{b.heading.toUpperCase()}</div>
                    {b.action && <p className="sp-action">{b.action}</p>}
                  </div>
                );
              if (b.kind === "clip")
                return (
                  <div key={`c${b.clip.id}`} className={`sp-clip no-print ${b.status ?? "pending"}`}>
                    <span>{clock(b.clip.recIn)}</span> {b.clip.name}
                    {b.status && b.status !== "done" && (
                      <span className="badge">{b.status === "missing" ? "media not linked" : b.status}</span>
                    )}
                  </div>
                );
              const l = b.line;
              return (
                <div key={l.id} className={`sp-line ${l.character ? "" : "unassigned"}`}>
                  <select
                    className="sp-character"
                    value={l.character}
                    onChange={(e) => setCharacter(l.id, e.target.value)}
                    aria-label="Character"
                  >
                    <option value="">— who? —</option>
                    {chars.map((c) => (
                      <option key={c} value={c}>
                        {c.toUpperCase()}
                      </option>
                    ))}
                    <option value="__new">+ New character…</option>
                  </select>
                  <span className="sp-paren-wrap">
                    <input
                      className="sp-paren"
                      value={l.parenthetical}
                      placeholder="parenthetical"
                      onChange={(e) => editLine(l.id, { parenthetical: e.target.value })}
                      aria-label="Parenthetical"
                    />
                  </span>
                  <textarea
                    className="sp-dialogue"
                    value={l.text}
                    rows={Math.max(1, Math.ceil(l.text.length / 42))}
                    onChange={(e) => editLine(l.id, { text: e.target.value })}
                    aria-label="Dialogue"
                  />
                </div>
              );
            })}
          </div>
        )}
      </article>
    </main>
  );
}
