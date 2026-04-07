import type { Schedule } from "./types";
import { parseDateKey } from "./format";

const FIRED_PREFIX = "cursor-schedule1-fired:";
const MISSED_GRACE_MS = 10 * 60_000;
const AUDIO_HINT_KEY = "cursor-schedule1-audio-hint-shown";
let alarmAudioCtx: AudioContext | null = null;

function firedKey(id: string, fireAtMs: number): string {
  return `${FIRED_PREFIX}${id}:${fireAtMs}`;
}

function wasFired(id: string, fireAtMs: number): boolean {
  return sessionStorage.getItem(firedKey(id, fireAtMs)) === "1";
}

function markFired(id: string, fireAtMs: number): void {
  sessionStorage.setItem(firedKey(id, fireAtMs), "1");
}

function alarmMoment(s: Schedule): Date | null {
  if (!s.alarmEnabled) return null;
  const d = parseDateKey(s.dateKey);
  if (!d) return null;
  d.setHours(s.alarmHour, s.alarmMinute, 0, 0);
  const ms = d.getTime() - s.alarmBeforeMinutes * 60_000;
  return new Date(ms);
}

function getOrCreateAudioContext(): AudioContext | null {
  const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!alarmAudioCtx) alarmAudioCtx = new Ctx();
  return alarmAudioCtx;
}

function maybeShowAudioHint(): void {
  if (sessionStorage.getItem(AUDIO_HINT_KEY) === "1") return;
  sessionStorage.setItem(AUDIO_HINT_KEY, "1");
  window.setTimeout(() => {
    alert("알람 벨소리가 안 들리면 화면을 한 번 터치해 오디오 권한을 활성화해 주세요.");
  }, 0);
}

function scheduleTone(ctx: AudioContext, start: number, duration: number, freq: number, volume = 0.16): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function playToneFor30s(tone: Schedule["alarmTone"]): void {
  try {
    if (tone === "none") return;
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;
    const start = ctx.currentTime + 0.01;
    const end = start + 30;
    if (tone === "dingdong") {
      for (let t = start; t < end; t += 1.1) {
        scheduleTone(ctx, t, 0.16, 1046, 0.17);
        scheduleTone(ctx, t + 0.22, 0.2, 784, 0.15);
      }
      return;
    }
    if (tone === "phone") {
      for (let t = start; t < end; t += 1.6) {
        scheduleTone(ctx, t, 0.22, 740, 0.18);
        scheduleTone(ctx, t + 0.3, 0.22, 880, 0.18);
        scheduleTone(ctx, t + 0.8, 0.22, 740, 0.18);
        scheduleTone(ctx, t + 1.1, 0.22, 880, 0.18);
      }
      return;
    }
    for (let t = start; t < end; t += 0.8) {
      scheduleTone(ctx, t, 0.22, 880, 0.17);
    }
  } catch {
    /* ignore */
  }
}

function triggerAlarmEffects(s: Schedule): void {
  playToneFor30s(s.alarmTone);
  if (alarmAudioCtx && alarmAudioCtx.state !== "running") maybeShowAudioHint();
  if (s.alarmVibrate && "vibrate" in navigator) {
    try {
      const pattern: number[] = [];
      for (let i = 0; i < 25; i++) {
        pattern.push(400, 200);
      }
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}

export async function ensureNotifyPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const p = await Notification.requestPermission();
  return p === "granted";
}

export function checkAndFireAlarms(schedules: Schedule[], now = new Date()): void {
  const t = now.getTime();
  for (const s of schedules) {
    if (!s.alarmEnabled || !s.memo.trim()) continue;
    const when = alarmMoment(s);
    if (!when) continue;
    const diff = t - when.getTime();
    if (diff < 0 || diff > MISSED_GRACE_MS) continue;
    const fireAtMs = when.getTime();
    if (wasFired(s.id, fireAtMs)) continue;
    markFired(s.id, fireAtMs);
    triggerAlarmEffects(s);
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("일정 알람", { body: s.memo, tag: s.id });
      } catch {
        /* ignore */
      }
    }
  }
}

let timer: number | null = null;

function nextAlarmDelayMs(schedules: Schedule[]): number {
  const now = Date.now();
  let nearest: number | null = null;
  for (const s of schedules) {
    if (!s.alarmEnabled) continue;
    const when = alarmMoment(s);
    if (!when) continue;
    const ms = when.getTime();
    if (ms < now) continue;
    if (nearest === null || ms < nearest) nearest = ms;
  }
  if (nearest === null) return 30_000;
  return Math.max(300, Math.min(nearest - now + 50, 30_000));
}

export function startAlarmScheduler(getSchedules: () => Schedule[]): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  const tick = () => {
    checkAndFireAlarms(getSchedules(), new Date());
    const delay = nextAlarmDelayMs(getSchedules());
    timer = window.setTimeout(tick, delay);
  };
  tick();
}

export function primeAlarmAudioByGesture(): void {
  const unlock = () => {
    const ctx = getOrCreateAudioContext();
    if (ctx && ctx.state !== "running") {
      void ctx.resume();
    }
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("touchstart", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}
