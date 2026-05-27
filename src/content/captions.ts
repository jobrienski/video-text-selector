export function activeCueText(video: HTMLVideoElement): string | null {
  const tracks = video.textTracks;
  if (!tracks || tracks.length === 0) return null;
  const t = video.currentTime;
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (!track) continue;
    if (track.mode === "disabled") continue;
    // Some sites enable hidden/showing tracks but only populate cues lazily.
    const cues = track.activeCues ?? track.cues;
    if (!cues || cues.length === 0) continue;
    for (let j = 0; j < cues.length; j++) {
      const cue = cues[j];
      if (!cue) continue;
      if (cue.startTime <= t && cue.endTime >= t) {
        // VTTCue has `.text`; raw TextTrackCue does not. Cast through unknown.
        const text = (cue as unknown as { text?: string }).text;
        if (typeof text === "string" && text.trim().length > 0) {
          return text.trim();
        }
      }
    }
  }
  return null;
}
