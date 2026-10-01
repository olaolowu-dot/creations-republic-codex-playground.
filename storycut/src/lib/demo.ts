import type { Segment } from "./types";

// A short fictional founder interview so the app can be tried without media.
const LINES: [number, number, string, string][] = [
  [0.0, 3.2, "Interviewer", "Okay, we're rolling. Can you just say your name and what you do?"],
  [3.6, 8.9, "Maya", "Sure. I'm Maya Okafor, and I run Lantern, we make solar lamps for kids who study after dark."],
  [9.4, 12.1, "Interviewer", "Where did the idea come from?"],
  [12.5, 19.8, "Maya", "Honestly it started with my grandmother's house in Enugu. The power would go out almost every night."],
  [20.1, 27.4, "Maya", "And I remember doing my homework by the light of a kerosene lamp, and the smell of it, it gets into your clothes."],
  [27.9, 33.0, "Maya", "My cousin burned her hand on one when she was nine. She still has the scar."],
  [33.6, 36.0, "Maya", "Um, so, yeah. That stuck with me."],
  [36.5, 39.2, "Interviewer", "When did you decide to actually build something?"],
  [39.6, 47.8, "Maya", "I was working in finance in London, very comfortable, and I was miserable. I kept a sketch of the lamp on my desk for two years."],
  [48.2, 53.5, "Maya", "One day my manager saw it and asked what it was, and I couldn't explain why I hadn't built it yet."],
  [53.9, 57.0, "Maya", "I quit three weeks later."],
  [57.5, 60.0, "Interviewer", "Was it hard at the start?"],
  [60.3, 67.9, "Maya", "The first hundred lamps all failed. Every single one. The batteries couldn't take the heat."],
  [68.3, 74.6, "Maya", "I sat on the floor of a warehouse in Lagos with a box of dead lamps and I genuinely thought, that's it, I've wasted everything."],
  [75.0, 81.2, "Maya", "Then one of the kids from the pilot school walked in holding hers, and it was still working, because she'd kept it in the shade."],
  [81.6, 86.4, "Maya", "She'd figured out the problem before our engineers did. She was eleven."],
  [86.9, 92.0, "Maya", "We redesigned the housing around what she did. That's the lamp we sell today."],
  [92.4, 95.1, "Interviewer", "How many lamps are out there now?"],
  [95.5, 101.3, "Maya", "Just over two hundred thousand, in eleven countries. Which still feels made up when I say it out loud."],
  [101.7, 107.5, "Maya", "But the number I care about is hours. Kids are getting about two extra hours of study every night."],
  [108.0, 110.2, "Interviewer", "What's next for Lantern?"],
  [110.6, 117.4, "Maya", "We're working with schools to let kids charge the lamps at school during the day, so the light comes home with them."],
  [117.9, 124.6, "Maya", "I think about my cousin's hand a lot. Nobody should have to choose between learning and being safe."],
  [125.0, 129.8, "Maya", "If a nine year old can study tonight without breathing smoke, that's the whole job. That's it."],
  [130.2, 132.5, "Interviewer", "That's great, thank you."],
];

export function demoSegments(): Segment[] {
  return LINES.map(([start, end, speaker, text], i) => ({ id: `d${i + 1}`, start, end, speaker, text }));
}
