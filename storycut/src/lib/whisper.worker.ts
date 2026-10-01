/// <reference lib="webworker" />
// Runs Whisper locally in the browser. Audio never leaves the machine.
import { pipeline } from "@huggingface/transformers";

export type WorkerIn = { type: "run"; audio: Float32Array; model: string; language: string };
export type WorkerOut =
  | { type: "status"; message: string; progress?: number }
  | { type: "result"; chunks: { start: number; end: number; text: string }[] }
  | { type: "error"; message: string };

type Asr = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>;

const cache = new Map<string, Promise<Asr>>();
const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

function load(model: string): Promise<Asr> {
  let p = cache.get(model);
  if (!p) {
    const device = "gpu" in navigator ? "webgpu" : "wasm";
    p = pipeline("automatic-speech-recognition", model, {
      device,
      dtype: device === "webgpu" ? "fp32" : "q8",
      progress_callback: (e: { status: string; file?: string; progress?: number }) => {
        if (e.status === "progress" && e.file?.endsWith(".onnx")) {
          post({ type: "status", message: `Downloading model (${e.file.split("/").pop()})`, progress: e.progress });
        }
      },
    }) as unknown as Promise<Asr>;
    cache.set(model, p);
  }
  return p;
}

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const { audio, model, language } = ev.data;
  try {
    post({ type: "status", message: "Loading model…" });
    const asr = await load(model);
    post({ type: "status", message: `Transcribing ${Math.round(audio.length / 16000)}s of audio…` });
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
    post({ type: "result", chunks });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
