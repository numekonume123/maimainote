/* ============ ユーティリティ ============ */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? fallback : v;
  } catch (e) { return fallback; }
}
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

const DIFFICULTIES = ["BASIC", "ADVANCED", "EXPERT", "MASTER", "Re:MASTER"];

/* ============ データ ============ */
let songs = load("mm_songs", null);
if (!songs) {
  songs = [
    { id: uid(), title: "Oshama Scramble!", difficulty: "MASTER", level: "13", bpm: 175, notes: [] },
    { id: uid(), title: "Oshama Scramble!", difficulty: "EXPERT", level: "11", bpm: 175, notes: [] },
    { id: uid(), title: "PANDORA PARADOXXX", difficulty: "MASTER", level: "13+", bpm: 200, notes: [] },
    { id: uid(), title: "ARBAZAK -also known as Grieving Star-", difficulty: "MASTER", level: "13+", bpm: 200, notes: [] },
    { id: uid(), title: "Excalibur ～Revive the world～", difficulty: "MASTER", level: "13", bpm: 142, notes: [] },
  ];
  save("mm_songs", songs);
}
let records = load("mm_records", []);
let routines = load("mm_routines", []);
let goal = load("mm_goal", null);

/* ============ ルーター ============ */
const views = document.querySelectorAll(".view");
let currentParams = {};

function navigate(name, params = {}) {
  currentParams = params;
  views.forEach(v => v.classList.toggle("active", v.dataset.view === name));
  window.scrollTo(0, 0);
  if (name === "record") renderSelector("record-selector", "record", onPickRecordSong);
  if (name === "record-entry") renderRecordEntry(params.songId);
  if (name === "chart") renderSelector("chart-selector", "chart", onPickChartSong);
  if (name === "chart-viewer") renderChartViewer(params.songId);
  if (name === "routine") renderRoutineList();
  if (name === "routine-entry") resetRoutineForm();
  if (name === "goal") renderGoal();
}

document.addEventListener("click", (e) => {
  const navBtn = e.target.closest("[data-nav]");
  if (navBtn) navigate(navBtn.dataset.nav);
});

navigate("home");

/* ============ 曲選択（記録・譜面 共通） ============ */
function renderSelector(containerId, mode, onPick) {
  const el = document.getElementById(containerId);
  el.innerHTML = `
    <input class="selector-search" type="text" placeholder="曲名で検索" id="${containerId}-search">
    <div class="diff-tabs" id="${containerId}-tabs"></div>
    <div id="${containerId}-list"></div>
  `;

  const searchInput = el.querySelector(`#${containerId}-search`);
  const tabsEl = el.querySelector(`#${containerId}-tabs`);
  const listEl = el.querySelector(`#${containerId}-list`);
  let activeDiff = null;

  DIFFICULTIES.forEach(d => {
    const btn = document.createElement("button");
    btn.className = "diff-tab";
    btn.dataset.diff = d;
    btn.textContent = d;
    btn.addEventListener("click", () => {
      activeDiff = activeDiff === d ? null : d;
      searchInput.value = "";
      renderList();
    });
    tabsEl.appendChild(btn);
  });

  function renderList() {
    [...tabsEl.children].forEach(b => b.classList.toggle("active", b.dataset.diff === activeDiff));
    const q = searchInput.value.trim().toLowerCase();
    let list = songs;
    if (activeDiff) list = list.filter(s => s.difficulty === activeDiff);
    if (q) list = list.filter(s => s.title.toLowerCase().includes(q));

    if (list.length === 0) {
      listEl.innerHTML = `<p class="empty-state">曲が見つかりません。<br>「曲を編集」から追加できます。</p>`;
      return;
    }
    listEl.innerHTML = "";
    list.forEach(s => {
      const row = document.createElement("div");
      row.className = "song-row";
      row.innerHTML = `
        <div>
          <div class="song-title">${escapeHtml(s.title)}</div>
          <div class="song-meta">${s.difficulty}</div>
        </div>
        <div class="song-level mono">${escapeHtml(s.level || "")}</div>
      `;
      row.addEventListener("click", () => onPick(s));
      listEl.appendChild(row);
    });
  }

  searchInput.addEventListener("input", renderList);
  renderList();

  // 曲を編集ボタン（同じページのヘッダー内のものだけを対象にする）
  const viewEl = el.closest(".view");
  const manageBtn = viewEl && viewEl.querySelector('[data-action="manage-songs"]');
  if (manageBtn) manageBtn.onclick = () => manageSongs(mode);
}

