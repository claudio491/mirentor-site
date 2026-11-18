// art.js: where each illustration is and what the page must know about it. Written by the art pipeline
// (sales/team-platform/sample-v3/art/export_app.py, from the images ChatGPT made): do not edit by hand.
// The one-page demonstration copy swaps this file for one that carries the images inside.
export const ART = {
  "visit": "art/visit.webp",
  "talk": "art/talk.webp",
  "follow": "art/follow.webp",
  "close": "art/close.webp",
  "rest": "art/rest.webp",
  "hand": "art/hand.webp",
  "handLit": "art/hand-lit.webp",
  "summit": "art/summit.webp",
  "summitGlow": "art/summit.glow.webp",
  "meeting": "art/meeting.webp",
  "meetingGlow": "art/meeting.glow.webp",
  "contract": "art/contract.webp",
  "contractGlow": "art/contract.glow.webp"
};
/** How much of each frame of a stop is light (0 to 1), frame by frame: the pool under the stop follows it. */
export const LIGHT = {"visit": [0.0006, 0.016, 0.05, 0.0516], "talk": [0.0051, 0.0109, 0.0169, 0.0167], "follow": [0.0034, 0.0102, 0.0143, 0.0117], "close": [0.0173, 0.0268, 0.029, 0.0096], "rest": [0.0024, 0.0026, 0.0026, 0.0027]};
/** The hand's joints as shares of its image: the wrist, then five fingers of four, from the base to the tip. */
export const HAND = {"wrist": {"x": 0.5046, "y": 0.7454, "r": 0.0644}, "fingers": [[{"x": 0.3608, "y": 0.4781, "r": 0.0289}, {"x": 0.2945, "y": 0.4216, "r": 0.0242}, {"x": 0.2387, "y": 0.3684, "r": 0.0235}, {"x": 0.1866, "y": 0.3128, "r": 0.0257}], [{"x": 0.4457, "y": 0.4053, "r": 0.0195}, {"x": 0.423, "y": 0.3108, "r": 0.0295}, {"x": 0.3859, "y": 0.2094, "r": 0.0293}, {"x": 0.3504, "y": 0.1091, "r": 0.0314}], [{"x": 0.5172, "y": 0.388, "r": 0.0253}, {"x": 0.5182, "y": 0.2799, "r": 0.0302}, {"x": 0.5181, "y": 0.1685, "r": 0.03}, {"x": 0.5182, "y": 0.0581, "r": 0.0321}], [{"x": 0.5856, "y": 0.4093, "r": 0.021}, {"x": 0.6136, "y": 0.315, "r": 0.0292}, {"x": 0.652, "y": 0.2124, "r": 0.0292}, {"x": 0.6895, "y": 0.1115, "r": 0.0311}], [{"x": 0.6369, "y": 0.4467, "r": 0.0212}, {"x": 0.6897, "y": 0.3832, "r": 0.0254}, {"x": 0.7505, "y": 0.3156, "r": 0.0255}, {"x": 0.8132, "y": 0.2431, "r": 0.0281}]]};
/** Where the team stands on the staircase, the ground first and the flag last, as shares of its image. */
export const STEPS = [[0.4044, 0.8458], [0.2262, 0.7341], [0.2816, 0.6648], [0.3398, 0.5956], [0.397, 0.5254], [0.4543, 0.4561], [0.5106, 0.3869], [0.5706, 0.3158], [0.6242, 0.253]];
