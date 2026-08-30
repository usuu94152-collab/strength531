const SHEET_ID = "1vJrBXlVso_zSf7xR71I91cK2nswdYe9KoUi0udtDnUo";
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxWgV__IgjjrtbRQ7F-N3-UzsQWHY94ihQ1VcMFB3qcVAGme8AKWlCVjkIh9RYQSmqR/exec";
const LIFT_SHEETS = ["Squat", "Bench Press", "Deadlift"];
const VIEW_META = {
  search: { eyebrow: "검색 · WEIGHT", title: "중량 검색" },
  weights: { eyebrow: "기록 · BY WEIGHT", title: "중량별" },
  cycle: { eyebrow: "사이클 · TM", title: "중량표" },
  input: { eyebrow: "새 기록 · NEW ENTRY", title: "기록 추가" },
  convert: { eyebrow: "환산 · KG ↔ LB", title: "단위 환산" },
};
const KG_TO_LB = 0.45359237;
const CONVERT_KG_PRESETS = [20, 40, 60, 80, 100, 120, 140, 160];
const CONVERT_LB_PRESETS = [45, 95, 135, 185, 225, 315, 405, 495];
const TOP_SET_PERCENTAGES = [85, 90, 95];
const FSL_RULES = {
  85: "70% x 5x10",
  90: "65-70% x 5x10",
  95: "60-65% x 5x8-10",
};
const TM_STORAGE_KEY = "strength-log-tm-overrides";
const UNDATED_SORT_KEY = "9999-12-31";
const WAVE_PLAN = {
  1: { early: 85, late: 90 },
  2: { early: 95, late: 85 },
  3: { early: 90, late: 95 },
  4: { early: null, late: null },
};

