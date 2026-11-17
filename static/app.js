/* ================= Category metadata ================= */
const ICONS = {
  metal: '<ellipse cx="12" cy="5" rx="7" ry="2.5"/><path d="M5 5v14c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5"/><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  plastic: '<path d="M10 2h4v3l2 3v12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8l2-3z"/><path d="M8 12h8"/>',
  ewaste: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  other: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/>',
  unknown: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  total: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24">${ICONS[name] || ICONS.unknown}</svg>`;

// UI accent colour, real LED colour (null = no single LED) and buzzer pattern per category
const CAT = {
  metal:   { label: "Metal",   color: "#dc2626", led: "#ef4444", ledName: "Red LED",   beep: "1 short beep",  buzzMs: 250 },
  plastic: { label: "Plastic", color: "#0284c7", led: "#e2e8f0", ledName: "White LED", beep: "2 short beeps", buzzMs: 600 },
  ewaste:  { label: "E-waste", color: "#16a34a", led: "#22c55e", ledName: "Green LED", beep: "3 short beeps", buzzMs: 900 },
  other:   { label: "Other",   color: "#64748b", led: null, ledName: "All LEDs blink", beep: "1 long beep", buzzMs: 1200 },
  unknown: { label: "Unknown", color: "#a855f7", led: null, ledName: "All LEDs blink", beep: "1 long beep", buzzMs: 1200 },
};
const LED_CMD = { metal: "METAL", plastic: "PLASTIC", ewaste: "EWASTE" };
const KPI_KEYS = ["metal", "plastic", "ewaste", "other"];

/* ================= State + helpers ================= */
const $ = (id) => document.getElementById(id);
let currentFile = null;
let categories = {};
let stream = null;
let expected = null; // expected category when a sample image is used
let modelReady = false;

function toast(msg, kind = "") {
  const t = $("toast");
  t.innerHTML = (kind ? svg(kind === "ok" ? "check" : "alert") : "") + `<span>${escapeHtml(msg)}</span>`;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const postJSON = (path, body) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const statusHtml = (cls, text) => `<i class="dot-s ${cls}"></i>${escapeHtml(text)}`;
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");

/* ================= Station visual ================= */
function buzz(ms) {
  const b = $("buzzer");
  b.classList.add("on");
  clearTimeout(b._timer);
  b._timer = setTimeout(() => b.classList.remove("on"), ms);
}

function showLeds(category) {
  const leds = document.querySelectorAll(".led");
  leds.forEach((l) => l.classList.remove("on", "blink"));
  const cmd = LED_CMD[category];
  if (cmd) {
    document.querySelector(`.led[data-cmd="${cmd}"]`).classList.add("on");
  } else if (category) {
    leds.forEach((l) => l.classList.add("blink"));
    setTimeout(() => leds.forEach((l) => l.classList.remove("blink")), 2400);
  }
}

/* ================= Status polling ================= */
async function refreshStatus(updatePorts = false) {
  try {
    const s = await api("/api/status");
    categories = s.categories;
    modelReady = s.model === "ready";

    $("modelStatus").innerHTML =
      s.model === "ready" ? statusHtml("ok", "Ready") : s.model === "error" ? statusHtml("err", "Error") : statusHtml("warn", "Loading");
    $("computeStatus").textContent = (s.device || "—").toUpperCase();
    $("scanBtn").disabled = !currentFile || !modelReady;

    const on = s.serial.connected;
    $("boardStatus").innerHTML = on ? statusHtml("ok", "Online") : statusHtml("err", "Offline");
    $("portStatus").textContent = s.serial.port || "—";
    $("headChip").innerHTML = on ? statusHtml("ok", `Station online · ${s.serial.port}`) : statusHtml("err", "Station offline");
    $("deviceChip").innerHTML = on ? statusHtml("ok", "Connected") : statusHtml("err", "Offline");
    const cb = $("connectBtn");
    if (!cb.disabled) {
      cb.textContent = on ? "Disconnect" : "Connect";
      cb.classList.toggle("primary", !on);
      cb.classList.toggle("danger", on);
    }

    if (updatePorts || !$("portSelect").options.length) {
      const sel = $("portSelect");
      sel.innerHTML = s.ports.length
        ? s.ports.map((p) => `<option value="${escapeHtml(p.device)}">${escapeHtml(p.device)} — ${escapeHtml(p.description)}</option>`).join("")
        : `<option value="">No serial ports found</option>`;
      if (s.serial.port) sel.value = s.serial.port;
    }

    renderKpis(s.stats);
    renderActivity(s.stats, s.history);
  } catch {
    $("modelStatus").innerHTML = statusHtml("err", "Server down");
  }
}

function renderKpis(stats) {
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const card = (key, label, value, color, share) => `
    <div class="kpi" style="--c:${color}">
      <div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-icon">${svg(key)}</span></div>
      <div class="kpi-val"><b>${value}</b><span>${share}</span></div>
      <div class="kpi-bar"><i style="width:${total ? (value / total) * 100 : 0}%"></i></div>
    </div>`;
  $("kpis").innerHTML =
    card("total", "Total scanned", total, "#0f172a", "this session").replace('style="width:0%"', 'style="width:100%"') +
    KPI_KEYS.map((k) => {
      const v = (stats[k] || 0) + (k === "other" ? stats.unknown || 0 : 0);
      return card(k, CAT[k].label, v, CAT[k].color, total ? Math.round((v / total) * 100) + "% of total" : "—");
    }).join("");
}

function renderActivity(stats, history) {
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  $("totalCount").textContent = `${total} item${total === 1 ? "" : "s"} processed this session`;

  const parts = KPI_KEYS.map((k) => [k, (stats[k] || 0) + (k === "other" ? stats.unknown || 0 : 0)]);
  $("dist").innerHTML = total
    ? parts.filter(([, v]) => v).map(([k, v]) => `<i style="--c:${CAT[k].color};width:${(v / total) * 100}%" title="${CAT[k].label}: ${v}"></i>`).join("")
    : "";
  $("distLegend").innerHTML = parts
    .map(([k, v]) => `<span><i class="dot" style="--c:${CAT[k].color}"></i>${CAT[k].label} <b>${v}</b></span>`)
    .join("");

  $("history").innerHTML = history.length
    ? history
        .map((h) => {
          const c = CAT[h.category] || CAT.unknown;
          return `<tr>
            <td class="item" title="${escapeHtml(h.name || "image")}">${escapeHtml(h.name || "image")}</td>
            <td><span class="tag" style="--c:${c.color}"><i class="dot" style="--c:${c.color}"></i>${c.label}</span></td>
            <td class="num">${(h.confidence * 100).toFixed(1)}%</td>
            <td class="num muted">${h.time}</td></tr>`;
        })
        .join("")
    : `<tr class="empty-row"><td colspan="4">No items scanned yet</td></tr>`;
}

/* ================= File selection ================= */
function setFile(file, expectedCategory = null) {
  if (!file || !file.type.startsWith("image/")) return toast("Please choose an image file", "err");
  closeCamera();
  expected = expectedCategory;
  if (!expectedCategory) document.querySelectorAll(".sample").forEach((s) => s.classList.remove("active"));
  currentFile = file;
  const img = $("preview");
  img.src = URL.createObjectURL(file);
  img.hidden = false;
  $("dzEmpty").hidden = true;
  $("dropzone").classList.add("has-image");
  $("fileMeta").innerHTML = `${svg("file")}<b>${escapeHtml(file.name)}</b><span>· ${fmtSize(file.size)}</span>`;
  refreshStatus().then(() => modelReady ? classify() : toast("AI model is still loading, please wait…"));
}

$("fileInput").addEventListener("change", (e) => { setFile(e.target.files[0]); e.target.value = ""; });
$("uploadBtn").addEventListener("click", () => $("fileInput").click());
const dz = $("dropzone");
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));
document.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) setFile(new File([item.getAsFile()], "pasted-image.png", { type: item.type }));
});

