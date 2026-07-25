// Rotating status lines for in-flight generations. Kept out of
// GeneratingMedia.tsx so that file only exports components (fast refresh), and
// shared so a card face and its detail modal narrate the same generation the
// same way.

export const IMAGE_MESSAGES = [
  'Sending request...',
  'Composing the scene...',
  'Rendering details...',
  'Finalizing the frame...',
]
export const VIDEO_MESSAGES = [
  'Sending request...',
  'Storyboarding frames...',
  'Rendering motion...',
  'Finalizing the clip...',
]
export const ANIMATE_MESSAGES = [
  'Sending request...',
  'Animating still...',
  'Rendering motion...',
  'Finalizing the clip...',
]
// B-Roll Continuous — a keyframe still, and the clip that interpolates between
// two of them.
export const KEYFRAME_MESSAGES = [
  'Sending request...',
  'Painting the keyframe...',
  'Locking the style...',
  'Almost there...',
]
export const INTERPOLATE_MESSAGES = [
  'Sending request...',
  'Interpolating frames...',
  'Rendering motion...',
  'Finalizing the clip...',
]
