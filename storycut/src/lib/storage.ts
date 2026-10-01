import { emptyProject, type Project } from "./types";

const KEY = "storycut:project:v1";

export function loadProject(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyProject(), ...(JSON.parse(raw) as Partial<Project>) };
  } catch {
    // Storage unavailable or corrupt: start fresh.
  }
  return emptyProject();
}

export function saveProject(p: Project) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Quota or private mode; the session still works in memory.
  }
}

export function storyToCut(plan: NonNullable<Project["story"]>) {
  return plan.sections.flatMap((sec) =>
    sec.beats.map((b) => ({ uid: crypto.randomUUID(), segmentId: b.segmentId, section: sec.name, note: b.reason })),
  );
}
