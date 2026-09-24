/**
 * Звуковое уведомление о новом заказе/брони/заявке — короткий двухтональный сигнал Web Audio
 * (без аудиофайлов). Браузеры разрешают звук только после действия пользователя:
 * unlockAudio() вызывается на первом клике/нажатии клавиши.
 */
type AudioContextCtor = new () => AudioContext;

let context: AudioContext | null = null;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function getContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  context ??= new Ctor();
  return context;
}

export function unlockAudio(): void {
  const ctx = getContext();
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

export function playNotificationSound(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  const start = ctx.currentTime + 0.01;
  const tones: Array<[number, number, number]> = [
    [880, 0, 0.16],
    [1318.5, 0.18, 0.24],
  ];
  for (const [frequency, offset, duration] of tones) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.35, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + duration + 0.02);
  }
}