function manageSongs(mode) {
  const title = prompt("追加する曲名を入力してください（キャンセルで中止）");
  if (!title) return;
  const difficulty = prompt(`難易度を入力（${DIFFICULTIES.join(" / ")}）`, "MASTER");
  if (!difficulty || !DIFFICULTIES.includes(difficulty)) { alert("難易度が正しくありません"); return; }
  const level = prompt("レベルを入力（例：13+）", "") || "";
  const bpm = Number(prompt("BPMを入力", "150")) || 150;
  songs.push({ id: uid(), title, difficulty, level, bpm, notes: [] });
  save("mm_songs", songs);
  navigate(mode || "record");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============ 記録 ============ */
function onPickRecordSong(song) { navigate("record-entry", { songId: song.id }); }

function renderRecordEntry(songId) {
  const song = songs.find(s => s.id === songId);
  document.getElementById("record-entry-title").textContent = song ? `${song.title}（${song.difficulty}）` : "記録";

  const form = document.getElementById("record-form");
  form.reset();
  form.querySelector('[name="date"]').value = new Date().toISOString().slice(0, 10);

  form.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    records.push({
      id: uid(),
      songId,
      date: fd.get("date"),
      score: fd.get("score"),
      memo: fd.get("memo") || "",
    });
    save("mm_records", records);
    form.reset();
    form.querySelector('[name="date"]').value = new Date().toISOString().slice(0, 10);
    renderHistory(songId);
  };

  renderHistory(songId);
}

function renderHistory(songId) {
  const el = document.getElementById("record-history");
  const list = records.filter(r => r.songId === songId).sort((a, b) => b.date.localeCompare(a.date));
  if (list.length === 0) {
    el.innerHTML = `<p class="empty-state">まだ記録がありません。</p>`;
    return;
  }
  el.innerHTML = list.map(r => `
    <div class="history-item">
      <div class="history-top">
        <span class="history-date mono">${r.date}</span>
        <span class="history-score">${escapeHtml(r.score)}</span>
      </div>
      ${r.memo ? `<div class="history-memo">${escapeHtml(r.memo)}</div>` : ""}
    </div>
  `).join("");
}

/* ============ 譜面 ============ */
let chartState = null; // { song, notes, playing, currentTime, rafId, speed, metronomeOn, metroTimer, audioCtx }

function onPickChartSong(song) { navigate("chart-viewer", { songId: song.id }); }

function renderChartViewer(songId) {
  stopChartPlayback();
  const song = songs.find(s => s.id === songId);
  if (!song) return;
  document.getElementById("chart-viewer-title").textContent = `${song.title}（${song.difficulty}）`;

  chartState = {
    song,
    playing: false,
    currentTime: 0,
    speed: 1,
    metronomeOn: false,
    audioCtx: null,
    lastFrame: null,
    metroNextTime: 0,
  };

  document.getElementById("speed-select").value = "1";
  document.getElementById("speed-select").onchange = (e) => {
    chartState.speed = Number(e.target.value);
  };
  document.getElementById("scrub").oninput = (e) => {
    chartState.currentTime = Number(e.target.value);
    drawRing();
    updateTimeLabel();
  };
  document.getElementById("add-note-btn").onclick = addNote;

  document.querySelector('[data-action="play"]').onclick = togglePlay;
  document.querySelector('[data-action="rewind"]').onclick = rewind;
  document.querySelector('[data-action="metronome"]').onclick = toggleMetronome;
  document.querySelector('[data-action="edit-notes"]').onclick = () => {
    document.getElementById("note-list").scrollIntoView({ behavior: "smooth" });
  };

  updateScrubMax();
  renderNoteList();
  drawRing();
  updateTimeLabel();
}

