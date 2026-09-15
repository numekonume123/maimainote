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
// 曲・譜面データ（songs.json）はPCで編集してGitHubに反映する運用がベースだが、
// アプリ内でも譜面を作れるように、以下2種類の「ローカル編集」をこの端末に保持する。
//   - songOverrides: songs.json由来の曲に対する上書き（主にnotesの追加編集）
//   - localSongs   : アプリ内で新規作成した曲（まだsongs.jsonに存在しない）
// 「書き出す」機能で、この2つをsongs.jsonのベースにマージしたJSONをダウンロードできる。
let songs = load("mm_songs_cache", []);
let songOverrides = load("mm_song_overrides", {});
let localSongs = load("mm_local_songs", []);
let records = load("mm_records", []);
let routines = load("mm_routines", []);
let goal = load("mm_goal", null);

async function loadSongs() {
  try {
    const res = await fetch("songs.json", { cache: "no-store" });
    if (!res.ok) throw new Error("failed to fetch songs.json");
    songs = await res.json();
    save("mm_songs_cache", songs);
  } catch (e) {
    // オフライン時などはキャッシュ済みデータのまま続行
    console.warn("songs.jsonを取得できなかったため、キャッシュを使用します", e);
  }
}

function getWorkingSongs() {
  const base = songs.map(s => songOverrides[s.id] ? Object.assign({}, s, songOverrides[s.id]) : s);
  return base.concat(localSongs);
}

function findWorkingSong(id) {
  return getWorkingSongs().find(s => s.id === id);
}

// 曲の編集（notesなど）を保存する。songs.json由来の曲ならoverrideとして、
// アプリ内で新規作成した曲ならlocalSongs自体を更新する。
function persistSongEdit(song) {
  const isLocal = localSongs.some(s => s.id === song.id);
  if (isLocal) {
    localSongs = localSongs.map(s => s.id === song.id ? song : s);
    save("mm_local_songs", localSongs);
  } else {
    songOverrides[song.id] = { notes: song.notes };
    save("mm_song_overrides", songOverrides);
  }
}

function slugify(title, difficulty) {
  const base = title.toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, "-")
    .replace(/^-+|-+$/g, "") || "song";
  const diffSlug = difficulty.toLowerCase().replace(/[^a-z]+/g, "");
  let id = `${base}-${diffSlug}`;
  const existing = new Set(getWorkingSongs().map(s => s.id));
  if (existing.has(id)) id += "-" + uid().slice(-4);
  return id;
}

