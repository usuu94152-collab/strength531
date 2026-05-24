const SHEET_ID = "1vJrBXlVso_zSf7xR71I91cK2nswdYe9KoUi0udtDnUo";
const LIFT_SHEETS = ["Squat", "Bench Press", "Deadlift"];
const STORAGE_KEYS = {
  strength: "strength-log.local-strength",
};

const state = {
  selectedLift: "Squat",
  activeView: "search",
  sheetRecords: [],
  localStrength: [],
  lastSync: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", () => {
  setDefaultDates();
  loadLocalRecords();
  bindEvents();
  applyInitialFilters();
  updateSearchStep();
  refreshSheetData();
  render();
});

function bindEvents() {
  $("#refreshButton").addEventListener("click", refreshSheetData);
  $("#clearSearchButton").addEventListener("click", () => {
    $("#weightSearch").value = "";
    render();
  });
  $("#weightSearch").addEventListener("input", render);
  $("#weightUnit").addEventListener("change", () => {
    updateSearchStep();
    render();
  });
  $("#strengthForm").addEventListener("submit", addStrengthRecord);

  $$("[data-view-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView(button.dataset.viewTab);
    });
  });

  $$(".segmented button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedLift = button.dataset.lift;
      updateLiftButtons();
      $("#strengthMovement").value = state.selectedLift;
      updateSearchStep();
      render();
    });
  });
}

function setActiveView(view) {
  state.activeView = view;
  $$("[data-view-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTab === view);
  });
  $$("[data-view]").forEach((section) => {
    section.classList.toggle("active", section.dataset.view === view);
  });
}

function applyInitialFilters() {
  const params = new URLSearchParams(window.location.search);
  const lift = params.get("lift");
  const weight = params.get("weight");
  const view = params.get("view") === "progress" ? "e1rm" : params.get("view");
  const unit = params.get("unit");

  if (LIFT_SHEETS.includes(lift)) {
    state.selectedLift = lift;
    $("#strengthMovement").value = lift;
    updateLiftButtons();
  }

  if (weight) {
    $("#weightSearch").value = weight;
  }

  if (unit === "kg" || unit === "lb") {
    $("#weightUnit").value = unit;
  }

  if (view === "crossfit") {
    setActiveView("search");
  } else if (["search", "weights", "e1rm", "input"].includes(view)) {
    setActiveView(view);
  }
}

function updateLiftButtons() {
  $$("[data-lift]").forEach((button) => {
    button.classList.toggle("active", button.dataset.lift === state.selectedLift);
  });
}

function updateSearchStep() {
  const input = $("#weightSearch");
  const unit = $("#weightUnit").value;
  const kgStep = state.selectedLift === "Bench Press" ? 2.5 : 5;

  input.step = unit === "lb" ? "5" : String(kgStep);
  input.placeholder = unit === "lb" ? "예: 295" : `예: ${kgStep === 2.5 ? "97.5" : "130"}`;
  $("#searchRangeHint").textContent = `같은 중량 우선 · ${formatKg(getAutoTolerance())} 주변 기록 포함`;
}

function setDefaultDates() {
  const today = new Date().toISOString().slice(0, 10);
  $("#strengthDate").value = today;
}

function loadLocalRecords() {
  state.localStrength = JSON.parse(localStorage.getItem(STORAGE_KEYS.strength) || "[]");
}

function saveLocalRecords() {
  localStorage.setItem(STORAGE_KEYS.strength, JSON.stringify(state.localStrength));
}

async function refreshSheetData() {
  $("#syncStatus").textContent = "시트 데이터를 불러오는 중입니다.";
  $("#syncStatus").classList.remove("error-text");

  try {
    const results = await Promise.all(
      LIFT_SHEETS.map(async (sheetName) => {
        const csv = await fetchCsv(sheetName);
        return parseCsv(csv)
          .map((row) => normalizeSheetRow(row, sheetName))
          .filter(Boolean);
      }),
    );

    state.sheetRecords = results.flat();
    state.lastSync = new Date();
    render();
  } catch (error) {
    $("#syncStatus").textContent = `시트 동기화 실패: ${error.message}`;
    $("#syncStatus").classList.add("error-text");
  }
}