/* ================= Classification ================= */
async function classify() {
  if (!currentFile) return;
  $("scanBtn").disabled = true;
  $("scanning").hidden = false;
  const fd = new FormData();
  fd.append("image", currentFile);
  try {
    const r = await api("/api/classify", { method: "POST", body: fd });
    renderResult(r);
    showLeds(r.category);
    buzz((CAT[r.category] || CAT.unknown).buzzMs);
    refreshStatus();
  } catch (e) {
    toast(e.message, "err");
  } finally {
    $("scanning").hidden = true;
    $("scanBtn").disabled = !modelReady;
  }
}
$("scanBtn").addEventListener("click", classify);

function renderResult(r) {
  const c = CAT[r.category] || CAT.unknown;
  const card = document.querySelector(".result-card");
  card.style.setProperty("--c", c.color);

  $("resultEmpty").hidden = true;
  $("result").hidden = false;
  $("resultTime").textContent = `Completed at ${new Date().toLocaleTimeString([], { hour12: false })}`;
  $("resIcon").innerHTML = svg(r.category);
  $("resLabel").textContent = r.info.label;
  $("resMatched").textContent = r.category === "unknown" ? "Confidence below threshold" : `Closest match: ${r.matched}`;

  const pct = r.confidence * 100;
  $("resConf").textContent = Math.round(pct) + "%";
  const fill = $("gaugeFill");
  fill.style.strokeDashoffset = 213.6;
  requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.strokeDashoffset = 213.6 * (1 - r.confidence))));

  $("resLed").innerHTML = c.led ? `<span class="led-dot" style="--c:${c.led}"></span>${c.ledName}` : c.ledName;
  $("resBeep").textContent = c.beep;
  $("resBin").textContent = r.info.bin;
  $("resTip").textContent = r.info.tip;

  const v = $("verdict");
  if (expected) {
    const ok = expected === r.category;
    v.className = "verdict " + (ok ? "ok" : "bad");
    v.innerHTML = ok ? `${svg("check")}Matches sample` : `Expected ${escapeHtml((CAT[expected] || {}).label || expected)}`;
    v.hidden = false;
  } else v.hidden = true;

  const ls = $("resLedStatus");
  if (r.led.sent) { ls.className = "signal ok"; ls.innerHTML = `${svg("check")}Station acknowledged: <span class="mono">${escapeHtml(r.led.reply)}</span>`; }
  else { ls.className = "signal err"; ls.innerHTML = `${svg("alert")}Station not signalled: ${escapeHtml(r.led.error)}`; }

  const entries = Object.entries(r.scores);
  $("scores").innerHTML = entries
    .map(([k, val], i) => {
      const cc = CAT[k] || CAT.unknown;
      return `<div class="score ${i === 0 ? "top" : ""}"><span><i class="dot" style="--c:${cc.color}"></i>${cc.label}</span>
        <div class="bar"><i style="--c:${cc.color}" data-w="${(val * 100).toFixed(1)}"></i></div><em>${(val * 100).toFixed(1)}%</em></div>`;
    })
    .join("");
  requestAnimationFrame(() => document.querySelectorAll(".bar i").forEach((b) => (b.style.width = b.dataset.w + "%")));
}