const state = {
  selectedLift: "Squat",
  activeView: "search",
  sheetRecords: [],
  lastSync: null,
  tmOverrides: loadTmOverrides(),
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const setText = (selector, value) => {
  const element = $(selector);
  if (element) {
    element.textContent = value;
  }
};

document.addEventListener("DOMContentLoaded", () => {
  setDefaultDates();
  bindEvents();
  applyInitialFilters();
  updateSearchStep();
  renderConvertPresets();
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
  $("#strengthWeight").addEventListener("input", renderE1rmPreview);
  $("#strengthReps").addEventListener("input", renderE1rmPreview);
  $("#strengthForm").addEventListener("submit", addStrengthRecord);

  $("#convertKg").addEventListener("input", () => syncConvert("kg"));
  $("#convertLb").addEventListener("input", () => syncConvert("lb"));

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
  if (view === "e1rm") {
    view = "cycle";
  }

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
  const viewParam = params.get("view");
  const view = viewParam === "progress" || viewParam === "e1rm" ? "cycle" : viewParam;
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
  } else if (["search", "weights", "cycle", "input", "convert"].includes(view)) {
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
  if (!input) {
    return;
  }

  const unit = getSearchUnit();
  const kgStep = state.selectedLift === "Bench Press" ? 2.5 : 5;

  input.step = unit === "lb" ? "5" : String(kgStep);
  input.placeholder = unit === "lb" ? "295" : kgStep === 2.5 ? "97.5" : "130";
  setText("#searchUnitLabel", unit);
  setText("#searchRangeHint", `같은 중량 우선 · ${formatKg(getAutoTolerance())} 주변 기록 포함`);
  renderConversionHint();
}

function setDefaultDates() {
  $("#strengthDate").value = getLocalDateValue();
}

function getLocalDateValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function refreshSheetData() {
  $("#syncStatus").textContent = "시트 데이터를 불러오는 중입니다.";
  $("#syncStatus").classList.remove("error-text");

  try {
    const results = await Promise.all(
      LIFT_SHEETS.map(async (sheetName) => {
        const rows = await fetchSheetRows(sheetName);
        return rows
          .map((row, index) => normalizeSheetRow(row, sheetName, index))
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

function fetchSheetRows(sheetName) {
  return new Promise((resolve, reject) => {
    const callbackName = `__strengthLogSheet_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${sheetName} 응답 지연`));
    }, 12000);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (response) => {
      cleanup();
      if (response.status !== "ok") {
        reject(new Error(`${sheetName} ${response.status || "조회 실패"}`));
        return;
      }
      resolve(parseGvizTable(response.table));
    };

    script.onerror = () => {
      cleanup();
      reject(new Error(`${sheetName} 스크립트 로드 실패`));
    };
    script.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json;responseHandler:${callbackName}&sheet=${encodeURIComponent(
      sheetName,
    )}`;
    document.body.appendChild(script);
  });
}

function parseGvizTable(table) {
  const headers = (table?.cols || []).map((column) => column.label);
  return (table?.rows || [])
    .map((row) =>
      headers.reduce((record, header, index) => {
        record[header] = normalizeGvizCell(row.c?.[index]);
        return record;
      }, {}),
    )
    .filter((record) => Object.values(record).some((value) => value !== ""));
}

function normalizeGvizCell(cell) {
  if (!cell) {
    return "";
  }
  if (cell.f) {
    return cell.f;
  }
  if (typeof cell.v === "string" && cell.v.startsWith("Date(")) {
    return formatGvizDate(cell.v);
  }
  return cell.v ?? "";
}

function formatGvizDate(value) {
  const parts = value.match(/\d+/g)?.map(Number);
  if (!parts || parts.length < 3) {
    return value;
  }

  const [year, zeroBasedMonth, day] = parts;
  return `${year}-${String(zeroBasedMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeSheetRow(row, sheetName, index) {
  const date = String(row["날짜"] || "").trim();
  const movement = row["종목"] || sheetName;
  const weight = toNumber(row["중량(kg)"]);
  const reps = toNumber(row["반복수"]);

  if (!movement || weight <= 0 || reps <= 0) {
    return null;
  }

  return {
    id: `sheet-${sheetName}-${index}`,
    date,
    sortDate: date || UNDATED_SORT_KEY,
    movement,
    weight,
    reps,
    e1rm: toNumber(row["추정1RM(kg)"]) || estimateE1rm(weight, reps),
    tm: toNumber(row["TM(kg)"]),
    note: row["메모"] || "",
    source: "sheet",
  };
}

async function addStrengthRecord(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const weight = toNumber($("#strengthWeight").value);
  const reps = toNumber($("#strengthReps").value);
  const record = {
    date: $("#strengthDate").value,
    movement: $("#strengthMovement").value,
    weight,
    reps,
    e1rm: estimateE1rm(weight, reps),
    tm: toNumber($("#strengthTm").value),
    note: $("#strengthNote").value.trim(),
    source: "app",
  };

  submitButton.disabled = true;
  submitButton.textContent = "전송 중";
  $("#syncStatus").textContent = "구글 시트에 기록하는 중입니다.";
  $("#syncStatus").classList.remove("error-text");

  try {
    await submitStrengthRecord(record);
    state.selectedLift = record.movement;
    updateLiftButtons();
    $("#weightSearch").value = record.weight;
    $("#weightUnit").value = "kg";
    $("#strengthForm").reset();
    setDefaultDates();
    $("#strengthMovement").value = state.selectedLift;
    updateSearchStep();
    setActiveView("search");
    $("#syncStatus").textContent = "기록했습니다. 시트를 다시 불러오는 중입니다.";
    await wait(1800);
    await refreshSheetData();
  } catch (error) {
    $("#syncStatus").textContent = `시트 기록 실패: ${error.message}`;
    $("#syncStatus").classList.add("error-text");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "기록 추가";
  }
}

async function submitStrengthRecord(record) {
  const body = new URLSearchParams();
  Object.entries(record).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      body.append(key, String(value));
    }
  });

  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    body,
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function render() {
  const records = getStrengthRecords();
  const selectedRecords = records.filter((record) => record.movement === state.selectedLift);
  const searchedRecords = getSearchResults(selectedRecords);

  renderSummary(records);
  renderCycleBanner(records);
  renderCycleWeights(records);
  renderStatus();
  renderSearchSummary(selectedRecords, searchedRecords);
  renderWeightGroups(selectedRecords);
  renderTable(searchedRecords);
  renderConversionHint();
  renderE1rmPreview();
}

function getStrengthRecords() {
  return [...state.sheetRecords].sort((a, b) => b.sortDate.localeCompare(a.sortDate));
}

function getSearchValue() {
  const value = toNumber($("#weightSearch").value);
  return getSearchUnit() === "lb" ? lbToKg(value) : value;
}

function getRawSearchValue() {
  return toNumber($("#weightSearch").value);
}

function getSearchUnit() {
  return $("#weightUnit")?.value || "kg";
}

function getSearchResults(records) {
  const target = getSearchValue();

  if (!target) {
    return records;
  }

  const tolerance = getAutoTolerance();

  return records
    .filter((record) => record.weight && Math.abs(record.weight - target) <= tolerance)
    .sort((a, b) => {
      const diffA = Math.abs(a.weight - target);
      const diffB = Math.abs(b.weight - target);
      return diffA - diffB || b.sortDate.localeCompare(a.sortDate);
    });
}

function getAutoTolerance() {
  return state.selectedLift === "Bench Press" ? 2.5 : 5;
}

function renderSummary(records) {
  const bestByLift = Object.fromEntries(LIFT_SHEETS.map((lift) => [lift, getBestRecord(records, lift)]));
  const firstByLift = Object.fromEntries(LIFT_SHEETS.map((lift) => [lift, getFirstRecord(records, lift)]));

  renderBestLift("squat", bestByLift.Squat, firstByLift.Squat);
  renderBestLift("bench", bestByLift["Bench Press"], firstByLift["Bench Press"]);
  renderBestLift("deadlift", bestByLift.Deadlift, firstByLift.Deadlift);

  const latest = records[0];
  setText(
    "#latestRecord",
    latest ? `${formatShortDate(latest.date)} ${shortMovement(latest.movement)}` : "-",
  );
}

function renderBestLift(prefix, record, firstRecord) {
  $(`#${prefix}Best`).textContent = record ? formatKg(record.e1rm) : "-";
  $(`#${prefix}Meta`).textContent = record
    ? `${formatKg(record.weight)} x ${record.reps || "-"} · TM ${record.tm ? formatKg(record.tm) : "-"} · ${formatDotDate(record.date)}`
    : "기록 없음";

  const deltaElement = $(`#${prefix}Delta`);
  if (!deltaElement) {
    return;
  }

  const delta = record && firstRecord ? roundOne(record.e1rm - firstRecord.e1rm) : 0;
  deltaElement.textContent = record && firstRecord ? formatDeltaKg(delta) : "-";
  deltaElement.classList.toggle("negative", delta < 0);
  deltaElement.classList.toggle("flat", Math.abs(delta) < 0.05);
}

function getBestRecord(records, lift) {
  return records
    .filter((record) => record.movement === lift)
    .reduce((best, record) => (!best || (record.e1rm || 0) > (best.e1rm || 0) ? record : best), null);
}

function getFirstRecord(records, lift) {
  return records
    .filter((record) => record.movement === lift && record.e1rm)
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate))[0];
}

function renderCycleBanner(records) {
  const { cycle, week } = computeCycle(records);
  const cycleLabel = $("#cycleLabel");
  if (cycleLabel) {
    cycleLabel.textContent = `Cycle ${cycle} · Week ${week}`;
  }
  $$("[data-cycle-dot]").forEach((dot, index) => {
    dot.classList.toggle("filled", index < week);
  });
  $$("[data-cycle-view-dot]").forEach((dot, index) => {
    dot.classList.toggle("filled", index < week);
  });
}

function computeCycle(records) {
  const tmRecords = records
    .filter((record) => record.date && record.tm)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!tmRecords.length) {
    return { cycle: 1, week: 1 };
  }

  const anchorDate = tmRecords[0].date;
  const lastTmByLift = {};
  const boundaryDates = [];

  tmRecords.forEach((record) => {
    const previousTm = lastTmByLift[record.movement];
    if (previousTm && record.tm > previousTm) {
      boundaryDates.push(record.date);
    }
    lastTmByLift[record.movement] = record.tm;
  });

  const uniqueBoundaries = Array.from(new Set(boundaryDates)).sort();
  const cycle = 1 + uniqueBoundaries.length;
  const cycleStart = uniqueBoundaries.at(-1) || anchorDate;
  const days = Math.max(0, Math.floor((parseLocalDate(getLocalDateValue()) - parseLocalDate(cycleStart)) / 86400000));
  const week = Math.min(4, Math.floor(days / 7) + 1);

  return { cycle, week };
}

function renderCycleWeights(records) {
  const { week } = computeCycle(records);
  const percent = getTodayTopSetPercent(week);

  const latestTmByLift = getLatestTmByLift(records);
  $("#cycleWeights").innerHTML = LIFT_SHEETS.map((lift) => {
    const tmRecord = latestTmByLift[lift];
    const overrideTm = state.tmOverrides[lift] || 0;
    const tm = overrideTm || tmRecord?.tm || 0;
    const tmSource = overrideTm
      ? "앱에서 수정한 TM"
      : tmRecord
        ? `${tmRecord.date ? formatDotDate(tmRecord.date) : "최근"} TM 기준`
        : "TM 기록 없음";
    const percentages = TOP_SET_PERCENTAGES.map((item) => {
      const weight = roundTrainingWeight(tm * (item / 100));
      const isToday = item === percent;
      return `
        <button class="percent-chip ${isToday ? "active" : ""}" type="button" data-cycle-lift="${lift}" data-cycle-weight="${weight}" ${tm ? "" : "disabled"}>
          <span>${item}%</span>
          <strong>${tm ? formatKg(weight) : "-"}</strong>
        </button>
      `;
    }).join("");

    return `
      <article class="cycle-weight-card">
        <div class="cycle-weight-head">
          <div>
            <span>${koreanMovement(lift)}</span>
            <small>${escapeHtml(shortMovement(lift))}</small>
          </div>
          <strong>${tm ? formatKg(tm) : "-"}</strong>
        </div>
        <div class="tm-edit-row">
          <input class="tm-input" type="number" min="0" step="5" value="${tm || ""}" data-tm-input="${lift}" aria-label="${koreanMovement(lift)} TM" />
          <button class="tm-save-button" type="button" data-tm-save="${lift}">TM 저장</button>
        </div>
        <div class="percent-grid">${percentages}</div>
        <div class="fsl-row">
          <span>FSL</span>
          <strong>${percent ? getFslText(tm, percent) : "디로드 또는 보조운동"}</strong>
        </div>
        <p>${tmSource}</p>
      </article>
    `;
  }).join("");

  $$("[data-tm-save]").forEach((button) => {
    button.addEventListener("click", () => {
      saveTmOverride(button.dataset.tmSave);
    });
  });

  $$("[data-tm-input]").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveTmOverride(input.dataset.tmInput);
      }
    });
  });

  $$("[data-cycle-weight]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedLift = button.dataset.cycleLift;
      $("#weightSearch").value = button.dataset.cycleWeight;
      $("#weightUnit").value = "kg";
      updateLiftButtons();
      updateSearchStep();
      setActiveView("search");
      render();
    });
  });
}

