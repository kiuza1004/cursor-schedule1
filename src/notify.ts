import type { Schedule } from "./types";
import { parseDateKey } from "./format";

const FIRED_PREFIX = "cursor-schedule1-fired:";

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

function playBasicBell(): void {
  try {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + i * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.25 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.25);
      osc.stop(now + i * 0.25 + 0.2);
    }
  } catch {
    /* ignore */
  }
}

function triggerAlarmEffects(s: Schedule): void {
  if (s.alarmSound) playBasicBell();
  if (s.alarmVibrate && "vibrate" in navigator) {
    try {
      navigator.vibrate([250, 100, 250, 100, 250]);
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
    if (diff < 0 || diff > 10_000) continue;
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
