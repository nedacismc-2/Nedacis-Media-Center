let sharedAudioCtx: AudioContext | null = null;
let pendingSpeechTimer: number | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function playAttendanceChime(variant: 'success' | 'error' = 'success'): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const notes =
      variant === 'success'
        ? [
            { freq: 880, start: 0, duration: 0.09 },
            { freq: 1174.66, start: 0.09, duration: 0.14 },
          ]
        : [
            { freq: 310, start: 0, duration: 0.11 },
            { freq: 235, start: 0.12, duration: 0.16 },
          ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = variant === 'success' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(note.freq, now + note.start);

      gain.gain.setValueAtTime(0.001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(0.14, now + note.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.start + note.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.start);
      osc.stop(now + note.start + note.duration + 0.02);
    }
  } catch {
    // Ignore if audio context is blocked or unavailable
  }
}

function pickIndonesianVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const idVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('id'));
  if (idVoices.length === 0) return null;

  return (
    idVoices.find((v) => /google|natural|gadis|ardi/i.test(v.name)) ||
    idVoices[0]
  );
}

export function warmAttendanceVoice(): void {
  try {
    getAudioContext();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
  } catch {
    // Ignore
  }
}

export function announceAttendanceVoice(params: {
  fullName: string;
  actionType?: 'check_in' | 'check_out';
  status?: string;
  customPhrase?: string;
}): void {
  const cleanName = (params.fullName || 'Anggota').trim();
  playAttendanceChime('success');

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return;
  }

  try {
    if (pendingSpeechTimer !== null) {
      window.clearTimeout(pendingSpeechTimer);
      pendingSpeechTimer = null;
    }
    window.speechSynthesis.cancel();

    const suffix =
      params.actionType === 'check_out'
        ? 'sudah absen pulang'
        : 'sudah absen';
    const phrase = params.customPhrase ? params.customPhrase : `${cleanName}, ${suffix}`;

    pendingSpeechTimer = window.setTimeout(() => {
      try {
        const utterance = new SpeechSynthesisUtterance(phrase);
        utterance.lang = 'id-ID';
        utterance.rate = 0.98;
        utterance.pitch = 1.02;
        utterance.volume = 1;

        const idVoice = pickIndonesianVoice();
        if (idVoice) {
          utterance.voice = idVoice;
        }
        window.speechSynthesis.speak(utterance);
      } catch {
        // Ignore speech synthesis failures on unsupported environments
      }
    }, 150);
  } catch {
    // Ignore
  }
}
