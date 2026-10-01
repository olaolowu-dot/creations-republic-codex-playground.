// Shared between the browser app and the API server.

/** One transcribed sentence/phrase, tied to source media time (seconds). */
export interface Segment {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
}

/** One entry on the paper-edit board. */
export interface CutItem {
  uid: string;
  segmentId: string;
  section: string;
  note?: string;
}

export interface StoryBrief {
  format: string;
  targetSeconds: number;
  tone: string;
  notes: string;
}

export interface StoryBeat {
  segmentId: string;
  reason: string;
}

export interface StorySection {
  name: string;
  purpose: string;
  beats: StoryBeat[];
}

export interface StoryPlan {
  title: string;
  logline: string;
  sections: StorySection[];
  soundbites: { segmentId: string; why: string }[];
  editorNotes: string;
}

export interface FrameRate {
  label: string;
  /** frames = num / den per second; one frame lasts den/num seconds. */
  num: number;
  den: number;
}

export const FRAME_RATES: FrameRate[] = [
  { label: "23.976", num: 24000, den: 1001 },
  { label: "24", num: 24, den: 1 },
  { label: "25", num: 25, den: 1 },
  { label: "29.97", num: 30000, den: 1001 },
  { label: "30", num: 30, den: 1 },
  { label: "50", num: 50, den: 1 },
  { label: "59.94", num: 60000, den: 1001 },
  { label: "60", num: 60, den: 1 },
];

export interface Project {
  name: string;
  mediaName: string;
  mediaDuration: number;
  width: number;
  height: number;
  fpsLabel: string;
  segments: Segment[];
  brief: StoryBrief;
  story: StoryPlan | null;
  cut: CutItem[];
}

export function emptyProject(): Project {
  return {
    name: "Untitled story",
    mediaName: "",
    mediaDuration: 0,
    width: 1920,
    height: 1080,
    fpsLabel: "25",
    segments: [],
    brief: {
      format: "Interview highlight",
      targetSeconds: 90,
      tone: "Warm, honest, forward-moving",
      notes: "",
    },
    story: null,
    cut: [],
  };
}