function updateScrubMax() {
  const notes = chartState.song.notes;
  const maxTime = notes.length ? Math.max(...notes.map(n => n.time)) + 2 : 10;
  document.getElementById("scrub").max = maxTime;
}

function addNote() {
  const time = Number(prompt("ノーツの時間（秒）を入力", chartState.currentTime.toFixed(1)));
  if (Number.isNaN(time)) return;
  const button = Number(prompt("ボタン位置（1〜8）を入力", "1"));
  if (!button || button < 1 || button > 8) { alert("1〜8で入力してください"); return; }
  chartState.song.notes.push({ id: uid(), time, button, color: "red" });
  chartState.song.notes.sort((a, b) => a.time - b.time);
  save("mm_songs", songs);
  updateScrubMax();
  renderNoteList();
  drawRing();
}

function cycleColor(c) { return c === "red" ? "blue" : c === "blue" ? "green" : "red"; }
function colorHex(c) { return c === "blue" ? "#4FA6FF" : c === "green" ? "#46D98A" : "#FF3B5C"; }

function renderNoteList() {
  const el = document.getElementById("note-list");
  const notes = chartState.song.notes;
  if (notes.length === 0) {
    el.innerHTML = `<p class="empty-state">まだノーツがありません。「＋ ノーツを追加」から作成できます。</p>`;
    return;
  }
  el.innerHTML = notes.map(n => `
    <div class="note-row" data-id="${n.id}">
      <span class="note-dot" style="background:${colorHex(n.color)}" data-toggle-color="${n.id}"></span>
      <span class="note-row-time">${n.time.toFixed(2)}s ・ ボタン${n.button}</span>
      <button class="note-row-del" data-del-note="${n.id}">×</button>
    </div>
  `).join("");

  el.querySelectorAll("[data-toggle-color]").forEach(dot => {
    dot.onclick = () => {
      const n = notes.find(x => x.id === dot.dataset.toggleColor);
      n.color = cycleColor(n.color);
      save("mm_songs", songs);
      renderNoteList();
      drawRing();
    };
  });
  el.querySelectorAll("[data-del-note]").forEach(btn => {
    btn.onclick = () => {
      chartState.song.notes = notes.filter(x => x.id !== btn.dataset.delNote);
      save("mm_songs", songs);
      updateScrubMax();
      renderNoteList();
      drawRing();
    };
  });
}

