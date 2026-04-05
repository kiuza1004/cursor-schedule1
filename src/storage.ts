import type { AppData } from "./types";

const KEY = "cursor-schedule1-v1";

const empty: AppData = { version: 1, schedules: [], anniversaries: [] };

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(empty);
    const p = JSON.parse(raw) as AppData;
    if (p?.version !== 1 || !Array.isArray(p.schedules) || !Array.isArray(p.anniversaries)) {
      return structuredClone(empty);
    }
    return p;
  } catch {
    return structuredClone(empty);
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(KEY, JSON.stringify(data));
}
