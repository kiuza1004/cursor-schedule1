import "./style.css";
import type { Anniversary, AppData, Schedule, SearchState } from "./types";
import { addDays, daysInMonth, pad2, parseDateKey, startOfToday, toDateKey } from "./format";
import { loadData, saveData } from "./storage";
import { checkAndFireAlarms, ensureNotifyPermission } from "./notify";

type Expanded = {
  schedule: boolean;
  anniversary: boolean;
  search: boolean;
};

type FormSnapshot = {
  memo: string;
  alarmEnabled: boolean;
  alarmHour: number;
  alarmMinute: number;
  alarmBefore: number;
  editingId: string | null;
};

const PAGE = 10;

const BEFORE_OPTIONS: { label: string; minutes: number }[] = [
  { label: "정시", minutes: 0 },
  { label: "5분 전", minutes: 5 },
  { label: "10분 전", minutes: 10 },
  { label: "15분 전", minutes: 15 },
  { label: "30분 전", minutes: 30 },
  { label: "1시간 전", minutes: 60 },
  { label: "2시간 전", minutes: 120 },
  { label: "3시간 전", minutes: 180 },
  { label: "1일 전", minutes: 1440 },
];

function emptyFormSnapshot(): FormSnapshot {
  return {
    memo: "",
    alarmEnabled: false,
    alarmHour: 9,
    alarmMinute: 0,
    alarmBefore: 0,
    editingId: null,
  };
}

function cloneSnap(s: FormSnapshot): FormSnapshot {
  return { ...s };
}

function snapshotsEqual(a: FormSnapshot, b: FormSnapshot): boolean {
  return (
    a.memo === b.memo &&
    a.alarmEnabled === b.alarmEnabled &&
    a.alarmHour === b.alarmHour &&
    a.alarmMinute === b.alarmMinute &&
    a.alarmBefore === b.alarmBefore &&
    a.editingId === b.editingId
  );
}

function scheduleToDraft(s: Schedule): FormSnapshot {
  return {
    memo: s.memo,
    alarmEnabled: s.alarmEnabled,
    alarmHour: s.alarmHour,
    alarmMinute: s.alarmMinute,
    alarmBefore: s.alarmBeforeMinutes,
    editingId: s.id,
  };
}

function defaultSearchRange(): { from: string; to: string } {
  const t = startOfToday();
  const from = addDays(t, -7);
  return { from: toDateKey(from), to: toDateKey(t) };
}

const state: {
  data: AppData;
  viewYear: number;
  viewMonth: number;
  selectedKey: string;
  draft: FormSnapshot;
  formBaseline: FormSnapshot;
  expanded: Expanded;
  anniversaryListVisible: boolean;
  swipedScheduleId: string | null;
  search: SearchState;
  modal: null | { message: string; onYes: () => void; onNo: () => void };
} = {
  data: loadData(),
  viewYear: 0,
  viewMonth: 0,
  selectedKey: "",
  draft: emptyFormSnapshot(),
  formBaseline: emptyFormSnapshot(),
  expanded: { schedule: false, anniversary: false, search: false },
  anniversaryListVisible: false,
  swipedScheduleId: null,
  search: (() => {
    const { from, to } = defaultSearchRange();
    return {
      fromKey: from,
      toKey: to,
      keyword: "",
      results: [],
      page: 0,
      hasSearched: false,
    };
  })(),
  modal: null,
};

function persist(): void {
  saveData(state.data);
}

function schedulesForDay(key: string): Schedule[] {
  return state.data.schedules.filter((s) => s.dateKey === key).sort((a, b) => a.memo.localeCompare(b.memo));
}

function anniversariesForDay(key: string): Anniversary[] {
  const d = parseDateKey(key);
  if (!d) return [];
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return state.data.anniversaries.filter((a) => a.month === m && a.day === day);
}

function dayHasSchedule(key: string): boolean {
  return state.data.schedules.some((s) => s.dateKey === key);
}