function buttonPosition(index, cx, cy, r) {
  // index 1-8, 上(12時)から時計回り
  const angle = -Math.PI / 2 + (index - 1) * (2 * Math.PI / 8);
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function drawRing() {
  const canvas = document.getElementById("ring-canvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, r = W * 0.36, btnR = W * 0.045;

  ctx.clearRect(0, 0, W, H);

  // 外周ガイド
  ctx.strokeStyle = "#251F40";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // 8つのセンサーボタン（既定は赤）
  for (let i = 1; i <= 8; i++) {
    const p = buttonPosition(i, cx, cy, r);
    ctx.beginPath();
    ctx.arc(p.x, p.y, btnR, 0, Math.PI * 2);
    ctx.strokeStyle = "#FF3B5C";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // ノーツ：接近アニメーション（中心→ボタン）
  const travel = 1.2; // 秒
  chartState.song.notes.forEach(n => {
    const dt = n.time - chartState.currentTime;
    if (dt < -0.15 || dt > travel) return;
    const progress = Math.min(1, Math.max(0, 1 - dt / travel));
    const p = buttonPosition(n.button, cx, cy, r);
    const x = cx + (p.x - cx) * progress;
    const y = cy + (p.y - cy) * progress;
    const hit = dt <= 0.15 && dt >= -0.15;
    ctx.beginPath();
    ctx.arc(x, y, hit ? btnR * 1.15 : btnR * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = colorHex(n.color);
    ctx.globalAlpha = hit ? 1 : 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  // 中心
  ctx.beginPath();
  ctx.arc(cx, cy, W * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = "#1B1830";
  ctx.fill();
  ctx.strokeStyle = "#332C55";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function updateTimeLabel() {
  document.getElementById("time-label").textContent = chartState.currentTime.toFixed(1) + "s";
  document.getElementById("scrub").value = chartState.currentTime;
}

function togglePlay() {
  chartState.playing = !chartState.playing;
  const btn = document.querySelector('[data-action="play"]');
  btn.textContent = chartState.playing ? "⏸" : "▶";
  if (chartState.playing) {
    chartState.lastFrame = performance.now();
    requestAnimationFrame(playLoop);
  }
}

function playLoop(now) {
  if (!chartState || !chartState.playing) return;
  const dt = (now - chartState.lastFrame) / 1000;
  chartState.lastFrame = now;
  chartState.currentTime += dt * chartState.speed;
  const max = Number(document.getElementById("scrub").max);
  if (chartState.currentTime >= max) {
    chartState.currentTime = max;
    chartState.playing = false;
    document.querySelector('[data-action="play"]').textContent = "▶";
  }
  drawRing();
  updateTimeLabel();
  if (chartState.playing) requestAnimationFrame(playLoop);
}

function rewind() {
  chartState.currentTime = 0;
  chartState.playing = false;
  document.querySelector('[data-action="play"]').textContent = "▶";
  drawRing();
  updateTimeLabel();
}

function ensureAudio() {
  if (!chartState.audioCtx) {
    chartState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return chartState.audioCtx;
}

function toggleMetronome() {
  chartState.metronomeOn = !chartState.metronomeOn;
  const btn = document.querySelector('[data-action="metronome"]');
  btn.classList.toggle("is-on", chartState.metronomeOn);
  if (chartState.metronomeOn) {
    const ctx = ensureAudio();
    chartState.metroNextTime = ctx.currentTime + 0.05;
    scheduleMetronome();
  }
}

function scheduleMetronome() {
  if (!chartState || !chartState.metronomeOn) return;
  const ctx = chartState.audioCtx;
  const bpm = chartState.song.bpm || 120;
  const interval = 60 / bpm;
  while (chartState.metroNextTime < ctx.currentTime + 0.15) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1000;
    gain.gain.setValueAtTime(0.15, chartState.metroNextTime);
    gain.gain.exponentialRampToValueAtTime(0.001, chartState.metroNextTime + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(chartState.metroNextTime);
    osc.stop(chartState.metroNextTime + 0.06);
    chartState.metroNextTime += interval;
  }
  setTimeout(scheduleMetronome, 60);
}

function stopChartPlayback() {
  if (chartState) {
    chartState.playing = false;
    chartState.metronomeOn = false;
  }
}

/* ============ 日課 ============ */
function renderRoutineList() {
  const el = document.getElementById("routine-list");
  const empty = document.getElementById("routine-empty");
  if (routines.length === 0) {
    el.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  const dayLabels = ["日", "月", "火", "水", "木", "金", "土"];
  el.innerHTML = routines.map(r => `
    <div class="routine-card">
      <div class="routine-title">${escapeHtml(r.title)}</div>
      ${r.content ? `<div class="routine-content">${escapeHtml(r.content)}</div>` : ""}
      <div class="routine-days">
        ${dayLabels.map((l, i) => `<span class="routine-day ${r.days.includes(i) ? "on" : ""}">${l}</span>`).join("")}
      </div>
      <div class="routine-period">${r.startDate} から ${r.weeks}週間 ・ ${r.time}</div>
      <div class="routine-actions">
        <a class="btn-cal" href="${routineToIcsUrl(r)}" download="${encodeURIComponent(r.title)}.ics">カレンダーに追加</a>
        <button class="btn-del" data-del-routine="${r.id}">削除</button>
      </div>
    </div>
  `).join("");

  el.querySelectorAll("[data-del-routine]").forEach(btn => {
    btn.onclick = () => {
      routines = routines.filter(r => r.id !== btn.dataset.delRoutine);
      save("mm_routines", routines);
      renderRoutineList();
    };
  });
}

function resetRoutineForm() {
  const form = document.getElementById("routine-form");
  form.reset();
  form.querySelector('[name="startDate"]').value = new Date().toISOString().slice(0, 10);
  document.querySelectorAll("#weekday-picker .weekday").forEach(b => b.classList.remove("on"));

  document.querySelectorAll("#weekday-picker .weekday").forEach(b => {
    b.onclick = () => b.classList.toggle("on");
  });

  form.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const days = [...document.querySelectorAll("#weekday-picker .weekday.on")].map(b => Number(b.dataset.day));
    if (days.length === 0) { alert("実施する曜日を1つ以上選んでください"); return; }
    routines.push({
      id: uid(),
      title: fd.get("title"),
      content: fd.get("content") || "",
      days,
      startDate: fd.get("startDate"),
      weeks: Number(fd.get("weeks")),
      time: fd.get("time"),
    });
    save("mm_routines", routines);
    navigate("routine");
  };
}

function pad(n) { return String(n).padStart(2, "0"); }

function icsDate(dateStr, timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(h, m, 0, 0);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function icsUntil(startDate, weeks) {
  const d = new Date(startDate + "T00:00:00");
  d.setDate(d.getDate() + weeks * 7);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T235900Z`;
}

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function routineToIcs(r) {
  // 開始日以降で、選んだ曜日のうち最初に来る日をDTSTARTにする
  const start = new Date(r.startDate + "T00:00:00");
  let firstDay = new Date(start);
  for (let i = 0; i < 7; i++) {
    if (r.days.includes(firstDay.getDay())) break;
    firstDay.setDate(firstDay.getDate() + 1);
  }
  const firstDateStr = `${firstDay.getFullYear()}-${pad(firstDay.getMonth() + 1)}-${pad(firstDay.getDate())}`;
  const dtstart = icsDate(firstDateStr, r.time);
  const until = icsUntil(r.startDate, r.weeks);
  const byday = r.days.map(d => BYDAY[d]).join(",");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//maimai-note//JP",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${r.id}@maimai-note`,
    `DTSTAMP:${dtstart}Z`,
    `DTSTART:${dtstart}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${byday};UNTIL=${until}`,
    `SUMMARY:${escapeIcs(r.title)}`,
    r.content ? `DESCRIPTION:${escapeIcs(r.content)}` : "",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT0M",
    `DESCRIPTION:${escapeIcs(r.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}

function escapeIcs(s) { return String(s).replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n"); }

function routineToIcsUrl(r) {
  const ics = routineToIcs(r);
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
}

/* ============ 目標 ============ */
function renderGoal() {
  const display = document.getElementById("goal-display");
  const form = document.getElementById("goal-form");

  if (goal) {
    display.innerHTML = `
      <div class="goal-card">
        <div class="goal-card-title">${escapeHtml(goal.title)}</div>
        ${goal.content ? `<div class="goal-card-content">${escapeHtml(goal.content)}</div>` : ""}
        ${goal.deadline ? `<span class="goal-card-deadline mono">期限：${goal.deadline}</span>` : ""}
      </div>
    `;
    form.querySelector('[name="title"]').value = goal.title;
    form.querySelector('[name="content"]').value = goal.content || "";
    form.querySelector('[name="deadline"]').value = goal.deadline || "";
  } else {
    display.innerHTML = "";
    form.reset();
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    goal = {
      title: fd.get("title"),
      content: fd.get("content") || "",
      deadline: fd.get("deadline") || "",
    };
    save("mm_goal", goal);
    renderGoal();
  };
}

/* ============ Service Worker 登録 ============ */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
