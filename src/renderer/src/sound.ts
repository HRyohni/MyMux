let ctx: AudioContext | null = null

// Short two-note chime, synthesized so the app ships no audio file.
export function playDone(isError = false): void {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const notes = isError ? [330, 247] : [660, 880]
    const start = ctx.currentTime + 0.02
    notes.forEach((freq, i) => {
      const t = start + i * 0.13
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(t)
      osc.stop(t + 0.3)
    })
  } catch { /* no audio device */ }
}
