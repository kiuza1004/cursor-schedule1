export type Schedule = {
  id: string;
  dateKey: string;
  memo: string;
  alarmEnabled: boolean;
  alarmHour: number;
  alarmMinute: number;
  /** 0 = 정시, 양수 = 해당 분만큼 일찍 */
  alarmBeforeMinutes: number;
  alarmTone: "beep" | "dingdong" | "phone";
  alarmVibrate: boolean;
};

export type Anniversary = {
  id: string;
  month: number;
  day: number;
  content: string;
};

export type AppData = {
  version: 1;
  schedules: Schedule[];
  anniversaries: Anniversary[];
};

export type SearchState = {
  fromKey: string;
  toKey: string;
  keyword: string;
  results: Schedule[];
  page: number;
  hasSearched: boolean;
};
