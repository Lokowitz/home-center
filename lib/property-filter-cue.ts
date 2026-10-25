/** Pure timing values and the on/off rule for the property dropdown's attention cue. */
export const CUE_INTERVAL_MS = 120_000
export const CUE_DURATION_MS = 1_800

export function cueActive(s: { selected: boolean; hidden: boolean; reducedMotion: boolean }): boolean {
  return s.selected && !s.hidden && !s.reducedMotion
}
