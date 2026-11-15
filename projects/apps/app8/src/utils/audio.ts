/** Short, optional local UI sounds. Disabled automatically if Web Audio is unavailable. */
class SoundController {
  enabled = false;
  private context: AudioContext | null = null;
  private beep(frequency: number, duration = 0.065) {
    if (!this.enabled || typeof window === 'undefined') return;
    try {
      this.context ??= new AudioContext();
      const context = this.context;
      if (context.state === 'suspended') void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);
      gain.gain.setValueAtTime(0.04, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + duration);
    } catch { /* no audio device or permissions */ }
  }
  playProduce() { this.beep(440); }
  playEnqueue() { this.beep(520); }
  playConsume() { this.beep(720); }
  playBlocked() { this.beep(245, 0.09); }
}
export const sound = new SoundController();