function dayHasAnniversary(key: string): boolean {
  return anniversariesForDay(key).length > 0;
}

function lunarDayLabel(year: number, month: number, day: number): string {
  try {
    const d = new Date(year, month - 1, day);
    const parts = new Intl.DateTimeFormat("ko-KR-u-ca-chinese", {
      day: "numeric",
    }).formatToParts(d);
    const p = parts.find((x) => x.type === "day");
    return p?.value ?? "";
  } catch {
    return "";
  }
}

function openModal(message: string, onYes: () => void, onNo: () => void): void {
  state.modal = { message, onYes, onNo };
  render();
}

function closeModal(): void {
  state.modal = null;
  render();
}

function performNavigate(targetKey: string, load?: Schedule | null, after?: () => void): void {
  state.selectedKey = targetKey;
  const vd = parseDateKey(targetKey);
  if (vd) {
    state.viewYear = vd.getFullYear();
    state.viewMonth = vd.getMonth() + 1;
  }
  if (load) {
    const d = scheduleToDraft(load);
    state.draft = d;
    state.formBaseline = cloneSnap(d);
  } else {
    const e = emptyFormSnapshot();
    state.draft = e;
    state.formBaseline = cloneSnap(e);
  }
  after?.();
  render();
}

function tryChangeDate(targetKey: string, load?: Schedule | null, after?: () => void): void {
  if (snapshotsEqual(state.draft, state.formBaseline)) {
    performNavigate(targetKey, load ?? null, after);
    return;
  }
  openModal(
    "등록 중인 내용이 있습니다. 날짜를 바꾸면 입력 내용이 지워질 수 있습니다. 계속할까요?",
    () => {
      closeModal();
      performNavigate(targetKey, load ?? null, after);
    },
    () => {
      closeModal();
      render();
    }
  );
}

