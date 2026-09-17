/** Synchronously disable owned tracks before any asynchronous SDK operation. */
export class VoiceMicrophone {
  private generation = 0;
  private track: MediaStreamTrack | null = null;
  private desired = false;
  stop() {
    this.desired = false;
    this.generation++;
    if (this.track) { this.track.enabled = false; this.track.stop(); this.track = null; }
  }
  get active() { return Boolean(this.desired && this.track?.enabled && this.track.readyState === "live"); }
  async start(capture: () => Promise<MediaStream>, publish: (track: MediaStreamTrack) => Promise<void>, permitted: () => boolean) {
    this.stop();
    this.desired = true;
    const generation = this.generation;
    const stream = await capture();
    const track = stream.getAudioTracks()[0];
    // Permission dialogs can resolve after pointerup, unmount or backgrounding.
    if (!track || generation !== this.generation || !this.desired || !permitted()) { stream.getTracks().forEach(t => t.stop()); return false; }
    track.enabled = false;
    this.track = track;
    try {
      await publish(track);
      if (generation !== this.generation || !this.desired || !permitted() || track.readyState !== "live") { track.stop(); return false; }
      track.enabled = true;
      return true;
    } catch (error) { track.stop(); if (generation === this.generation) this.stop(); throw error; }
  }
}
