# Storycut

Story-first editing for interviews, speeches, founder stories and vlogs. Inspired by Plotline.

1. **Import** a video or audio file, then either transcribe it **locally in the browser** (Whisper via transformers.js — media never leaves your machine) or import an SRT / VTT / JSON transcript from Resolve, Premiere or Descript.
2. **Find the story**: give a brief (format, target length, tone, notes). Claude reads the transcript and returns a structured paper edit — sections, ordered lines with reasons, soundbites and editor's notes. Only the transcript text is sent; never media.
3. **Shape the cut** on the paper-edit board: drag to reorder, add lines from the transcript (shift-click for ranges), rename sections and speakers, fix transcript typos (double-click), and **play the cut** against your media.
4. **Export** to your NLE, pointing at your original media (nothing is rendered):
   - **FCPXML 1.10** → Final Cut Pro, DaVinci Resolve (section markers included)
   - **CMX3600 EDL** → Premiere Pro, Resolve, Avid
   - **Script (.txt)** → for producer/client review

Adjacent source lines in the same section are merged into one edit; optional handles pad each edit so words aren't clipped. Set frame rate and source start timecode to match your clip.

## Run

```bash
cd storycut
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # needed for "Find the story" only
npm run dev                           # web on :5173, API on :8787
```

Production: `npm run build && npm start` (serves app + API on `$PORT`, default 8787).

Without an API key everything except "Find the story" works — you can transcribe, cut by hand and export. A demo interview is built in.

## Notes and limits

- **Model**: `claude-opus-5-5` with server-side refusal fallback; override with `STORYCUT_MODEL`.
- **Transcription** runs on WebGPU when available, otherwise WASM. The model (40–250 MB) downloads from Hugging Face on first use and is cached by the browser. Long files on WASM are slow; import a transcript from your NLE if so.
- **No speaker diarization**: lines from local transcription start as "Speaker 1"; click a speaker name to rename all its lines. Imported SRT/VTT keep `NAME:` prefixes and `<v Name>` tags.
- **Granularity is line-level** (sentence/phrase), not word-level trims. Fine-tune in your NLE.
- **Single source clip** per project. Multicam / multi-clip timelines are not supported yet.
- **FCPXML media linking**: fill in "Media folder on disk" in the export dialog for automatic linking; otherwise Final Cut/Resolve will ask you to relink.
- Project state is saved in the browser (localStorage). Media isn't stored — relink it after a reload.
- `npm install` downloads `onnxruntime-node` binaries (a transitive dependency not used in the browser). If that download is blocked on your network, use `npm install --ignore-scripts`.

## Develop

```bash
npm run typecheck
npm test
```