function mountHoursSelect(): string {
  const opts = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${pad2(h)}시</option>`).join("");
  return `<select id="fld-hour" aria-label="알람 시">${opts}</select>`;
}

function mountMinutesSelect(): string {
  const opts = Array.from({ length: 60 }, (_, m) => `<option value="${m}">${pad2(m)}분</option>`).join("");
  return `<select id="fld-minute" aria-label="알람 분">${opts}</select>`;
}

function mountBeforeSelect(): string {
  return BEFORE_OPTIONS.map((o) => `<option value="${o.minutes}">${o.label}</option>`).join("");
}

function mountMonthSelect(id: string, selected: number): string {
  let html = "";
  for (let m = 1; m <= 12; m++) {
    html += `<option value="${m}" ${m === selected ? "selected" : ""}>${m}월</option>`;
  }
  return `<select id="${id}" aria-label="월">${html}</select>`;
}

function mountDaySelect(id: string, month: number, selected: number): string {
  const dim = daysInMonth(2024, month - 1);
  let html = "";
  for (let d = 1; d <= dim; d++) {
    html += `<option value="${d}" ${d === selected ? "selected" : ""}>${d}일</option>`;
  }
  return `<select id="${id}" aria-label="일">${html}</select>`;
}

function runSearch(): void {
  const from = state.search.fromKey;
  const to = state.search.toKey;
  const kw = state.search.keyword.trim().toLowerCase();
  const fd = parseDateKey(from);
  const td = parseDateKey(to);
  if (!fd || !td) {
    state.search.results = [];
    state.search.page = 0;
    state.search.hasSearched = true;
    return;
  }
  const fromT = fd.getTime();
  const toT = td.getTime();
  if (fromT > toT) {
    state.search.results = [];
    state.search.page = 0;
    state.search.hasSearched = true;
    return;
  }
  const out: Schedule[] = [];
  for (const s of state.data.schedules) {
    const d = parseDateKey(s.dateKey);
    if (!d) continue;
    const t = d.getTime();
    if (t < fromT || t > toT) continue;
    if (kw && !s.memo.toLowerCase().includes(kw)) continue;
    out.push(s);
  }
  out.sort((a, b) => {
    const c = a.dateKey.localeCompare(b.dateKey);
    return c !== 0 ? c : a.memo.localeCompare(b.memo);
  });
  state.search.results = out;
  state.search.page = 0;
  state.search.hasSearched = true;
}

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;

  const sel = state.selectedKey;
  const y = state.viewYear;
  const mo = state.viewMonth;
  const first = new Date(y, mo - 1, 1);
  const startWeekday = first.getDay();
  const dim = daysInMonth(y, mo - 1);
  const cells: string[] = [];
  for (let i = 0; i < startWeekday; i++) {
    cells.push(`<div class="cal-cell" disabled></div>`);
  }
  for (let d = 1; d <= dim; d++) {
    const key = `${y}-${pad2(mo)}-${pad2(d)}`;
    const lunar = lunarDayLabel(y, mo, d);
    const isToday = key === toDateKey(startOfToday());
    const isSel = key === sel;
    const hs = dayHasSchedule(key);
    const ha = dayHasAnniversary(key);
    const cls = [
      "cal-cell",
      isToday ? "cal-cell--today" : "",
      isSel ? "cal-cell--selected" : "",
      hs ? "cal-cell--has" : "",
      ha ? "cal-cell--anniv" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const dots =
      (hs ? `<span class="cal-dot" title="일정"></span>` : "") +
      (ha ? `<span class="cal-dot cal-dot--anniv" title="기념일"></span>` : "");
    cells.push(
      `<button type="button" class="${cls}" data-date="${key}" aria-pressed="${isSel}"><span class="cal-cell-num">${d}</span><span class="cal-cell-lunar">${escapeHtml(
        lunar
      )}</span>${
        dots ? `<span class="cal-dots">${dots}</span>` : ""
      }</button>`
    );
  }
  while (cells.length % 7 !== 0) cells.push(`<div class="cal-cell" disabled></div>`);
  while (cells.length < 42) cells.push(`<div class="cal-cell" disabled></div>`);

  const dayList = schedulesForDay(sel);
  const annivDay = anniversariesForDay(sel);

  const listItems: string[] = [];
  for (const a of annivDay) {
    listItems.push(
      `<li data-anniv="1" style="cursor:default;border-style:dashed"><strong>기념일</strong> · ${escapeHtml(
        a.content
      )}</li>`
    );
  }
  for (const s of dayList) {
    const alarmTxt = s.alarmEnabled
      ? `알람 ${pad2(s.alarmHour)}:${pad2(s.alarmMinute)}${
          s.alarmBeforeMinutes ? ` (${beforeLabel(s.alarmBeforeMinutes)} 전)` : ""
        }`
      : "알람 없음";
    listItems.push(
      `<li class="schedule-item ${state.swipedScheduleId === s.id ? "is-swiped" : ""}" data-sid="${escapeAttr(
        s.id
      )}"><button type="button" class="btn btn-small btn-danger swipe-delete-btn" data-del-sid="${escapeAttr(
        s.id
      )}">삭제</button><div class="schedule-content"><div>${escapeHtml(s.memo)}</div><div class="list-meta">${escapeHtml(
        alarmTxt
      )}</div></div></li>`
    );
  }

  const schChev = state.expanded.schedule ? "▼" : "▶";
  const annChev = state.expanded.anniversary ? "▼" : "▶";
  const seaChev = state.expanded.search ? "▼" : "▶";
  const d = state.draft;

  app.innerHTML = `
    <header class="app-header">일정 관리</header>

    <section class="card" aria-label="달력">
      <div class="card-body" style="border-top:none">
        <div class="cal-toolbar">
          <button type="button" class="cal-nav" id="nav-prev" aria-label="이전 달">&lt;</button>
          <div class="cal-center">
            <span class="cal-ym" id="ym-label">${y}년 ${mo}월</span>
            <button type="button" class="btn-today" id="btn-today">당일</button>
          </div>
          <button type="button" class="cal-nav" id="nav-next" aria-label="다음 달">&gt;</button>
        </div>
        <div class="cal-weekdays">
          <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
        </div>
        <div class="cal-grid">${cells.join("")}</div>
      </div>
    </section>

    <section class="card">
      <button type="button" class="card-title" id="toggle-schedule">
        <span>일정 · 메모</span><span class="chev">${schChev}</span>
      </button>
      <div class="card-body" id="panel-schedule" ${state.expanded.schedule ? "" : "hidden"}>
        <input type="hidden" id="fld-editing" value="${d.editingId ?? ""}" />
        <p class="hint">선택한 날짜: <strong id="lbl-sel">${sel}</strong></p>
        <div class="field">
          <label for="fld-memo">메모 입력</label>
          <textarea id="fld-memo" placeholder="내용을 입력하세요">${escapeHtml(d.memo)}</textarea>
        </div>
        <div class="field">
          <label><input type="checkbox" id="fld-alarm-on" ${d.alarmEnabled ? "checked" : ""} /> 알람 사용</label>
          <div id="alarm-fields" ${d.alarmEnabled ? "" : "hidden"}>
            <div class="row row-tight" style="margin-top:0.45rem">
              <div class="field" style="margin:0;flex:1">${mountHoursSelect()}</div>
              <div class="field" style="margin:0;flex:1">${mountMinutesSelect()}</div>
            </div>
            <div class="field" style="margin-bottom:0">
              <label for="fld-before">알림 시점</label>
              <select id="fld-before">${mountBeforeSelect()}</select>
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-primary" id="btn-save" style="width:100%">일정 저장</button>

        <div class="section-label">등록된 일정 내역</div>
        <ul class="list" id="day-list">${listItems.join("") || '<li style="cursor:default;color:var(--muted)">내역 없음</li>'}</ul>
      </div>
    </section>

    <section class="card">
      <button type="button" class="card-title" id="toggle-anniversary">
        <span>기념일</span><span class="chev">${annChev}</span>
      </button>
      <div class="card-body" id="panel-anniversary" ${state.expanded.anniversary ? "" : "hidden"}>
        <div class="anniv-toolbar">
          <button type="button" class="btn btn-small btn-inline" id="btn-anniv-add">기념일 추가</button>
          <button type="button" class="btn btn-small btn-inline" id="btn-anniv-list">기념일 내역</button>
        </div>
        <div id="anniv-form" hidden>
          <div class="field">
            <label>날짜 (월 / 일)</label>
            <div class="anniv-date-row">
              ${mountMonthSelect("anniv-month", new Date().getMonth() + 1)}
              <span class="anniv-sep">/</span>
              ${mountDaySelect("anniv-day", new Date().getMonth() + 1, new Date().getDate())}
            </div>
          </div>
          <div class="field">
            <label for="anniv-content">내용</label>
            <input type="text" id="anniv-content" placeholder="예: 결혼기념일" />
          </div>
          <button type="button" class="btn btn-primary" id="btn-anniv-save">기념일 저장</button>
        </div>
        <div id="anniv-list-wrap" ${state.anniversaryListVisible ? "" : "hidden"}>
          <ul class="list" id="anniv-list"></ul>
        </div>
      </div>
    </section>

    <section class="card">
      <button type="button" class="card-title" id="toggle-search">
        <span>전체 일정 검색</span><span class="chev">${seaChev}</span>
      </button>
      <div class="card-body" id="panel-search" ${state.expanded.search ? "" : "hidden"}>
        <div class="search-range">
          <div class="search-range-dates">
            <input type="date" id="q-from" value="${state.search.fromKey}" />
            <span class="search-tilde">~</span>
            <input type="date" id="q-to" value="${state.search.toKey}" />
          </div>
          <div class="search-keyword-row field" style="margin:0">
            <label for="q-kw">키워드 (선택)</label>
            <input type="text" id="q-kw" value="${escapeAttr(state.search.keyword)}" placeholder="단어를 입력하세요" />
          </div>
        </div>
        <button type="button" class="btn btn-primary" id="btn-search" style="width:100%;margin-top:0.65rem">검색</button>
        <div id="search-results" ${state.search.hasSearched ? "" : "hidden"}></div>
      </div>
    </section>

    ${
      state.modal
        ? `<div class="modal-backdrop" id="modal-root" role="dialog" aria-modal="true">
        <div class="modal">
          <p>${escapeHtml(state.modal.message)}</p>
          <div class="modal-actions">
            <button type="button" class="btn" id="modal-no">아니오</button>
            <button type="button" class="btn btn-primary" id="modal-yes">예</button>
          </div>
        </div>
      </div>`
        : ""
    }
  `;

  const hourEl = app.querySelector("#fld-hour") as HTMLSelectElement | null;
  const minEl = app.querySelector("#fld-minute") as HTMLSelectElement | null;
  const beforeEl = app.querySelector("#fld-before") as HTMLSelectElement | null;
  if (hourEl) hourEl.value = String(d.alarmHour);
  if (minEl) minEl.value = String(d.alarmMinute);
  if (beforeEl) beforeEl.value = String(d.alarmBefore);

  wireAnniversaryList(app);
  wireSearchResults(app);
  wireDraftSync(app);

  if (state.modal) {
    document.getElementById("modal-yes")?.addEventListener("click", () => state.modal?.onYes());
    document.getElementById("modal-no")?.addEventListener("click", () => state.modal?.onNo());
  }

  document.getElementById("nav-prev")?.addEventListener("click", () => {
    let nm = mo - 1;
    let ny = y;
    if (nm < 1) {
      nm = 12;
      ny -= 1;
    }
    state.viewYear = ny;
    state.viewMonth = nm;
    render();
  });

  document.getElementById("nav-next")?.addEventListener("click", () => {
    let nm = mo + 1;
    let ny = y;
    if (nm > 12) {
      nm = 1;
      ny += 1;
    }
    state.viewYear = ny;
    state.viewMonth = nm;
    render();
  });

  document.getElementById("btn-today")?.addEventListener("click", () => {
    tryChangeDate(toDateKey(startOfToday()), null);
  });

  app.querySelectorAll(".cal-cell[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = (btn as HTMLElement).dataset.date;
      if (!key) return;
      tryChangeDate(key, null);
    });
  });

  document.getElementById("toggle-schedule")?.addEventListener("click", () => {
    state.expanded.schedule = !state.expanded.schedule;
    render();
  });
  document.getElementById("toggle-anniversary")?.addEventListener("click", () => {
    state.expanded.anniversary = !state.expanded.anniversary;
    render();
  });
  document.getElementById("toggle-search")?.addEventListener("click", () => {
    state.expanded.search = !state.expanded.search;
    render();
  });

  document.getElementById("btn-save")?.addEventListener("click", async () => {
    const memo = state.draft.memo.trim();
    if (!memo) {
      alert("메모를 입력해 주세요.");
      return;
    }
    if (state.draft.alarmEnabled) {
      const ok = await ensureNotifyPermission();
      if (!ok) {
        alert("알림 권한이 필요합니다. 브라우저 설정에서 알림을 허용해 주세요.");
        return;
      }
    }
    const hour = state.draft.alarmHour;
    const minute = state.draft.alarmMinute;
    const before = state.draft.alarmBefore;
    const editing = state.draft.editingId;

    if (editing) {
      const idx = state.data.schedules.findIndex((s) => s.id === editing);
      if (idx >= 0) {
        state.data.schedules[idx] = {
          ...state.data.schedules[idx],
          dateKey: state.selectedKey,
          memo,
          alarmEnabled: state.draft.alarmEnabled,
          alarmHour: hour,
          alarmMinute: minute,
          alarmBeforeMinutes: before,
        };
      }
    } else {
      const s: Schedule = {
        id: crypto.randomUUID(),
        dateKey: state.selectedKey,
        memo,
        alarmEnabled: state.draft.alarmEnabled,
        alarmHour: hour,
        alarmMinute: minute,
        alarmBeforeMinutes: before,
      };
      state.data.schedules.push(s);
    }
    persist();
    const e = emptyFormSnapshot();
    state.draft = e;
    state.formBaseline = cloneSnap(e);
    render();
  });

  app.querySelectorAll("#day-list li[data-sid]").forEach((li) => {
    li.addEventListener("click", () => {
      const id = (li as HTMLElement).dataset.sid;
      if (!id) return;
      if ((li as HTMLElement).dataset.skipClick === "1") return;
      if (state.swipedScheduleId === id) {
        state.swipedScheduleId = null;
        render();
        return;
      }
      const s = state.data.schedules.find((x) => x.id === id);
      if (!s) return;
      const snap = scheduleToDraft(s);
      const apply = () => {
        state.draft = cloneSnap(snap);
        state.formBaseline = cloneSnap(snap);
        if (!state.expanded.schedule) state.expanded.schedule = true;
        render();
      };
      if (snapshotsEqual(state.draft, state.formBaseline)) {
        apply();
        return;
      }
      openModal(
        "편집 중인 내용이 있습니다. 다른 일정을 불러오면 현재 입력이 지워질 수 있습니다. 계속할까요?",
        () => {
          closeModal();
          apply();
        },
        () => {
          closeModal();
          render();
        }
      );
    });
  });

  app.querySelectorAll("#day-list button[data-del-sid]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = (btn as HTMLElement).dataset.delSid;
      if (!id) return;
      openModal(
        "선택한 일정을 삭제할까요?",
        () => {
          closeModal();
          state.swipedScheduleId = null;
          state.data.schedules = state.data.schedules.filter((x) => x.id !== id);
          if (state.draft.editingId === id) {
            const e = emptyFormSnapshot();
            state.draft = e;
            state.formBaseline = cloneSnap(e);
          }
          persist();
          render();
        },
        () => {
          closeModal();
          render();
        }
      );
    });
  });
  wireSwipeToDelete(app);

  document.getElementById("btn-anniv-add")?.addEventListener("click", () => {
    const form = document.getElementById("anniv-form");
    if (!form) return;
    form.hidden = !form.hidden;
  });

  document.getElementById("btn-anniv-list")?.addEventListener("click", () => {
    state.anniversaryListVisible = !state.anniversaryListVisible;
    render();
  });

  const am = app.querySelector("#anniv-month") as HTMLSelectElement | null;
  const ad = app.querySelector("#anniv-day") as HTMLSelectElement | null;
  am?.addEventListener("change", () => {
    if (!am || !ad) return;
    const month = Number(am.value);
    refreshDayOptions(ad, month, Number(ad.value));
  });

  document.getElementById("btn-anniv-save")?.addEventListener("click", () => {
    const month = Number((app.querySelector("#anniv-month") as HTMLSelectElement).value);
    const day = Number((app.querySelector("#anniv-day") as HTMLSelectElement).value);
    const content = (app.querySelector("#anniv-content") as HTMLInputElement).value.trim();
    if (!content) {
      alert("기념일 내용을 입력해 주세요.");
      return;
    }
    const a: Anniversary = {
      id: crypto.randomUUID(),
      month,
      day,
      content,
    };
    state.data.anniversaries.push(a);
    persist();
    (app.querySelector("#anniv-content") as HTMLInputElement).value = "";
    render();
  });

  document.getElementById("q-from")?.addEventListener("change", (e) => {
    state.search.fromKey = (e.target as HTMLInputElement).value;
  });
  document.getElementById("q-to")?.addEventListener("change", (e) => {
    state.search.toKey = (e.target as HTMLInputElement).value;
  });
  document.getElementById("q-kw")?.addEventListener("input", (e) => {
    state.search.keyword = (e.target as HTMLInputElement).value;
  });

  document.getElementById("btn-search")?.addEventListener("click", () => {
    state.search.fromKey = (app.querySelector("#q-from") as HTMLInputElement).value;
    state.search.toKey = (app.querySelector("#q-to") as HTMLInputElement).value;
    state.search.keyword = (app.querySelector("#q-kw") as HTMLInputElement).value;
    runSearch();
    render();
  });
}

function wireDraftSync(app: HTMLElement): void {
  const memo = app.querySelector("#fld-memo") as HTMLTextAreaElement | null;
  memo?.addEventListener("input", () => {
    state.draft.memo = memo.value;
  });
  const alarmOn = app.querySelector("#fld-alarm-on") as HTMLInputElement | null;
  const alarmFields = app.querySelector("#alarm-fields") as HTMLElement | null;
  alarmOn?.addEventListener("change", () => {
    state.draft.alarmEnabled = alarmOn.checked;
    if (alarmFields) alarmFields.hidden = !state.draft.alarmEnabled;
  });
  const hourEl = app.querySelector("#fld-hour") as HTMLSelectElement | null;
  const minEl = app.querySelector("#fld-minute") as HTMLSelectElement | null;
  const beforeEl = app.querySelector("#fld-before") as HTMLSelectElement | null;
  hourEl?.addEventListener("change", () => {
    state.draft.alarmHour = Number(hourEl.value);
  });
  minEl?.addEventListener("change", () => {
    state.draft.alarmMinute = Number(minEl.value);
  });
  beforeEl?.addEventListener("change", () => {
    state.draft.alarmBefore = Number(beforeEl.value);
  });
}

function wireSwipeToDelete(app: HTMLElement): void {
  const items = app.querySelectorAll("#day-list li.schedule-item[data-sid]");
  items.forEach((itemEl) => {
    const item = itemEl as HTMLElement;
    const id = item.dataset.sid;
    if (!id) return;
    const content = item.querySelector(".schedule-content") as HTMLElement | null;
    if (!content) return;
    let startX = 0;
    let startY = 0;
    let moved = false;
    let lockedHorizontal = false;
    const maxSwipe = 78;
    const openThreshold = 42;

    item.addEventListener(
      "touchstart",
      (ev) => {
        if (ev.touches.length !== 1) return;
        const t = ev.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        moved = false;
        lockedHorizontal = false;
        content.style.transition = "none";
      },
      { passive: true }
    );

    item.addEventListener(
      "touchmove",
      (ev) => {
        if (ev.touches.length !== 1) return;
        const t = ev.touches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (!lockedHorizontal) {
          if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
            lockedHorizontal = true;
          } else {
            return;
          }
        }
        if (!lockedHorizontal) return;
        if (dx < 0) {
          moved = true;
          const tx = Math.max(dx, -maxSwipe);
          content.style.transform = `translateX(${tx}px)`;
          ev.preventDefault();
        }
      },
      { passive: false }
    );

    item.addEventListener("touchend", () => {
      content.style.transition = "";
      if (!moved) {
        content.style.transform = "";
        return;
      }
      const matrix = getComputedStyle(content).transform;
      let x = 0;
      if (matrix && matrix !== "none") {
        const m = new DOMMatrixReadOnly(matrix);
        x = m.m41;
      }
      state.swipedScheduleId = x <= -openThreshold ? id : null;
      item.dataset.skipClick = "1";
      setTimeout(() => {
        delete item.dataset.skipClick;
      }, 150);
      render();
    });
  });
}

function beforeLabel(minutes: number): string {
  const f = BEFORE_OPTIONS.find((o) => o.minutes === minutes);
  return f?.label ?? `${minutes}분`;
}

function refreshDayOptions(sel: HTMLSelectElement, month: number, keepDay: number): void {
  const dim = daysInMonth(2024, month - 1);
  const d = Math.min(keepDay, dim);
  let html = "";
  for (let i = 1; i <= dim; i++) {
    html += `<option value="${i}" ${i === d ? "selected" : ""}>${i}일</option>`;
  }
  sel.innerHTML = html;
}

function wireAnniversaryList(app: HTMLElement): void {
  const ul = app.querySelector("#anniv-list");
  if (!ul) return;
  const sorted = [...state.data.anniversaries].sort((a, b) => {
    const c = a.month - b.month;
    return c !== 0 ? c : a.day - b.day || a.content.localeCompare(b.content);
  });
  ul.innerHTML = sorted
    .map(
      (a) =>
        `<li data-aid="${escapeAttr(a.id)}"><div><strong>${a.month}.${pad2(a.day)}</strong> · ${escapeHtml(
          a.content
        )}</div><div class="list-meta"><button type="button" class="btn btn-small" data-del="${escapeAttr(
          a.id
        )}">삭제</button></div></li>`
    )
    .join("");
  ul.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = (btn as HTMLElement).dataset.del;
      if (!id) return;
      state.data.anniversaries = state.data.anniversaries.filter((x) => x.id !== id);
      persist();
      render();
    });
  });
}

