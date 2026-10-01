/// <reference lib="webworker" />
// Runs Whisper locally in the browser. Audio never leaves the machine.
import { pipeline } from "@huggingface/transformers";

export type WorkerIn = { type: "run"; id: number; audio: Float32Array; model: string; language: string };
export type WorkerOut =
  | { type: "status"; id: number; message: string; progress?: number }
  | { type: "result"; id: number; chunks: { start: number; end: number; text: string }[] }
  | { type: "error"; id: number; message: string };

type Asr = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>;

const cache = new Map<string, Promise<Asr>>();
const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

function load(model: string, id: number): Promise<Asr> {
  let p = cache.get(model);
  if (!p) {
    const device = "gpu" in navigator ? "webgpu" : "wasm";
    p = pipeline("automatic-speech-recognition", model, {
      device,
      dtype: device === "webgpu" ? "fp32" : "q8",
      progress_callback: (e: { status: string; file?: string; progress?: number }) => {
        if (e.status === "progress" && e.file?.endsWith(".onnx")) {
          post({ type: "status", id, message: `Downloading model (${e.file.split("/").pop()})`, progress: e.progress });
        }
      },
    }) as unknown as Promise<Asr>;
    p.catch(() => cache.delete(model));
    cache.set(model, p);
  }
  return p;
}

// Jobs run one at a time, in order.
let queue = Promise.resolve();

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const { id, audio, model, language } = ev.data;
  queue = queue.then(async () => {
    try {
      post({ type: "status", id, message: "Loading model…" });
      const asr = await load(model, id);
      post({ type: "status", id, message: `Transcribing ${Math.round(audio.length / 16000)}s of audio…` });
      const out = await asr(audio, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        ...(model.endsWith(".en") ? {} : { language, task: "transcribe" }),
      });
      const duration = audio.length / 16000;
      const chunks = (out.chunks ?? []).map((c) => ({
        start: c.timestamp[0] ?? 0,
        end: c.timestamp[1] ?? duration,
        text: c.text,
      }));
      post({ type: "result", id, chunks });
    } catch (err) {
      post({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
    }
  });
};