async function fetchCsv(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    sheetName,
  )}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${sheetName} ${response.status}`);
  }

  return response.text();
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift() || [];
  return rows
    .filter((values) => values.some((value) => value.trim()))
    .map((values) =>
      headers.reduce((record, header, index) => {
        record[header.trim()] = (values[index] || "").trim();
        return record;
      }, {}),
    );
}

function normalizeSheetRow(row, sheetName) {
  const date = row["날짜"];
  const movement = row["종목"] || sheetName;
  const weight = toNumber(row["중량(kg)"]);
  const reps = toNumber(row["반복수"]);
  const e1rm = toNumber(row["추정1RM(kg)"]);
  const tm = toNumber(row["TM(kg)"]);

  if (!date || !movement || !e1rm) {
    return null;
  }

  return {
    id: `sheet-${movement}-${date}-${weight}-${reps}-${e1rm}`,
    date,
    movement,
    weight,
    reps,
    e1rm,
    tm,
    note: row["메모"] || "",
    source: "sheet",
  };
}

function addStrengthRecord(event) {
  event.preventDefault();

  const weight = toNumber($("#strengthWeight").value);
  const reps = toNumber($("#strengthReps").value);
  const record = {
    id: `app-${Date.now()}`,
    date: $("#strengthDate").value,
    movement: $("#strengthMovement").value,
    weight,
    reps,
    e1rm: roundOne(weight * (1 + reps / 30)),
    tm: toNumber($("#strengthTm").value),
    note: $("#strengthNote").value.trim(),
    source: "app",
  };

  state.localStrength.push(record);
  saveLocalRecords();
  $("#strengthForm").reset();
  setDefaultDates();
  $("#strengthMovement").value = state.selectedLift;
  render();
}

function render() {
  const records = getStrengthRecords();
  const selectedRecords = records.filter((record) => record.movement === state.selectedLift);
  const searchedRecords = getSearchResults(selectedRecords);

  renderSummary(records);
  renderStatus();
  renderSearchSummary(selectedRecords, searchedRecords);
  renderWeightGroups(selectedRecords);
  renderTable(searchedRecords);
}

function getStrengthRecords() {
  return [...state.sheetRecords, ...state.localStrength].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
}

function getSearchValue() {
  const value = toNumber($("#weightSearch").value);
  return getSearchUnit() === "lb" ? lbToKg(value) : value;
}

function getRawSearchValue() {
  return toNumber($("#weightSearch").value);
}

function getSearchUnit() {
  return $("#weightUnit").value;
}

function getSearchResults(records) {
  const target = getSearchValue();

  if (!target) {
    return records;
  }

  const exactMatches = records.filter((record) => record.weight && Math.abs(record.weight - target) < 0.05);

  if (exactMatches.length) {
    return exactMatches;
  }

  const tolerance = getAutoTolerance();

  return records.filter((record) => {
    if (!record.weight) {
      return false;
    }

    const diff = Math.abs(record.weight - target);
    return diff <= tolerance;
  });
}

function getAutoTolerance() {
  return state.selectedLift === "Bench Press" ? 2.5 : 5;
}

function renderSummary(records) {
  const bestByLift = Object.fromEntries(
    LIFT_SHEETS.map((lift) => [
      lift,
      records
        .filter((record) => record.movement === lift)
        .reduce((best, record) => Math.max(best, record.e1rm || 0), 0),
    ]),
  );

  $("#squatBest").textContent = formatKg(bestByLift.Squat);
  $("#benchBest").textContent = formatKg(bestByLift["Bench Press"]);
  $("#deadliftBest").textContent = formatKg(bestByLift.Deadlift);

  const latest = records[0];
  $("#latestRecord").textContent = latest
    ? `${formatShortDate(latest.date)} ${shortMovement(latest.movement)}`
    : "-";
}

function renderStatus() {
  if (!state.lastSync) {
    return;
  }

  const sheetCount = state.sheetRecords.length;
  const appCount = state.localStrength.length;
  $("#syncStatus").textContent = `시트 ${sheetCount}개, 앱 입력 ${appCount}개 · ${state.lastSync.toLocaleTimeString(
    "ko-KR",
    { hour: "2-digit", minute: "2-digit" },
  )} 동기화`;
}

function renderSearchSummary(selectedRecords, searchedRecords) {
  const target = getSearchValue();
  const rawTarget = getRawSearchValue();
  const searchUnit = getSearchUnit();
  const records = target ? searchedRecords : selectedRecords;
  const latest = records[0];

  const title = target
    ? `${state.selectedLift} ${formatSearchWeight(rawTarget, searchUnit, target)} 검색 결과`
    : `${state.selectedLift} 전체 기록`;
  $("#historyTitle").textContent = title;

  const summaryItems = target
    ? [
        {
          label: "최근 수행",
          value: latest ? `${formatDisplayWeight(latest.weight, searchUnit)} x ${latest.reps}` : "-",
          detail: latest ? `${latest.date} · 검색 ${records.length}개` : "기록 없음",
        },
        {
          label: searchUnit === "lb" ? "킬로그램 환산" : "파운드 환산",
          value: formatDisplayWeight(target, searchUnit),
          detail: searchUnit === "lb" ? `${rawTarget}lb 입력` : `${formatKg(target)} 입력`,
        },
      ]
    : [
        {
          label: "전체 기록",
          value: `${records.length}개`,
          detail: state.selectedLift,
        },
        {
          label: "최근 수행",
          value: latest ? `${formatDisplayWeight(latest.weight, searchUnit)} x ${latest.reps}` : "-",
          detail: latest ? latest.date : "기록 없음",
        },
      ];

  $("#searchSummary").innerHTML = summaryItems
    .map(
      (item) => `
        <article class="result-card">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
          <p>${escapeHtml(item.detail)}</p>
        </article>
      `,
    )
    .join("");
}

function renderWeightGroups(records) {
  const groups = new Map();

  records.forEach((record) => {
    if (!record.weight) {
      return;
    }

    const key = String(record.weight);
    const group = groups.get(key) || {
      weight: record.weight,
      count: 0,
      bestReps: 0,
      bestE1rm: 0,
      latest: "",
    };

    group.count += 1;
    group.bestReps = Math.max(group.bestReps, record.reps || 0);
    group.bestE1rm = Math.max(group.bestE1rm, record.e1rm || 0);
    group.latest = !group.latest || record.date > group.latest ? record.date : group.latest;
    groups.set(key, group);
  });

  const sortedGroups = Array.from(groups.values()).sort((a, b) => b.weight - a.weight);
  $("#weightGroupCount").textContent = `${sortedGroups.length}개`;
  $("#weightGroupsTitle").textContent = `${state.selectedLift} 중량별 기록`;
  $("#weightGroups").innerHTML = sortedGroups.length
    ? sortedGroups
        .map(
          (group) => `
          <button class="weight-card" type="button" data-weight="${group.weight}">
            <span>${formatKg(group.weight)}</span>
            <strong>${group.bestReps}회</strong>
            <small>${formatLb(group.weight)} · ${group.count}회 수행 · 최고 ${formatKg(group.bestE1rm)}</small>
          </button>
        `,
        )
        .join("")
    : `<div class="empty-state">중량 기록이 없습니다.</div>`;

  $$(".weight-card").forEach((button) => {
    button.addEventListener("click", () => {
      $("#weightSearch").value = button.dataset.weight;
      $("#weightUnit").value = "kg";
      updateSearchStep();
      setActiveView("search");
      render();
    });
  });
}

function renderTable(records) {
  $("#recordCount").textContent = `${records.length}개`;
  $("#recordsTable").innerHTML = records.length
    ? records
        .map(
          (record) => `
        <tr>
          <td>${escapeHtml(record.date)}</td>
          <td><strong>${record.weight ? formatKg(record.weight) : "-"}</strong></td>
          <td>${record.reps || "-"}</td>
          <td>${formatKg(record.e1rm)}</td>
          <td>${record.tm ? formatKg(record.tm) : "-"}</td>
          <td><span class="source-pill source-${record.source}">${record.source === "sheet" ? "Sheet" : "App"}</span></td>
          <td>${escapeHtml(record.note || "")}</td>
        </tr>
      `,
        )
        .join("")
    : `<tr><td colspan="7">조건에 맞는 기록이 없습니다.</td></tr>`;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

function formatKg(value) {
  return value ? `${roundOne(value)}kg` : "-";
}

function formatLb(value) {
  return value ? `${Math.round(value / 0.45359237)}lb` : "-";
}

function formatSearchWeight(rawValue, unit, kgValue) {
  return unit === "lb" ? `${rawValue}lb (${formatKg(kgValue)})` : formatKg(kgValue);
}

function formatDisplayWeight(kgValue, inputUnit) {
  return inputUnit === "lb"
    ? `${formatLbExact(kgValue)} (${formatKg(kgValue)})`
    : `${formatKg(kgValue)} (${formatLbExact(kgValue)})`;
}

function formatLbExact(value) {
  return value ? `${roundOne(value / 0.45359237)}lb` : "-";
}

function nearestLb(value) {
  return Math.round(value / 0.45359237 / 5) * 5;
}

function formatNearestLb(value) {
  return value ? `약 ${nearestLb(value)}lb` : "-";
}

function lbToKg(value) {
  return roundOne(value * 0.45359237);
}

function formatShortDate(value) {
  return value.slice(5).replace("-", ".");
}

function shortMovement(value) {
  return value === "Bench Press" ? "Bench" : value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
