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

/** Decodes any browser-playable audio/video file to 16 kHz mono PCM, as Whisper expects. */
export async function decodeTo16k(file: File): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
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

export async function transcribe(
  file: File,
  model: string,
  language: string,
  onStatus: (message: string, progress?: number) => void,
): Promise<Segment[]> {
  onStatus("Decoding audio…");
  const audio = await decodeTo16k(file);
  const worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  try {
    const chunks = await new Promise<{ start: number; end: number; text: string }[]>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data;
        if (m.type === "status") onStatus(m.message, m.progress);
        else if (m.type === "result") resolve(m.chunks);
        else reject(new Error(m.message));
      };
      worker.onerror = (e) => reject(new Error(e.message));
      const msg: WorkerIn = { type: "run", audio, model, language };
      worker.postMessage(msg, [audio.buffer]);
    });
    return mergeChunks(chunks);
  } finally {
    worker.terminate();
  }
}
