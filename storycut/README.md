# Storycut

Story-first editing for interviews, speeches, founder stories and vlogs. Inspired by Plotline.

Two modes:

- **Resolve → Script**: transcribe every clip on your DaVinci Resolve timelines (across projects), work out which character speaks each line using the prompts you generated the clips with, and get a formatted script.
- **Story cut**: turn one long interview into a paper edit and send the cut back to your NLE.

## Resolve → Script

1. **Export the timelines** from each Resolve project as FCPXML:
   - one at a time: Media Pool → right-click the timeline → *Timelines → Export → FCPXML*, or
   - all at once: copy [`resolve/Export Timelines for Storycut.py`](resolve/Export%20Timelines%20for%20Storycut.py) into Resolve's `Fusion/Scripts/Utility` folder (paths are in the file), restart Resolve, open a project and run *Workspace → Scripts → Export Timelines for Storycut*. It writes every timeline in the project to `~/Desktop/Storycut/<project>/`. Run it in each project.
   FCP 7 XML and EDL also work (set the EDL frame rate first).
2. **Add timeline files**: every timeline from both projects. Reorder them to set the script order.
3. **Choose folder**: pick the folder(s) holding the clips. Files are matched by name to the media paths in the timeline; nothing is uploaded.
4. **Reference prompts**: add the prompts/notes you wrote in Claude, GPT or Higgsfield (txt, md, json, csv, fountain…) or paste them. Character names and descriptions, scene prompts and planned dialogue help most.
5. **Transcribe**: every clip is transcribed locally with Whisper, only the part of the file used on the timeline. Silent clips (b-roll, AI video without audio) are detected and skipped so Whisper doesn't invent lines. Linked video+audio of the same take is transcribed once; separate dialogue/VO tracks are included.
6. **Assign characters with Claude**: Claude reads the transcripts with your references and returns who speaks each line, delivery notes, fixes for misheard names, scene headings and action lines, a character list and notes on anything uncertain. Fix any line with its character dropdown; click a character in the sidebar to rename it everywhere.
7. **Export**:
   - **Fountain** (`.fountain`): opens in Highland, Final Draft, Fade In, WriterSolo, Slugline
   - **Print / PDF**: screenplay layout from the browser's print dialog
   - **CSV**: every line with timeline, time, clip, file and character
   - **SRT per timeline**: `CHARACTER: line` subtitles to import back into Resolve (*File → Import → Subtitle*), timed from the timeline start

Clips without dialogue still show in the script as markers (hidden when printing). If a clip's media isn't linked it's flagged and skipped; link it and click *Transcribe remaining clips*.

## Story cut

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

- **Resolve → Script:**
  - Each media file is decoded in the browser, so very large camera files (multi-GB) are slow and memory-hungry. AI-generated clips are fine.
  - SRT times start at 00:00:00. If Resolve places them an hour late or early on a timeline that starts at 01:00:00:00, shift the subtitle track.
  - Speaker detection comes from Claude reading your references and the dialogue, not from voice analysis. Two characters with no names or prompts to go on will need manual assignment.

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