function saveTmOverride(lift) {
  const input = $(`[data-tm-input="${cssEscape(lift)}"]`);
  const tm = roundTrainingWeight(toNumber(input.value));

  if (!tm) {
    delete state.tmOverrides[lift];
  } else {
    state.tmOverrides[lift] = tm;
  }

  saveTmOverrides();
  render();
}

function getLatestTmByLift(records) {
  return Object.fromEntries(
    LIFT_SHEETS.map((lift) => [
      lift,
      records
        .filter((record) => record.movement === lift && record.tm)
        .sort((a, b) => b.sortDate.localeCompare(a.sortDate))[0],
    ]),
  );
}

function getTodayTopSetPercent(week) {
  const plan = WAVE_PLAN[week];
  if (!plan) {
    return null;
  }

  const day = new Date().getDay();
  if (day >= 1 && day <= 3) {
    return plan.early;
  }
  if (day >= 4 && day <= 6) {
    return plan.late;
  }
  return plan.early;
}

function getFslText(tm, percent) {
  if (!tm) {
    return "-";
  }

  if (percent === 85) {
    return `${formatKg(roundTrainingWeight(tm * 0.7))} · ${FSL_RULES[percent]}`;
  }
  if (percent === 90) {
    return `${formatKg(roundTrainingWeight(tm * 0.65))}-${formatKg(roundTrainingWeight(tm * 0.7))} · ${FSL_RULES[percent]}`;
  }
  if (percent === 95) {
    return `${formatKg(roundTrainingWeight(tm * 0.6))}-${formatKg(roundTrainingWeight(tm * 0.65))} · ${FSL_RULES[percent]}`;
  }
  return "-";
}