function exportSongsJson() {
  const merged = getWorkingSongs();
  const text = JSON.stringify(merged, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "songs.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

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
  if (name === "song-new") resetSongNewForm(params.from || "chart");
  if (name === "routine") renderRoutineList();
  if (name === "routine-entry") resetRoutineForm();
  if (name === "goal") renderGoal();
}

document.addEventListener("click", (e) => {
  const navBtn = e.target.closest("[data-nav]");
  if (navBtn) navigate(navBtn.dataset.nav);
});

async function init() {
  await loadSongs();
  navigate("home");
}
init();

/* ============ 曲選択（記録・譜面 共通） ============ */
function renderSelector(containerId, mode, onPick) {
  const el = document.getElementById(containerId);
  el.innerHTML = `
    <input class="selector-search" type="text" placeholder="曲名で検索" id="${containerId}-search">
    <div class="diff-tabs" id="${containerId}-tabs"></div>
    <div id="${containerId}-list"></div>
    <button class="btn-secondary" id="${containerId}-new">＋ 新しい曲を作る</button>
    ${mode === "chart" ? `<button class="btn-secondary" id="${containerId}-export">songs.jsonを書き出す</button>` : ""}
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
    let list = getWorkingSongs();
    if (activeDiff) list = list.filter(s => s.difficulty === activeDiff);
    if (q) list = list.filter(s => s.title.toLowerCase().includes(q));

    if (list.length === 0) {
      listEl.innerHTML = `<p class="empty-state">曲が見つかりません。<br>「＋ 新しい曲を作る」から追加できます。</p>`;
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

  el.querySelector(`#${containerId}-new`).onclick = () => navigate("song-new", { from: mode });
  const exportBtn = el.querySelector(`#${containerId}-export`);
  if (exportBtn) exportBtn.onclick = exportSongsJson;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============ 記録 ============ */
function onPickRecordSong(song) { navigate("record-entry", { songId: song.id }); }

function renderRecordEntry(songId) {
  const song = findWorkingSong(songId);
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
let chartState = null; // { song, notes, playing, currentTime, speed, metronomeOn, audioCtx, editing, noteType, noteColor, pendingSlide }

const NOTE_TYPES = [
  { id: "tap", label: "タップ" },
  { id: "touch", label: "タッチ" },
  { id: "slide", label: "スライド" },
];
const NOTE_COLORS = [
  { id: "red", label: "既定" },
  { id: "blue", label: "右手" },
  { id: "green", label: "左手" },
];

function onPickChartSong(song) { navigate("chart-viewer", { songId: song.id }); }

function renderChartViewer(songId) {
  stopChartPlayback();
  const song = findWorkingSong(songId);
  if (!song) return;
  if (!song.notes) song.notes = [];
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
    editing: false,
    noteType: "tap",
    noteColor: "red",
    slideDuration: song.bpm ? Math.round((60 / song.bpm) * 100) / 100 : 0.5,
    pendingSlide: null, // { from, time }
  };

  document.getElementById("speed-select").value = "1";
  document.getElementById("speed-select").onchange = (e) => {
    chartState.speed = Number(e.target.value);
  };
  document.getElementById("scrub").oninput = (e) => {
    chartState.currentTime = Number(e.target.value);
    chartState.pendingSlide = null;
    drawRing();
    updateTimeLabel();
  };

  document.querySelector('[data-action="play"]').onclick = togglePlay;
  document.querySelector('[data-action="rewind"]').onclick = rewind;
  document.querySelector('[data-action="metronome"]').onclick = toggleMetronome;

  const editToggle = document.querySelector('[data-action="toggle-edit"]');
  editToggle.classList.remove("is-on");
  editToggle.onclick = () => {
    chartState.editing = !chartState.editing;
    chartState.pendingSlide = null;
    editToggle.classList.toggle("is-on", chartState.editing);
    document.getElementById("edit-panel").style.display = chartState.editing ? "block" : "none";
    renderNoteList();
    drawRing();
  };
  document.getElementById("edit-panel").style.display = "none";
  renderEditPanel();

  const canvas = document.getElementById("ring-canvas");
  canvas.onclick = (e) => {
    if (!chartState.editing) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    handleCanvasEditTap(x, y);
  };

  updateScrubMax();
  renderNoteList();
  drawRing();
  updateTimeLabel();
}

function renderEditPanel() {
  const panel = document.getElementById("edit-panel");
  panel.innerHTML = `
    <div class="edit-row">
      <span class="edit-row-label">種類</span>
      <div class="seg" id="edit-type-seg">
        ${NOTE_TYPES.map(t => `<button type="button" class="seg-btn" data-type="${t.id}">${t.label}</button>`).join("")}
      </div>
    </div>
    <div class="edit-row" id="edit-color-row">
      <span class="edit-row-label">色（手）</span>
      <div class="seg" id="edit-color-seg">
        ${NOTE_COLORS.map(c => `<button type="button" class="seg-btn seg-btn--color-${c.id}" data-color="${c.id}">${c.label}</button>`).join("")}
      </div>
    </div>
    <div class="edit-row" id="edit-slide-row">
      <span class="edit-row-label">スライドの長さ(秒)</span>
      <input type="number" id="edit-slide-duration" step="0.05" min="0.05" value="${chartState.slideDuration}">
    </div>
    <p class="hint" id="edit-hint"></p>
  `;

  const typeSeg = document.getElementById("edit-type-seg");
  typeSeg.querySelectorAll("[data-type]").forEach(b => {
    b.classList.toggle("active", b.dataset.type === chartState.noteType);
    b.onclick = () => {
      chartState.noteType = b.dataset.type;
      chartState.pendingSlide = null;
      renderEditPanel();
      drawRing();
    };
  });
  const colorSeg = document.getElementById("edit-color-seg");
  colorSeg.querySelectorAll("[data-color]").forEach(b => {
    b.classList.toggle("active", b.dataset.color === chartState.noteColor);
    b.onclick = () => {
      chartState.noteColor = b.dataset.color;
      renderEditPanel();
    };
  });
  document.getElementById("edit-color-row").style.display = chartState.noteType === "slide" ? "none" : "flex";
  document.getElementById("edit-slide-row").style.display = chartState.noteType === "slide" ? "flex" : "none";
  document.getElementById("edit-slide-duration").oninput = (e) => {
    chartState.slideDuration = Number(e.target.value) || 0.1;
  };

  const hint = document.getElementById("edit-hint");
  if (chartState.noteType === "slide") {
    hint.textContent = chartState.pendingSlide
      ? "終点のボタンをタップしてください。"
      : "始点のボタンをタップしてください。";
  } else {
    hint.textContent = "リング上のボタンをタップすると、現在の時間にノーツを配置します。";
  }
}

function updateScrubMax() {
  const notes = chartState.song.notes;
  const noteEnd = notes.length ? Math.max(...notes.map(n => n.time + (n.duration || 0))) + 2 : 0;
  const maxTime = Math.max(chartState.song.duration || 0, noteEnd, 10);
  document.getElementById("scrub").max = maxTime;
}

function cycleColor(c) { return c === "red" ? "blue" : c === "blue" ? "green" : "red"; }
function colorHex(c) { return c === "blue" ? "#4FA6FF" : c === "green" ? "#46D98A" : "#FF3B5C"; }
const TYPE_LABEL = { tap: "タップ", touch: "タッチ", slide: "スライド" };

function handleCanvasEditTap(x, y) {
  const canvas = document.getElementById("ring-canvas");
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, r = W * 0.36;
  const hitRadius = W * 0.08;

  // center touch判定
  const distCenter = Math.hypot(x - cx, y - cy);
  let button = null;
  if (chartState.noteType === "touch" && distCenter < W * 0.14) {
    button = 0; // 0 = 中心
  } else {
    for (let i = 1; i <= 8; i++) {
      const p = buttonPosition(i, cx, cy, r);
      if (Math.hypot(x - p.x, y - p.y) < hitRadius) { button = i; break; }
    }
  }
  if (button === null) return;

  if (chartState.noteType === "slide") {
    if (!chartState.pendingSlide) {
      if (button === 0) return; // スライドは中心不可
      chartState.pendingSlide = { from: button, time: chartState.currentTime };
      renderEditPanel();
      drawRing();
      return;
    }
    if (button === 0 || button === chartState.pendingSlide.from) { chartState.pendingSlide = null; renderEditPanel(); drawRing(); return; }
    const note = {
      id: uid(),
      type: "slide",
      time: chartState.pendingSlide.time,
      from: chartState.pendingSlide.from,
      to: button,
      duration: chartState.slideDuration,
      color: chartState.noteColor,
    };
    chartState.song.notes.push(note);
    chartState.song.notes.sort((a, b) => a.time - b.time);
    persistSongEdit(chartState.song);
    chartState.pendingSlide = null;
    updateScrubMax();
    renderNoteList();
    renderEditPanel();
    drawRing();
    return;
  }

  const note = {
    id: uid(),
    type: chartState.noteType,
    time: chartState.currentTime,
    button,
    color: chartState.noteColor,
  };
  chartState.song.notes.push(note);
  chartState.song.notes.sort((a, b) => a.time - b.time);
  persistSongEdit(chartState.song);
  updateScrubMax();
  renderNoteList();
  drawRing();
}

function deleteNote(noteId) {
  chartState.song.notes = chartState.song.notes.filter(n => n.id !== noteId);
  persistSongEdit(chartState.song);
  updateScrubMax();
  renderNoteList();
  drawRing();
}

function renderNoteList() {
  const el = document.getElementById("note-list");
  const notes = chartState.song.notes;
  if (notes.length === 0) {
    el.innerHTML = `<p class="empty-state">まだノーツがありません。${chartState.editing ? "リング上をタップして配置しましょう。" : "「編集」から追加できます。"}</p>`;
    return;
  }
  el.innerHTML = notes.map(n => {
    const posLabel = n.type === "slide" ? `${n.from}→${n.to}` : (n.button === 0 ? "中心" : `ボタン${n.button}`);
    return `
    <div class="note-row" data-id="${n.id}">
      <span class="note-dot note-dot--${n.type}" style="background:${colorHex(n.color)}"></span>
      <span class="note-row-time">${n.time.toFixed(2)}s ・ ${TYPE_LABEL[n.type] || "タップ"} ・ ${posLabel}</span>
      ${chartState.editing ? `<button class="note-row-del" data-del-note="${n.id}">×</button>` : ""}
    </div>
  `;
  }).join("");

  if (chartState.editing) {
    el.querySelectorAll("[data-del-note]").forEach(btn => {
      btn.onclick = () => deleteNote(btn.dataset.delNote);
    });
  }
}

function buttonPosition(index, cx, cy, r) {
  // index 1-8, 上(12時)から時計回り。0は中心（タッチ用）
  if (index === 0) return { x: cx, y: cy };
  const angle = -Math.PI / 2 + (index - 1) * (2 * Math.PI / 8);
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function drawDiamond(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
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

  // スライド編集中：始点のハイライト
  if (chartState.editing && chartState.pendingSlide) {
    const p = buttonPosition(chartState.pendingSlide.from, cx, cy, r);
    ctx.beginPath();
    ctx.arc(p.x, p.y, btnR * 1.4, 0, Math.PI * 2);
    ctx.strokeStyle = "#FFC93C";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  const travel = 1.2; // 秒（登場〜判定のリードタイム）

  chartState.song.notes.forEach(n => {
    if (n.type === "slide") {
      const dt = n.time - chartState.currentTime;
      const activeEnd = n.duration || 0.3;
      if (dt > travel || dt < -activeEnd - 0.15) return;
      const from = buttonPosition(n.from, cx, cy, r);
      const to = buttonPosition(n.to, cx, cy, r);

      // ガイドライン
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = colorHex(n.color);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (dt > 0) {
        // まだ始点に到達していない：始点を光らせる
        ctx.beginPath();
        ctx.arc(from.x, from.y, btnR * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = colorHex(n.color);
        ctx.fill();
      } else {
        // 始点〜終点を移動中のスターマーカー
        const progress = Math.min(1, -dt / activeEnd);
        const x = from.x + (to.x - from.x) * progress;
        const y = from.y + (to.y - from.y) * progress;
        ctx.beginPath();
        ctx.arc(x, y, btnR * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = colorHex(n.color);
        ctx.fill();
      }
      return;
    }

    const dt = n.time - chartState.currentTime;
    if (dt < -0.15 || dt > travel) return;
    const progress = Math.min(1, Math.max(0, 1 - dt / travel));
    const hit = dt <= 0.15 && dt >= -0.15;
    const p = buttonPosition(n.button, cx, cy, r);

    if (n.type === "touch") {
      // タッチノーツはその場でフェードイン（中心から飛んでは来ない）
      ctx.save();
      ctx.globalAlpha = hit ? 1 : 0.35 + progress * 0.5;
      drawDiamond(ctx, p.x, p.y, hit ? btnR * 1.1 : btnR * 0.8);
      ctx.fillStyle = colorHex(n.color);
      ctx.fill();
      ctx.restore();
      return;
    }

    // タップノーツ：中心→ボタンへ接近
    const x = cx + (p.x - cx) * progress;
    const y = cy + (p.y - cy) * progress;
    ctx.beginPath();
    ctx.arc(x, y, hit ? btnR * 1.15 : btnR * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = colorHex(n.color);
    ctx.globalAlpha = hit ? 1 : 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  // 中心（タッチ判定エリアの目安を兼ねる）
  ctx.beginPath();
  ctx.arc(cx, cy, W * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = "#1B1830";
  ctx.fill();
  ctx.strokeStyle = chartState.editing && chartState.noteType === "touch" ? "#FF3B5C" : "#332C55";
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

/* ============ 曲の新規作成 ============ */
function resetSongNewForm(fromMode) {
  const form = document.getElementById("song-new-form");
  form.reset();
  form.querySelector('[name="bpm"]').value = "150";
  form.querySelector('[name="duration"]').value = "120";

  document.getElementById("song-new-back").onclick = () => navigate(fromMode || "chart");

  form.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const title = fd.get("title").trim();
    const difficulty = fd.get("difficulty");
    if (!title) return;
    const song = {
      id: slugify(title, difficulty),
      title,
      difficulty,
      level: fd.get("level") || "",
      bpm: Number(fd.get("bpm")) || 150,
      duration: Number(fd.get("duration")) || 120,
      notes: [],
    };
    localSongs.push(song);
    save("mm_local_songs", localSongs);
    navigate("chart-viewer", { songId: song.id });
  };
}

/* ============ Service Worker 登録 ============ */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