/* ================= Camera ================= */
async function openCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    $("video").srcObject = stream;
    $("cameraWrap").hidden = false;
    $("dropzone").hidden = true;
    $("segCamera").classList.add("active");
    $("segUpload").classList.remove("active");
  } catch {
    toast("Camera not available on this device", "err");
  }
}
function closeCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $("cameraWrap").hidden = true;
  $("dropzone").hidden = false;
  $("segUpload").classList.add("active");
  $("segCamera").classList.remove("active");
}
$("segCamera").addEventListener("click", openCamera);
$("segUpload").addEventListener("click", closeCamera);
$("cameraClose").addEventListener("click", closeCamera);
$("snapBtn").addEventListener("click", () => {
  const v = $("video");
  const c = document.createElement("canvas");
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  c.toBlob((b) => setFile(new File([b], `capture-${Date.now()}.jpg`, { type: "image/jpeg" })), "image/jpeg", 0.92);
});

/* ================= Hardware controls ================= */
$("connectBtn").addEventListener("click", async () => {
  const btn = $("connectBtn");
  const disconnecting = btn.textContent === "Disconnect";
  btn.disabled = true;
  btn.textContent = disconnecting ? "Disconnecting…" : "Connecting…";
  try {
    if (disconnecting) { await postJSON("/api/disconnect"); toast("Station disconnected"); }
    else { const r = await postJSON("/api/connect", { port: $("portSelect").value }); toast(`Connected to ${r.port}`, "ok"); }
  } catch (e) {
    toast(e.message, "err");
  } finally {
    btn.disabled = false;
    refreshStatus();
  }
});
$("refreshBtn").addEventListener("click", () => { refreshStatus(true); toast("Port list refreshed"); });