function loadTmOverrides() {
  try {
    return JSON.parse(localStorage.getItem(TM_STORAGE_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function saveTmOverrides() {
  localStorage.setItem(TM_STORAGE_KEY, JSON.stringify(state.tmOverrides));
}

function getPrRecordIds(records) {
  const bestByLift = {};
  const ids = new Set();

  [...records]
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate))
    .forEach((record) => {
      const best = bestByLift[record.movement] || 0;
      if ((record.e1rm || 0) > best) {
        ids.add(record.id);
        bestByLift[record.movement] = record.e1rm || 0;
      }
    });

  return ids;
}

function renderStatus() {
  if (!state.lastSync) {
    return;
  }

  const sheetCount = state.sheetRecords.length;
  $("#syncStatus").textContent = `시트 ${sheetCount}개 · ${state.lastSync.toLocaleTimeString(
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
    ? `${koreanMovement(state.selectedLift)} ${formatSearchWeight(rawTarget, searchUnit, target)} 검색 결과`
    : `${koreanMovement(state.selectedLift)} 전체 기록`;
  $("#historyTitle").textContent = title;

  const summaryItems = target
    ? [
        {
          label: "최근 수행",
          value: latest ? formatDisplayWeight(latest.weight, searchUnit) : "-",
          detail: latest
            ? `${latest.reps || "-"}회 · ${latest.date || "날짜 없음"} · 검색 ${records.length}개`
            : "기록 없음",
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
          value: latest ? formatDisplayWeight(latest.weight, searchUnit) : "-",
          detail: latest ? `${latest.reps || "-"}회 · ${latest.date || "날짜 없음"}` : "기록 없음",
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
  $("#weightGroupsTitle").textContent = `${koreanMovement(state.selectedLift)} 중량별 기록`;
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
        .map((record) => {
          const target = getSearchValue();
          const isExact = target && Math.abs(record.weight - target) < 0.05;
          return `
            <tr class="${isExact ? "exact-row" : ""}">
              <td><span class="record-date">${formatShortDate(record.date)}</span></td>
              <td class="record-set">
                <strong>${formatDisplayWeight(record.weight, getSearchUnit())} x ${record.reps || "-"}</strong>
                <span>${escapeHtml(record.note || koreanMovement(record.movement))}</span>
              </td>
              <td><span class="record-e1rm">${formatKg(record.e1rm)}</span></td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="3">조건에 맞는 기록이 없습니다.</td></tr>`;
}

function renderConversionHint() {
  const conversionHint = $("#conversionHint");
  if (!conversionHint) {
    return;
  }

  const target = getSearchValue();
  const unit = getSearchUnit();
  const hint = target
    ? unit === "lb"
      ? `≈ <span>${formatKg(target)}</span>`
      : `≈ <span>${formatNearestLb(target)}</span>`
    : "≈ -";
  conversionHint.innerHTML = hint;
}

function renderE1rmPreview() {
  const weight = toNumber($("#strengthWeight").value);
  const reps = toNumber($("#strengthReps").value);
  $("#e1rmPreview").textContent = formatKg(estimateE1rm(weight, reps));
}

function syncConvert(source) {
  const kgInput = $("#convertKg");
  const lbInput = $("#convertLb");
  if (!kgInput || !lbInput) {
    return;
  }

  if (source === "lb") {
    const raw = lbInput.value.trim();
    kgInput.value = raw === "" ? "" : String(roundTwo(toNumber(raw) * KG_TO_LB));
  } else {
    const raw = kgInput.value.trim();
    lbInput.value = raw === "" ? "" : String(roundTwo(toNumber(raw) / KG_TO_LB));
  }
}

function renderConvertPresets() {
  const kgWrap = $("#convertKgPresets");
  const lbWrap = $("#convertLbPresets");

  if (kgWrap) {
    kgWrap.innerHTML = CONVERT_KG_PRESETS.map(
      (kg) => `
        <button class="preset-chip" type="button" data-preset-kg="${kg}">
          <strong>${kg}<span>kg</span></strong>
          <em>${roundOne(kg / KG_TO_LB)} lb</em>
        </button>
      `,
    ).join("");
  }

  if (lbWrap) {
    lbWrap.innerHTML = CONVERT_LB_PRESETS.map(
      (lb) => `
        <button class="preset-chip" type="button" data-preset-lb="${lb}">
          <strong>${lb}<span>lb</span></strong>
          <em>${roundOne(lb * KG_TO_LB)} kg</em>
        </button>
      `,
    ).join("");
  }

  $$("[data-preset-kg]").forEach((button) => {
    button.addEventListener("click", () => {
      $("#convertKg").value = button.dataset.presetKg;
      syncConvert("kg");
    });
  });

  $$("[data-preset-lb]").forEach((button) => {
    button.addEventListener("click", () => {
      $("#convertLb").value = button.dataset.presetLb;
      syncConvert("lb");
    });
  });
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function estimateE1rm(weight, reps) {
  return weight > 0 && reps > 0 ? roundOne(weight * (1 + reps / 30)) : 0;
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

function roundTwo(value) {
  return Math.round(value * 100) / 100;
}

function roundTrainingWeight(value) {
  return Math.round(value / 5) * 5;
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

function formatDeltaKg(value) {
  if (Math.abs(value) < 0.05) {
    return "+0kg";
  }

  return value > 0 ? `+${formatKg(value)}` : formatKg(value);
}

function lbToKg(value) {
  return roundOne(value * 0.45359237);
}

function formatShortDate(value) {
  return value ? value.slice(5).replace("-", ".") : "-";
}

function formatDotDate(value) {
  return value ? value.replaceAll("-", ".") : "-";
}

function shortMovement(value) {
  return value === "Bench Press" ? "Bench" : value;
}

function koreanMovement(value) {
  if (value === "Squat") {
    return "스쿼트";
  }
  if (value === "Bench Press") {
    return "벤치";
  }
  if (value === "Deadlift") {
    return "데드리프트";
  }
  return value;
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replaceAll('"', '\\"');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