function wireSearchResults(app: HTMLElement): void {
  const wrap = app.querySelector("#search-results") as HTMLElement | null;
  if (!wrap || !state.search.hasSearched) return;
  const total = state.search.results.length;
  const start = state.search.page * PAGE;
  const slice = state.search.results.slice(start, start + PAGE);
  const pages = Math.max(1, Math.ceil(total / PAGE) || 1);
  wrap.innerHTML = `
    <p class="hint" style="margin-top:0.65rem">총 ${total}건</p>
    <ul class="list" id="search-list">
      ${slice
        .map(
          (s) =>
            `<li data-goto="${escapeAttr(s.dateKey)}" data-sid="${escapeAttr(s.id)}">
            <div><strong>${escapeHtml(s.dateKey)}</strong></div>
            <div>${escapeHtml(s.memo)}</div>
          </li>`
        )
        .join("") || '<li style="cursor:default;color:var(--muted)">결과 없음</li>'}
    </ul>
    <div class="pager">
      <button type="button" class="btn btn-small" id="pg-prev" ${state.search.page <= 0 ? "disabled" : ""}>이전</button>
      <span>${state.search.page + 1} / ${pages}</span>
      <button type="button" class="btn btn-small" id="pg-next" ${
        state.search.page >= pages - 1 ? "disabled" : ""
      }>다음</button>
    </div>
  `;
  wrap.querySelectorAll("#search-list li[data-goto]").forEach((li) => {
    li.addEventListener("click", () => {
      const key = (li as HTMLElement).dataset.goto;
      const sid = (li as HTMLElement).dataset.sid;
      if (!key || !sid) return;
      const s = state.data.schedules.find((x) => x.id === sid);
      if (!s) return;
      tryChangeDate(key, s, () => {
        state.expanded.schedule = true;
      });
    });
  });
  document.getElementById("pg-prev")?.addEventListener("click", () => {
    if (state.search.page > 0) {
      state.search.page -= 1;
      render();
    }
  });
  document.getElementById("pg-next")?.addEventListener("click", () => {
    const pages = Math.max(1, Math.ceil(state.search.results.length / PAGE));
    if (state.search.page < pages - 1) {
      state.search.page += 1;
      render();
    }
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function boot(): void {
  const t = startOfToday();
  state.viewYear = t.getFullYear();
  state.viewMonth = t.getMonth() + 1;
  state.selectedKey = toDateKey(t);
  const e = emptyFormSnapshot();
  state.draft = e;
  state.formBaseline = cloneSnap(e);
  render();
  setInterval(() => checkAndFireAlarms(state.data.schedules), 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkAndFireAlarms(state.data.schedules);
  });
}

boot();