async function sendCmd(cmd) {
  try {
    const r = await postJSON("/api/led", { command: cmd });
    toast(`Station: ${r.reply}`, "ok");
  } catch (e) {
    toast(e.message, "err");
  }
}
document.querySelectorAll(".led").forEach((l) =>
  l.addEventListener("click", () => {
    const cat = Object.keys(LED_CMD).find((k) => LED_CMD[k] === l.dataset.cmd);
    showLeds(cat);
    buzz(CAT[cat].buzzMs);
    sendCmd(l.dataset.cmd);
  })
);
$("buzzer").addEventListener("click", () => { buzz(400); sendCmd("BEEP"); });
document.querySelectorAll("[data-send]").forEach((b) =>
  b.addEventListener("click", () => {
    const cmd = b.dataset.send;
    if (cmd === "OFF") showLeds(null);
    else { document.querySelectorAll(".led").forEach((l) => l.classList.add("on")); buzz(2500); setTimeout(() => showLeds(null), 2500); }
    sendCmd(cmd);
  })
);

/* ================= Sample library ================= */
async function loadSamples() {
  try {
    const items = await api("/api/samples");
    $("samples").innerHTML = items.length
      ? items
          .map((it) => {
            const c = CAT[it.expected] || CAT.other;
            return `<button type="button" class="sample" data-url="${escapeHtml(it.url)}" data-file="${escapeHtml(it.file)}" data-expected="${escapeHtml(it.expected)}" title="${escapeHtml(it.name)}">
              <img src="${escapeHtml(it.url)}" alt="${escapeHtml(it.name)}" loading="lazy">
              <div class="sample-cap"><i class="dot" style="--c:${c.color}"></i>${escapeHtml(it.name)}</div></button>`;
          })
          .join("")
      : `<span class="muted">No samples in static/samples.</span>`;
    document.querySelectorAll(".sample").forEach((b) => b.addEventListener("click", () => pickSample(b)));
  } catch {
    $("samples").innerHTML = `<span class="muted">Could not load samples.</span>`;
  }
}

async function pickSample(btn) {
  document.querySelectorAll(".sample").forEach((s) => s.classList.remove("active"));
  btn.classList.add("active");
  const blob = await (await fetch(btn.dataset.url)).blob();
  setFile(new File([blob], btn.dataset.file, { type: blob.type || "image/jpeg" }), btn.dataset.expected);
}

document.querySelectorAll("#sampleFilters .filter").forEach((f) =>
  f.addEventListener("click", () => {
    document.querySelectorAll("#sampleFilters .filter").forEach((x) => x.classList.toggle("active", x === f));
    document.querySelectorAll(".sample").forEach((s) => (s.hidden = f.dataset.f !== "all" && s.dataset.expected !== f.dataset.f));
  })
);

/* ================= Sidebar active section ================= */
const navItems = [...document.querySelectorAll(".nav-item")];
const observer = new IntersectionObserver(
  (entries) => entries.forEach((e) => {
    if (e.isIntersecting) navItems.forEach((n) => n.classList.toggle("active", n.getAttribute("href") === "#" + e.target.id));
  }),
  { rootMargin: "-40% 0px -55% 0px" }
);
["scan", "device", "activity"].forEach((id) => observer.observe($(id)));

/* ================= Init ================= */
renderKpis({});
refreshStatus(true);
loadSamples();
setInterval(refreshStatus, 3000);
