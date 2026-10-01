import { mergeChunks } from "./parsers";
import type { Segment } from "./types";
import type { WorkerIn, WorkerOut } from "./whisper.worker";

export const WHISPER_MODELS = [
  { id: "onnx-community/whisper-tiny.en", label: "Tiny · English · fastest" },
  { id: "onnx-community/whisper-base.en", label: "Base · English · balanced" },
  { id: "onnx-community/whisper-small.en", label: "Small · English · most accurate" },
  { id: "onnx-community/whisper-base", label: "Base · multilingual" },
  { id: "onnx-community/whisper-small", label: "Small · multilingual" },
];

export const SAMPLE_RATE = 16000;

/** Decodes any browser-playable audio/video file to 16 kHz mono PCM, as Whisper expects. */
export async function decodeTo16k(file: Blob): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const audio = await ctx.decodeAudioData(buf);
    if (audio.numberOfChannels === 1) return audio.getChannelData(0);
    const out = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < ch.length; i++) out[i] += ch[i] / audio.numberOfChannels;
    }
    return out;
  } finally {
    void ctx.close();
  }
}

/** Copy of [start, end) seconds of 16 kHz PCM. */
export function sliceAudio(pcm: Float32Array, start: number, end: number): Float32Array {
  const a = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const b = Math.min(pcm.length, Math.ceil(end * SAMPLE_RATE));
  return pcm.slice(a, Math.max(a, b));
}

/**
 * True when no 100 ms window rises above roughly -40 dBFS. Whisper invents text
 * ("Thank you.") on silence, so silent clips are skipped instead of transcribed.
 */
export function isSilent(pcm: Float32Array, threshold = 0.01): boolean {
  const win = SAMPLE_RATE / 10;
  for (let i = 0; i < pcm.length; i += win) {
    let sum = 0;
    const end = Math.min(pcm.length, i + win);
    for (let j = i; j < end; j++) sum += pcm[j] * pcm[j];
    if (Math.sqrt(sum / Math.max(1, end - i)) > threshold) return false;
  }
  return true;
}

type Chunk = { start: number; end: number; text: string };

/** One Whisper worker reused across many clips so the model loads once. */
export class WhisperSession {
  private worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  private nextId = 1;
  private jobs = new Map<number, { resolve: (c: Chunk[]) => void; reject: (e: Error) => void; onStatus?: (m: string, p?: number) => void }>();

  constructor(
    private model: string,
    private language: string,
  ) {
    this.worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      const job = this.jobs.get(m.id);
      if (!job) return;
      if (m.type === "status") job.onStatus?.(m.message, m.progress);
      else {
        this.jobs.delete(m.id);
        if (m.type === "result") job.resolve(m.chunks);
        else job.reject(new Error(m.message));
      }
    };
    this.worker.onerror = (e) => {
      for (const job of this.jobs.values()) job.reject(new Error(e.message || "Whisper worker crashed"));
      this.jobs.clear();
    };
  }

  run(audio: Float32Array, onStatus?: (message: string, progress?: number) => void): Promise<Chunk[]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject, onStatus });
      const msg: WorkerIn = { type: "run", id, audio, model: this.model, language: this.language };
      this.worker.postMessage(msg, [audio.buffer]);
    });
  }

  close() {
    this.worker.terminate();
  }
}

export async function transcribe(
  file: File,
  model: string,
  language: string,
  onStatus: (message: string, progress?: number) => void,
): Promise<Segment[]> {
  onStatus("Decoding audio…");
  const audio = await decodeTo16k(file);
  const session = new WhisperSession(model, language);
  try {
    return mergeChunks(await session.run(audio, onStatus));
  } finally {
    session.close();
  }
}

/** Friendlier message for the common failure (model download blocked/offline). */
export function whisperError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch|network/i.test(msg)
    ? "Couldn't download the Whisper model. Check your connection, or import transcripts instead."
    : `Transcription failed: ${msg}`;
}
