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

export async function ensureNotifyPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const p = await Notification.requestPermission();
  return p === "granted";
}

export function checkAndFireAlarms(schedules: Schedule[], now = new Date()): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const t = now.getTime();
  for (const s of schedules) {
    if (!s.alarmEnabled || !s.memo.trim()) continue;
    const when = alarmMoment(s);
    if (!when) continue;
    const diff = t - when.getTime();
    if (diff < 0 || diff > 120_000) continue;
    const fireAtMs = when.getTime();
    if (wasFired(s.id, fireAtMs)) continue;
    markFired(s.id, fireAtMs);
    try {
      new Notification("일정 알람", { body: s.memo, tag: s.id });
    } catch {
      /* ignore */
    }
  }
}
