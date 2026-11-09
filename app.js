import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, getDocs, getDoc, doc, addDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, increment, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, TMDB_KEY, ADMIN_EMAIL } from "./firebase-config.js";

const fb = initializeApp(firebaseConfig);
const db = getFirestore(fb);
const auth = getAuth(fb);
const TM = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/";
const hasTmdb = () => TMDB_KEY && !/^PUT_/.test(TMDB_KEY);

/* ============================================================
   أدوات مساعدة
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { try { localStorage.removeItem(k); } catch {} } }
};
const sortEps = (eps = []) => [...eps].sort((a, b) => a.s - b.s || a.e - b.e);
const ytId = (u = "") => {
  const m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return m && m[1];
};
// "1080p@رابط ; 720p@رابط"  أو رابط واحد عادي
function parseList(str = "") {
  return String(str).split(/\s*;\s*(?=(?:[^@:/;]{1,16}@)?https?:)/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^([^@:/]{1,16})@(https?:\/\/\S+)$/);
    return m ? { label: m[1].trim(), url: m[2] } : { label: "", url: p };
  });
}
const fmtNum = (n) => Number(n || 0).toLocaleString("ar-EG");
const isNew = (t) => t._ts && Date.now() - t._ts < 7 * 864e5;

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}
function openModal(html) {
  $("#modal").innerHTML = `<div class="mbk" id="mbk"><div class="mbox"><button class="mx" aria-label="إغلاق">✕</button>${html}</div></div>`;
  $("#mbk").onclick = (e) => { if (e.target.id === "mbk" || e.target.classList.contains("mx")) closeModal(); };
  const x = $(".mx"); if (x) x.focus();
}
function closeModal() { $("#modal").innerHTML = ""; }

/* ============================================================
   الإعدادات: مظهر + وضع التلفزيون
   ============================================================ */
let TV = LS.get("tv", null);
if (TV === null) TV = /tizen|web0s|webos|smart-?tv|android ?tv|bravia|hbbtv|crkey/i.test(navigator.userAgent) || /[?&#]tv=1/.test(location.href);
function applyTV() { document.body.classList.toggle("tv", !!TV); }
function applyTheme() {
  const light = LS.get("theme", "dark") === "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  const m = $('meta[name="theme-color"]'); if (m) m.content = light ? "#f6f6fa" : "#0b0b12";
}
applyTV(); applyTheme();
$("#themeBtn").onclick = () => { LS.set("theme", LS.get("theme", "dark") === "light" ? "dark" : "light"); applyTheme(); };

let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; });
window.addEventListener("appinstalled", () => { deferredInstall = null; });

/* ============================================================
   بيانات المستخدم (قائمتي، التقدم، كمّل مشاهدة) + مزامنة سحابية
   ============================================================ */
const D = {
  favs: LS.get("favs", []),
  prog: LS.get("prog", {}),
  recent: LS.get("recent", []),
  seen: LS.get("seen", null),
  last: LS.get("lastVisit", 0)
};
let user = null, isAdmin = false, syncErr = false, cloudTimer = 0, ready = false;

function saveLocal() { LS.set("favs", D.favs); LS.set("prog", D.prog); LS.set("recent", D.recent); LS.set("seen", D.seen); }
function commit(delay = 15000) { saveLocal(); scheduleCloud(delay); }
let cloudDue = 0;
function scheduleCloud(delay) {
  if (!user) return;
  const due = Date.now() + delay;
  if (cloudTimer && cloudDue <= due) return;
  clearTimeout(cloudTimer); cloudDue = due;
  cloudTimer = setTimeout(() => { cloudTimer = 0; pushCloud(); }, delay);
}
function prune() {
  const ks = Object.keys(D.prog);
  if (ks.length > 300) { ks.sort((a, b) => (D.prog[b].u || 0) - (D.prog[a].u || 0)); ks.slice(300).forEach((k) => delete D.prog[k]); }
}
async function pushCloud() {
  if (!user) return;
  try {
    prune();
    await setDoc(doc(db, "users", user.uid), { favs: D.favs, prog: D.prog, recent: D.recent, seen: D.seen || {}, updated: Date.now() });
    syncErr = false;
  } catch (e) { console.warn("cloud push", e); syncErr = true; }
}
function mergeCloud(c, same) {
  D.favs = same ? (c.favs || []) : [...new Set([...(c.favs || []), ...D.favs])];
  for (const [k, v] of Object.entries(c.prog || {})) if (!D.prog[k] || (v.u || 0) > (D.prog[k].u || 0)) D.prog[k] = v;
  const m = new Map();
  [...(c.recent || []), ...D.recent].forEach((r) => { const o = m.get(r.id); if (!o || (r.u || 0) > (o.u || 0)) m.set(r.id, r); });
  D.recent = [...m.values()].sort((a, b) => (b.u || 0) - (a.u || 0)).slice(0, 12);
  if (c.seen) { D.seen = D.seen || {}; for (const [k, v] of Object.entries(c.seen)) D.seen[k] = Math.max(D.seen[k] || 0, v); }
}
async function pullCloud() {
  try {
    const s = await getDoc(doc(db, "users", user.uid));
    const same = LS.get("syncUid", null) === user.uid;
    if (s.exists()) mergeCloud(s.data(), same);
    LS.set("syncUid", user.uid);
    syncErr = false;
    commit(0);
  } catch (e) { console.warn("cloud pull", e); syncErr = true; }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { saveLocal(); if (user) pushCloud(); } });

const progKey = (id, s, e) => (s != null && s !== "" ? `${id}_${s}_${e}` : id);
const pctOf = (key) => { const p = D.prog[key]; return p && p.d ? Math.min(100, Math.round((p.t / p.d) * 100)) : 0; };
const lastOf = (t) => D.recent.find((r) => r.id === t.id);
function touchRecent(id, cur) {
  D.recent = [{ id, s: cur ? cur.s : null, e: cur ? cur.e : null, u: Date.now() }, ...D.recent.filter((r) => r.id !== id)].slice(0, 12);
  commit();
}
function playHref(t, s, e) {
  if (t.type !== "series") return `#/watch/${t.id}`;
  const eps = sortEps(t.episodes);
  if (!eps.length) return `#/title/${t.id}`;
  if (s != null) return `#/watch/${t.id}/${s}/${e}`;
  const l = lastOf(t);
  const hit = l && eps.find((x) => x.s == l.s && x.e == l.e);
  const pick = hit || eps[0];
  return `#/watch/${t.id}/${pick.s}/${pick.e}`;
}
function cardPct(t) {
  if (t.type !== "series") return pctOf(t.id);
  const l = lastOf(t); return l ? pctOf(progKey(t.id, l.s, l.e)) : 0;
}

/* ============================================================
   المحتوى
   ============================================================ */
let titles = [], loadError = "";
const TTL = 3 * 60 * 1000;
async function loadTitles(force = false) {
  loadError = "";
  const c = LS.get("tcache", null);
  if (!force && c && Array.isArray(c.data) && Date.now() - c.at < TTL) { titles = c.data; return; }
  try {
    const snap = await getDocs(query(collection(db, "titles"), orderBy("createdAt", "desc")));
    titles = snap.docs.map((d) => {
      const { createdAt, ...r } = d.data();
      return { id: d.id, ...r, _ts: createdAt && createdAt.seconds ? createdAt.seconds * 1000 : 0 };
    });
    LS.set("tcache", { at: Date.now(), data: titles });
  } catch (e) {
    console.error(e);
    if (c && Array.isArray(c.data)) titles = c.data;
    else loadError = "تعذر تحميل المحتوى. تأكد من الإنترنت ومن إعدادات Firebase.";
  }
}

/* إشعارات داخل التطبيق (جديد / حلقات جديدة) */
function initSeen() {
  const now = Date.now();
  if (D.seen === null) {
    D.seen = {}; titles.forEach((t) => (D.seen[t.id] = (t.episodes || []).length));
    D.last = now; LS.set("lastVisit", now); commit(); return;
  }
  titles.forEach((t) => {
    const c = (t.episodes || []).length;
    if (!(t.id in D.seen)) { if (!(t._ts > D.last)) D.seen[t.id] = c; }
    else if (c < D.seen[t.id]) D.seen[t.id] = c;
  });
}
function notifs() {
  if (D.seen === null) return [];
  const out = [];
  for (const t of titles) {
    const c = (t.episodes || []).length;
    if (!(t.id in D.seen)) { if (t._ts > D.last) out.push({ t, kind: "new" }); }
    else if (t.type === "series" && c > D.seen[t.id]) out.push({ t, kind: "ep", n: c - D.seen[t.id] });
  }
  return out;
}
function markSeen() {
  D.seen = D.seen || {};
  titles.forEach((t) => (D.seen[t.id] = (t.episodes || []).length));
  D.last = Date.now(); LS.set("lastVisit", D.last); commit(2000); updateBadge();
}
function updateBadge() {
  const n = notifs().length, b = $("#nb");
  b.textContent = n > 9 ? "9+" : n; b.hidden = !n;
}

/* ممثلين وتريلر من TMDB */
function pickExtras(d) {
  const cast = ((d.credits && d.credits.cast) || []).slice(0, 12).map((c) => ({ n: c.name, c: c.character || "", p: c.profile_path || "" }));
  const vids = (d.videos && d.videos.results) || [];
  const v = vids.find((x) => x.site === "YouTube" && x.type === "Trailer") || vids.find((x) => x.site === "YouTube");
  return { cast, trailer: v ? v.key : "" };
}
async function getExtras(t) {
  if (t.cast || t.trailer) return { cast: t.cast || [], trailer: t.trailer || "" };
  const key = "tm_" + t.id, c = LS.get(key, null);
  if (c) return c;
  if (!hasTmdb()) return {};
  try {
    const type = t.type === "series" ? "tv" : "movie";
    const yr = t.year ? (type === "tv" ? "&first_air_date_year=" : "&year=") + encodeURIComponent(t.year) : "";
    const j = await (await fetch(`${TM}/search/${type}?api_key=${TMDB_KEY}&language=ar&query=${encodeURIComponent(t.title)}${yr}`)).json();
    const hit = (j.results || [])[0];
    if (!hit) { LS.set(key, {}); return {}; }
    const d = await (await fetch(`${TM}/${type}/${hit.id}?api_key=${TMDB_KEY}&language=ar&append_to_response=credits,videos&include_video_language=ar,en,null`)).json();
    const out = pickExtras(d); LS.set(key, out); return out;
  } catch { return {}; }
}

/* ============================================================
   مكونات العرض
   ============================================================ */
const card = (t, href, pct) =>
  `<a class="card" href="${href || "#/title/" + t.id}">
     <div class="pw"><img loading="lazy" src="${esc(t.poster)}" alt="" onerror="this.style.visibility='hidden'">${isNew(t) ? '<span class="tag">جديد</span>' : ""}${pct ? `<div class="pbar2"><i style="width:${pct}%"></i></div>` : ""}</div>
     <b>${esc(t.title)}</b>
     <small>${esc(t.year || "")} ${t.rating ? "⭐ " + esc(t.rating) : ""}</small>
   </a>`;
const cardOf = (t) => card(t, null, 0);
const rowOf = (name, list, more) =>
  list.length ? `<section><h2><span>${name}</span>${more ? `<a href="${more}">عرض الكل ›</a>` : ""}</h2><div class="row">${list.map(cardOf).join("")}</div></section>` : "";
const emptyView = (msg) => (app.innerHTML = `<div class="empty">${msg}</div>`);
const rating = (t) => parseFloat(t.rating) || 0;

/* ---------- الرئيسية ---------- */
function homeView() {
  if (loadError) return emptyView(esc(loadError));
  if (!titles.length) return emptyView(`لسه مفيش محتوى 🎬<br>سجّل دخول بحساب الأدمن من تبويب «حسابي» وضيف أول فيلم.`);
  const slides = titles.slice(0, 5);
  const recent = D.recent.map((r) => ({ r, t: titles.find((x) => x.id === r.id) })).filter((x) => x.t);
  const gc = new Map();
  titles.forEach((t) => (t.genres || []).forEach((g) => gc.set(g, (gc.get(g) || 0) + 1)));
  const gens = [...gc.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  app.innerHTML = `
    <div class="hero" id="hero">${slides.map((t, i) => `
      <div class="slide${i ? "" : " on"}" style="background-image:url('${esc(t.backdrop || t.poster)}')"><div class="hc">
        <h1>${esc(t.title)}</h1>
        <div class="meta2">${esc(t.year || "")} ${t.rating ? "• ⭐ " + esc(t.rating) : ""} ${(t.genres || []).slice(0, 2).length ? "• " + esc(t.genres.slice(0, 2).join("، ")) : ""}</div>
        <p>${esc((t.overview || "").slice(0, 120))}</p>
        <div class="btns"><a class="btn" href="${playHref(t)}">▶ شاهد</a><a class="btn alt" href="#/title/${t.id}">تفاصيل</a></div>
      </div></div>`).join("")}</div>
    ${gens.length ? `<div class="chips" style="margin-top:14px">${gens.slice(0, 12).map((g) => `<a class="chip" href="#/genre/${encodeURIComponent(g)}">${esc(g)}</a>`).join("")}</div>` : ""}
    ${recent.length ? `<section><h2><span>كمّل مشاهدة</span></h2><div class="row">${recent.map(({ r, t }) => card(t, playHref(t, r.s, r.e), pctOf(progKey(t.id, r.s, r.e)))).join("")}</div></section>` : ""}
    ${rowOf("أحدث الإضافات", titles.slice(0, 12))}
    ${rowOf("الأعلى تقييماً", [...titles].filter((t) => rating(t) > 0).sort((a, b) => rating(b) - rating(a)).slice(0, 12))}
    ${gens.slice(0, 6).map((g) => rowOf(esc(g), titles.filter((t) => (t.genres || []).includes(g)).slice(0, 12), "#/genre/" + encodeURIComponent(g))).join("")}`;
  if (slides.length > 1) {
    let i = 0;
    const iv = setInterval(() => {
      const els = $$("#hero .slide"); if (!els.length) return;
      els[i].classList.remove("on"); i = (i + 1) % els.length; els[i].classList.add("on");
    }, 6000);
    onLeave(() => clearInterval(iv));
  }
}

/* ---------- تصفح مع فلترة وترتيب ---------- */
const F = {};
const sorters = {
  new: (a, b) => (b._ts || 0) - (a._ts || 0),
  rate: (a, b) => rating(b) - rating(a),
  year: (a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0),
  name: (a, b) => String(a.title).localeCompare(String(b.title), "ar"),
  views: (a, b) => (b.views || 0) - (a.views || 0)
};
function browseView(key, title, base, g0 = "") {
  const st = F[key] || (F[key] = { g: g0, sort: "new", year: "", minr: "" });
  const gs = [...new Set(base.flatMap((t) => t.genres || []))];
  const ys = [...new Set(base.map((t) => t.year).filter(Boolean))].sort().reverse();
  app.innerHTML = `
    <h1 class="pgtitle">${esc(title)}</h1>
    <div class="chips" id="chips"><button class="chip" data-g="">الكل</button>${gs.map((g) => `<button class="chip" data-g="${esc(g)}">${esc(g)}</button>`).join("")}</div>
    <div class="filters">
      <select id="fsort" aria-label="ترتيب"><option value="new">الأحدث إضافة</option><option value="rate">الأعلى تقييماً</option><option value="year">الأحدث إصداراً</option><option value="views">الأكثر مشاهدة</option><option value="name">الاسم</option></select>
      <select id="fyear" aria-label="السنة"><option value="">كل السنين</option>${ys.map((y) => `<option>${esc(y)}</option>`).join("")}</select>
      <select id="frate" aria-label="التقييم"><option value="">كل التقييمات</option><option value="6">+6</option><option value="7">+7</option><option value="8">+8</option></select>
    </div>
    <div id="bres"></div>`;
  $("#fsort").value = st.sort; $("#fyear").value = st.year; $("#frate").value = st.minr;
  const draw = () => {
    $$("#chips .chip").forEach((c) => c.classList.toggle("on", c.dataset.g === st.g));
    const l = base.filter((t) => (!st.g || (t.genres || []).includes(st.g)) && (!st.year || String(t.year) === st.year) && (!st.minr || rating(t) >= +st.minr)).sort(sorters[st.sort]);
    $("#bres").innerHTML = l.length ? `<div class="grid">${l.map(cardOf).join("")}</div>` : `<div class="empty">مفيش نتائج</div>`;
  };
  $("#chips").onclick = (e) => { const b = e.target.closest(".chip"); if (b) { st.g = b.dataset.g; draw(); } };
  $("#fsort").onchange = (e) => { st.sort = e.target.value; draw(); };
  $("#fyear").onchange = (e) => { st.year = e.target.value; draw(); };
  $("#frate").onchange = (e) => { st.minr = e.target.value; draw(); };
  draw();
}

function searchView() {
  app.innerHTML = `<div class="form"><input id="q" type="search" placeholder="ابحث عن فيلم أو مسلسل أو نوع..." autocomplete="off"></div><div id="res" class="grid"></div>`;
  const q = $("#q");
  const run = () => {
    const v = q.value.trim().toLowerCase();
    const l = v ? titles.filter((t) => (t.title || "").toLowerCase().includes(v) || (t.genres || []).join(" ").toLowerCase().includes(v) || String(t.year || "").includes(v)) : [];
    $("#res").innerHTML = l.map(cardOf).join("") || (v ? `<div class="empty" style="grid-column:1/-1">مفيش نتائج</div>` : "");
  };
  q.addEventListener("input", run);
  if (!TV) q.focus();
}

function favsView() {
  const l = titles.filter((t) => D.favs.includes(t.id));
  app.innerHTML = `<h1 class="pgtitle">قائمتي ❤️</h1>` + (l.length ? `<div class="grid">${l.map(cardOf).join("")}</div>` : `<div class="empty">لسه ما ضفتش حاجة لقائمتك.${user ? "" : "<br>سجّل دخول عشان قائمتك تتحفظ على كل أجهزتك."}</div>`);
}

function notifsView() {
  const l = notifs();
  app.innerHTML = `<h1 class="pgtitle">الإشعارات 🔔</h1>` +
    (l.length ? l.map(({ t, kind, n }) => `<a class="nt" href="#/title/${t.id}"><img src="${esc(t.poster)}" alt="" onerror="this.style.visibility='hidden'"><div><b>${esc(t.title)}</b><small>${kind === "new" ? "🆕 إضافة جديدة" : `📺 ${n} حلقة جديدة`}</small></div></a>`).join("")
      : `<div class="empty">مفيش إشعارات جديدة 👌</div>`);
  if (l.length) markSeen();
}

/* ---------- صفحة التفاصيل ---------- */
function titleView(id) {
  const t = titles.find((x) => x.id === id);
  if (!t) return emptyView("العنوان غير موجود");
  const isFav = D.favs.includes(id);
  const eps = sortEps(t.episodes);
  const seasons = [...new Set(eps.map((x) => x.s))];
  const key0 = t.type === "series" ? (eps[0] ? progKey(id, eps[0].s, eps[0].e) : "") : id;
  const l = lastOf(t);
  const lp = t.type === "series" ? (l ? pctOf(progKey(id, l.s, l.e)) : 0) : pctOf(id);
  const resumed = t.type === "series" ? !!l : lp > 2 && lp < 95;
  const sim = titles.filter((x) => x.id !== id)
    .map((x) => ({ x, n: (x.genres || []).filter((g) => (t.genres || []).includes(g)).length }))
    .filter((o) => o.n > 0).sort((a, b) => b.n - a.n || rating(b.x) - rating(a.x)).slice(0, 12).map((o) => o.x);
  app.innerHTML = `
    <div class="detail">
      <div class="bd" style="background-image:url('${esc(t.backdrop || t.poster)}')"></div>
      <div class="info">
        <img class="pp" src="${esc(t.poster)}" alt="" onerror="this.style.visibility='hidden'">
        <h1>${esc(t.title)}</h1>
        <div class="meta">${esc(t.year || "")} • ${t.type === "series" ? "مسلسل" : "فيلم"} ${t.rating ? "• ⭐ " + esc(t.rating) : ""} ${(t.genres || []).length ? "• " + esc(t.genres.join("، ")) : ""} ${t.views ? "• 👁 " + fmtNum(t.views) : ""}</div>
        <p>${esc(t.overview || "")}</p>
        <div class="btns">
          <a class="btn" href="${playHref(t)}">${resumed ? "▶ كمّل المشاهدة" : "▶ شاهد الآن"}</a>
          ${resumed ? `<button class="btn alt" id="rst">↺ من البداية</button>` : ""}
          <button class="btn alt" id="fav">${isFav ? "💔 إزالة من قائمتي" : "❤️ أضف لقائمتي"}</button>
          <button class="btn alt" id="trl" hidden>🎬 التريلر</button>
        </div>
        ${t.type === "series" && seasons.length ? `<select id="ss" aria-label="الموسم">${seasons.map((s) => `<option value="${s}">الموسم ${s}</option>`).join("")}</select><div id="eps"></div>` : ""}
        <div id="extras" data-id="${esc(id)}"></div>
        ${sim.length ? `<h3 class="sub">أفلام ومسلسلات مشابهة</h3><div class="row sim">${sim.map(cardOf).join("")}</div>` : ""}
      </div>
    </div>`;
  $("#fav").onclick = () => {
    D.favs = isFav ? D.favs.filter((x) => x !== id) : [...D.favs, id];
    commit(2000); titleView(id);
  };
  const rst = $("#rst");
  if (rst) rst.onclick = () => {
    if (t.type === "series") { D.recent = D.recent.filter((r) => r.id !== id); Object.keys(D.prog).forEach((k) => k.startsWith(id + "_") && delete D.prog[k]); }
    else delete D.prog[id];
    commit(2000); location.hash = playHref(t);
  };
  if (t.type === "series" && seasons.length) {
    const draw = () => {
      const s = +$("#ss").value;
      $("#eps").innerHTML = eps.filter((x) => x.s === s).map((x) => {
        const p = pctOf(progKey(id, x.s, x.e));
        return `<a class="ep" href="#/watch/${id}/${x.s}/${x.e}"><b>${x.e}</b><div class="et">الحلقة ${x.e}${p ? `<div class="pr"><i style="width:${p}%"></i></div>` : ""}</div><span>${p >= 90 ? "✓" : "▶"}</span></a>`;
      }).join("");
    };
    if (l) { const sv = seasons.includes(+l.s) ? l.s : seasons[0]; $("#ss").value = sv; }
    $("#ss").onchange = draw; draw();
  }
  getExtras(t).then((x) => {
    const ex = $("#extras"); if (!ex || ex.dataset.id !== id) return;
    if (x.trailer) { const b = $("#trl"); b.hidden = false; b.onclick = () => openModal(`<iframe src="https://www.youtube-nocookie.com/embed/${esc(x.trailer)}?autoplay=1&rel=0" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe>`); }
    if (x.cast && x.cast.length) ex.innerHTML = `<h3 class="sub">الممثلون</h3><div class="cast">${x.cast.map((c) => `<div class="cm"><img loading="lazy" src="${c.p ? TMDB_IMG + "w185" + c.p : ""}" alt="" onerror="this.style.visibility='hidden'">${esc(c.n)}<small>${esc(c.c)}</small></div>`).join("")}</div>`;
  });
}

/* ============================================================
   المشغّل
   ============================================================ */
let player = null, hlsPromise;
const loadHls = () => window.Hls ? Promise.resolve() : (hlsPromise ||= new Promise((res) => {
  const s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js";
  s.onload = res; s.onerror = res; document.head.appendChild(s);
}));
const counted = new Set();
function countView(t, key) {
  if (!user || counted.has(key)) return;
  counted.add(key);
  updateDoc(doc(db, "titles", t.id), { views: increment(1) }).catch(() => {});
}
function srt2vtt(s) {
  return "WEBVTT\n\n" + s.replace(/\r+/g, "").replace(/^\uFEFF/, "").replace(/(\d+:\d\d:\d\d),(\d{3})/g, "$1.$2").trim() + "\n";
}
async function subToUrl(url) {
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    let txt;
    try { txt = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { txt = new TextDecoder("windows-1256").decode(buf); }
    if (!/^\uFEFF?WEBVTT/.test(txt)) txt = srt2vtt(txt);
    return URL.createObjectURL(new Blob([txt], { type: "text/vtt" }));
  } catch { return url; }
}

async function watchView(id, s, e) {
  const t = titles.find((x) => x.id === id);
  if (!t) return emptyView("العنوان غير موجود");
  let cur = null, eps = [], idx = -1, srcRaw = t.videoUrl || "", subsRaw = t.subs || "", label = t.title;
  if (t.type === "series") {
    eps = sortEps(t.episodes); idx = eps.findIndex((x) => x.s == s && x.e == e);
    if (idx < 0) return emptyView("الحلقة غير موجودة");
    cur = eps[idx]; srcRaw = cur.url; subsRaw = cur.subs || ""; label = `${t.title} - م${cur.s} ح${cur.e}`;
  }
  const sources = parseList(srcRaw);
  if (!sources.length) return emptyView("مفيش رابط فيديو لده لسه");
  const key = progKey(id, cur ? cur.s : null, cur ? cur.e : null);
  const next = eps[idx + 1], prev = eps[idx - 1];
  const href = (x) => `#/watch/${id}/${x.s}/${x.e}`;
  touchRecent(id, cur);

  const yt = ytId(sources[0].url);
  const nav = `${prev ? `<a class="btn sm alt" href="${href(prev)}">⏮ السابقة</a>` : ""}${next ? `<a class="btn sm" href="${href(next)}">التالية ⏭</a>` : ""}`;
  app.innerHTML = `
    <div class="player" id="pl">
      <div class="ptop"><button id="bk" aria-label="رجوع">→</button><span>${esc(label)}</span></div>
      <div class="vwrap">
        ${yt ? `<iframe src="https://www.youtube.com/embed/${yt}?autoplay=1" allow="autoplay; fullscreen" allowfullscreen></iframe>`
             : `<video id="v" playsinline autoplay controls preload="auto"></video><div id="perr" class="perr" hidden></div><button id="skip" class="skip" hidden>تخطي المقدمة ⏭</button>`}
        ${LS.get("bug", true) ? `<div class="bug" aria-hidden="true"><img src="icon.svg" alt=""><span>LUKA<b>TV</b></span></div>` : ""}
      </div>
      <div class="pbar">
        ${yt ? nav : `
        <button id="b10" aria-label="رجوع 10 ثواني">⏪ 10</button><button id="f10" aria-label="تقديم 10 ثواني">10 ⏩</button>
        ${nav}
        <select id="spd" aria-label="السرعة">${[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => `<option value="${r}">${r}x</option>`).join("")}</select>
        ${sources.length > 1 ? `<select id="qs" aria-label="الجودة">${sources.map((x, i) => `<option value="${i}">${esc(x.label || "الجودة " + (i + 1))}</option>`).join("")}</select>` : ""}
        <select id="ss" aria-label="الترجمة" hidden></select>
        <button id="cst" hidden aria-label="عرض على الشاشة">📡</button><button id="pip" hidden aria-label="صورة داخل صورة">🗗</button><button id="fs" aria-label="ملء الشاشة">⛶</button>`}
      </div>
    </div>`;
  $("#bk").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/title/" + id));
  if (yt) { onLeave(() => { player = null; }); return; }

  const v = $("#v"), perr = $("#perr");
  let hls = null, pendingSeek = null, leaving = false, wl = null, lastSave = 0, counted1 = false;
  const p0 = D.prog[key];
  if (p0 && p0.t > 5) pendingSeek = p0.t;
  player = { v, toggleFs: () => $("#fs").click() };

  const lock = async () => { try { if ("wakeLock" in navigator) wl = await navigator.wakeLock.request("screen"); } catch {} };
  const unlock = () => { try { wl && wl.release(); } catch {} wl = null; };
  function load(url) {
    perr.hidden = true;
    if (hls) { hls.destroy(); hls = null; }
    const isHls = /\.m3u8(\?|$)/i.test(url);
    if (isHls && !v.canPlayType("application/vnd.apple.mpegurl")) {
      loadHls().then(() => {
        if (leaving) return;
        if (window.Hls && Hls.isSupported()) { hls = new Hls(); hls.loadSource(url); hls.attachMedia(v); }
        else v.src = url;
        v.play().catch(() => {});
      });
    } else { v.src = url; v.play().catch(() => {}); }
  }
  v.addEventListener("loadedmetadata", () => {
    if (pendingSeek != null) {
      if (!(p0 && pendingSeek === p0.t && v.duration && pendingSeek > v.duration - 30)) v.currentTime = pendingSeek;
      pendingSeek = null;
    }
  });
  v.addEventListener("error", () => {
    if (leaving) return;
    perr.hidden = false;
    perr.innerHTML = `تعذر تشغيل الفيديو 😕<br><small>تأكد إن الرابط مباشر (mp4 أو m3u8) وشغّال${sources.length > 1 ? "، أو جرّب جودة تانية" : ""}.</small>`;
  });
  v.addEventListener("playing", () => { perr.hidden = true; if (!counted1) { counted1 = true; countView(t, key); } });
  v.addEventListener("play", lock);
  v.addEventListener("pause", () => { unlock(); saveProg(); });
  v.addEventListener("seeked", () => saveProg());
  const saveProg = () => {
    if (!v.duration || isNaN(v.duration)) return;
    D.prog[key] = { t: Math.floor(v.currentTime), d: Math.floor(v.duration), u: Date.now() }; commit();
  };
  const i0 = +t.introStart || 0, i1 = +t.introEnd || 0, skip = $("#skip");
  v.addEventListener("timeupdate", () => {
    const now = Date.now();
    if (now - lastSave > 5000) { lastSave = now; saveProg(); }
    if (i1) skip.hidden = !(v.currentTime >= i0 && v.currentTime < i1 - 1);
  });
  skip.onclick = () => { v.currentTime = i1; skip.hidden = true; };
  v.addEventListener("ended", () => { saveProg(); if (next) location.hash = href(next); });
  const onVis = () => { if (document.visibilityState === "visible" && !v.paused) lock(); };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pagehide", saveProg);

  /* السرعة */
  const rate = LS.get("rate", 1);
  $("#spd").value = String(rate); v.defaultPlaybackRate = rate; v.playbackRate = rate;
  $("#spd").onchange = (ev) => { const r = +ev.target.value; LS.set("rate", r); v.defaultPlaybackRate = r; v.playbackRate = r; };
  /* الجودة */
  let qi = 0;
  const qs = $("#qs");
  if (qs) { const sq = LS.get("quality", ""); const f = sources.findIndex((x) => x.label && x.label === sq); if (f >= 0) { qi = f; qs.value = f; } qs.onchange = () => { pendingSeek = v.currentTime; qi = +qs.value; LS.set("quality", sources[qi].label); load(sources[qi].url); }; }
  load(sources[qi].url);
  /* الترجمة */
  const ss = $("#ss");
  const applySub = (i) => { [...v.textTracks].forEach((x, j) => (x.mode = j == i ? "showing" : "disabled")); LS.set("subs", i); };
  (async () => {
    const list = parseList(subsRaw);
    for (const sb of list) {
      const url = await subToUrl(sb.url); if (leaving) return;
      const tr = document.createElement("track");
      tr.kind = "subtitles"; tr.label = sb.label || "ترجمة"; tr.srclang = "ar"; tr.src = url; v.appendChild(tr);
    }
    const tt = [...v.textTracks];
    if (!tt.length) return;
    ss.hidden = false;
    ss.innerHTML = `<option value="-1">بدون ترجمة</option>` + tt.map((x, i) => `<option value="${i}">${esc(x.label)}</option>`).join("");
    const w = LS.get("subs", -1), i = w >= 0 && w < tt.length ? w : -1;
    ss.value = i; applySub(i);
    ss.onchange = () => applySub(+ss.value);
  })();
  /* أزرار */
  $("#b10").onclick = () => (v.currentTime = Math.max(0, v.currentTime - 10));
  $("#f10").onclick = () => (v.currentTime += 10);
  if (v.remote && typeof v.remote.prompt === "function") { const c = $("#cst"); c.hidden = false; c.onclick = () => v.remote.prompt().catch(() => toast("مفيش أجهزة متاحة للعرض عليها")); }
  if (document.pictureInPictureEnabled) { const p = $("#pip"); p.hidden = false; p.onclick = () => (document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture()).catch(() => {}); }
  $("#fs").onclick = async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); try { screen.orientation.unlock(); } catch {} }
      else { await $("#pl").requestFullscreen(); try { await screen.orientation.lock("landscape"); } catch {} }
    } catch { try { v.webkitEnterFullscreen(); } catch {} }
  };
  /* إشعار الهاتف / سماعات البلوتوث */
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: label, artist: "Luka TV", artwork: t.poster ? [{ src: t.poster, sizes: "500x750" }] : [] });
      navigator.mediaSession.setActionHandler("play", () => v.play());
      navigator.mediaSession.setActionHandler("pause", () => v.pause());
      navigator.mediaSession.setActionHandler("seekbackward", () => (v.currentTime -= 10));
      navigator.mediaSession.setActionHandler("seekforward", () => (v.currentTime += 10));
      navigator.mediaSession.setActionHandler("nexttrack", next ? () => (location.hash = href(next)) : null);
      navigator.mediaSession.setActionHandler("previoustrack", prev ? () => (location.hash = href(prev)) : null);
    } catch {}
  }
  /* الشعار يتثبّت على ركن الصورة نفسها (مش على الحواف السودا) */
  const bug = $(".bug");
  const placeBug = () => {
    if (!bug || !v.videoWidth) return;
    const W = v.clientWidth, H = v.clientHeight, sc = Math.min(W / v.videoWidth, H / v.videoHeight);
    bug.style.top = (H - v.videoHeight * sc) / 2 + (TV ? 20 : 10) + "px";
    bug.style.right = (W - v.videoWidth * sc) / 2 + (TV ? 24 : 12) + "px";
  };
  v.addEventListener("loadedmetadata", placeBug);
  window.addEventListener("resize", placeBug); document.addEventListener("fullscreenchange", placeBug);
  if (TV) v.focus();
  onLeave(() => {
    window.removeEventListener("resize", placeBug); document.removeEventListener("fullscreenchange", placeBug);
    leaving = true; saveProg(); unlock(); player = null;
    document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", saveProg);
    if (hls) hls.destroy();
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
    try { if (document.fullscreenElement) document.exitFullscreen(); screen.orientation.unlock(); } catch {}
    try { if ("mediaSession" in navigator) { navigator.mediaSession.metadata = null; ["play", "pause", "seekbackward", "seekforward", "nexttrack", "previoustrack"].forEach((a) => navigator.mediaSession.setActionHandler(a, null)); } } catch {}
  });
}

/* ============================================================
   الحساب
   ============================================================ */
function authErr(e) {
  const m = {
    "auth/invalid-credential": "الإيميل أو كلمة السر غلط", "auth/wrong-password": "الإيميل أو كلمة السر غلط", "auth/user-not-found": "الإيميل أو كلمة السر غلط",
    "auth/email-already-in-use": "الإيميل ده مسجّل قبل كده، جرّب تسجيل الدخول", "auth/weak-password": "كلمة السر ضعيفة (6 حروف على الأقل)",
    "auth/invalid-email": "الإيميل غير صحيح", "auth/too-many-requests": "محاولات كتير، استنى شوية وجرّب تاني", "auth/network-request-failed": "مفيش اتصال بالإنترنت"
  };
  return m[e && e.code] || "حصلت مشكلة، جرّب تاني";
}
let accMode = "login";
function accountView() {
  const settings = `
    <div class="box"><h3>الإعدادات</h3>
      <div class="line"><span>المظهر</span><div class="btns"><button class="btn sm ${LS.get("theme", "dark") === "dark" ? "" : "alt"}" data-th="dark">🌙 غامق</button><button class="btn sm ${LS.get("theme", "dark") === "light" ? "" : "alt"}" data-th="light">☀️ فاتح</button></div></div>
      <div class="line"><span>وضع التلفزيون (أزرار كبيرة وتحكم بالريموت)</span><button class="btn sm ${TV ? "" : "alt"}" id="tvb">${TV ? "مفعّل" : "متوقف"}</button></div>
      <div class="line"><span>شعار Luka TV على الفيديو (زي القنوات)</span><button class="btn sm ${LS.get("bug", true) ? "" : "alt"}" id="bugb">${LS.get("bug", true) ? "ظاهر" : "مخفي"}</button></div>
      ${deferredInstall ? `<div class="line"><span>تثبيت التطبيق على الجهاز</span><button class="btn sm" id="inst">📲 تثبيت</button></div>` : ""}
      <div class="line"><span>تحديث المحتوى الآن</span><button class="btn sm alt" id="refr">🔄 تحديث</button></div>
    </div>`;
  let main;
  if (user) {
    main = `<div class="box"><h3>أهلاً 👋</h3>
      <p style="word-break:break-all">${esc(user.email)} ${isAdmin ? "• <b>أدمن</b>" : ""}</p>
      <p class="${syncErr ? "err" : "ok"}" style="margin-top:6px">${syncErr ? "⚠️ المزامنة متوقفة (حدّث قواعد Firestore من README)" : "✔ قائمتك وتقدمك متزامنين على كل أجهزتك"}</p>
      <div class="btns" style="margin-top:12px">
        <a class="btn alt sm" href="#/notifs">🔔 الإشعارات</a>
        ${isAdmin ? `<a class="btn sm" href="#/admin">⚙️ لوحة الإدارة</a>` : ""}
        <button class="btn danger sm" id="lo">🚪 تسجيل خروج</button></div></div>`;
  } else {
    main = `<div class="box"><h3>الحساب</h3>
      <p style="color:var(--mu);font-size:13px;line-height:1.7;margin-bottom:12px">سجّل عشان قائمتك وتقدمك في المشاهدة يتحفظوا على كل أجهزتك.</p>
      <div class="seg"><button data-m="login" class="${accMode === "login" ? "on" : ""}">دخول</button><button data-m="signup" class="${accMode === "signup" ? "on" : ""}">حساب جديد</button></div>
      <form class="form" id="af" style="padding:0">
        <input id="em" type="email" placeholder="الإيميل" required autocomplete="username">
        <input id="pw" type="password" placeholder="كلمة السر (6 حروف على الأقل)" required minlength="6" autocomplete="${accMode === "login" ? "current-password" : "new-password"}">
        <button class="btn">${accMode === "login" ? "دخول" : "إنشاء حساب"}</button>
        ${accMode === "login" ? `<button type="button" class="btn alt sm" id="fg">نسيت كلمة السر؟</button>` : ""}
        <div class="err" id="aerr"></div>
      </form></div>`;
  }
  app.innerHTML = `<h1 class="pgtitle">حسابي</h1>${main}${settings}`;
  $$("[data-th]").forEach((b) => (b.onclick = () => { LS.set("theme", b.dataset.th); applyTheme(); accountView(); }));
  $("#bugb").onclick = () => { LS.set("bug", !LS.get("bug", true)); accountView(); };
  $("#tvb").onclick = () => { TV = !TV; LS.set("tv", TV); applyTV(); accountView(); };
  const inst = $("#inst"); if (inst) inst.onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; accountView(); };
  $("#refr").onclick = async () => { await loadTitles(true); initSeen(); updateBadge(); toast("تم تحديث المحتوى ✔"); };
  if (user) { $("#lo").onclick = async () => { await pushCloud(); await signOut(auth); }; return; }
  $$("[data-m]").forEach((b) => (b.onclick = () => { accMode = b.dataset.m; accountView(); }));
  $("#af").onsubmit = async (ev) => {
    ev.preventDefault();
    const em = $("#em").value.trim(), pw = $("#pw").value;
    try { accMode === "login" ? await signInWithEmailAndPassword(auth, em, pw) : await createUserWithEmailAndPassword(auth, em, pw); }
    catch (e) { $("#aerr").textContent = authErr(e); }
  };
  const fg = $("#fg");
  if (fg) fg.onclick = async () => {
    const em = $("#em").value.trim();
    if (!em) return ($("#aerr").textContent = "اكتب الإيميل الأول");
    try { await sendPasswordResetEmail(auth, em); toast("اتبعتلك رسالة لتغيير كلمة السر ✔"); } catch (e) { $("#aerr").textContent = authErr(e); }
  };
}

/* ============================================================
   لوحة الإدارة (للأدمن فقط)
   ============================================================ */
async function tmdbSearch(q) {
  const j = await (await fetch(`${TM}/search/multi?api_key=${TMDB_KEY}&language=ar&query=${encodeURIComponent(q)}`)).json();
  return (j.results || []).filter((x) => x.media_type === "movie" || x.media_type === "tv").slice(0, 8);
}
async function tmdbDetails(x) {
  return (await fetch(`${TM}/${x.media_type}/${x.id}?api_key=${TMDB_KEY}&language=ar&append_to_response=credits,videos&include_video_language=ar,en,null`)).json();
}
const parseEps = (txt) => txt.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const p = l.split("|"), s = +p[0], e = +p[1]; let url, subs = "";
  if (p.length >= 4) { subs = p[p.length - 1].trim(); url = p.slice(2, -1).join("|").trim(); } else url = p.slice(2).join("|").trim();
  const o = { s, e, url }; if (subs) o.subs = subs; return o;
}).filter((x) => x.s && x.e && x.url);

async function adminView(editId) {
  if (!user) return emptyView(`سجّل دخول بحساب الأدمن الأول.<br><br><a class="btn" href="#/account">الذهاب لـ حسابي</a>`);
  if (!isAdmin) return emptyView(`الحساب ده مش أدمن 🔒<br><br><a class="btn alt" href="#/account">حسابي</a>`);
  const t = editId ? titles.find((x) => x.id === editId) : null;
  let ex = { cast: t?.cast, trailer: t?.trailer };
  const epsText = t ? sortEps(t.episodes).map((x) => `${x.s}|${x.e}|${x.url}${x.subs ? "|" + x.subs : ""}`).join("\n") : "";
  const movies = titles.filter((x) => x.type === "movie").length, series = titles.filter((x) => x.type === "series").length;
  const epCount = titles.reduce((n, x) => n + (x.episodes || []).length, 0), totalViews = titles.reduce((n, x) => n + (x.views || 0), 0);
  const top = [...titles].filter((x) => x.views > 0).sort((a, b) => b.views - a.views).slice(0, 8);
  app.innerHTML = `
    <h1 class="pgtitle">لوحة الإدارة</h1>
    <div class="stats">
      <div class="stat"><b>${fmtNum(movies)}</b><span>فيلم</span></div>
      <div class="stat"><b>${fmtNum(series)}</b><span>مسلسل (${fmtNum(epCount)} حلقة)</span></div>
      <div class="stat"><b>${fmtNum(totalViews)}</b><span>إجمالي المشاهدات</span></div>
      <div class="stat"><b id="ucount">…</b><span>مستخدمين مسجّلين</span></div>
    </div>
    ${top.length ? `<div class="box"><h3>الأكثر مشاهدة</h3>${top.map((x) => `<div class="line"><span>${esc(x.title)}</span><span>👁 ${fmtNum(x.views)}</span></div>`).join("")}</div>` : ""}
    <h1 class="pgtitle" style="font-size:17px">${t ? "تعديل: " + esc(t.title) : "إضافة جديد"}</h1>
    <form class="form" id="af">
      <div><label>النوع</label><select id="type"><option value="movie">فيلم</option><option value="series">مسلسل</option></select></div>
      <div><label>ابحث في TMDB (تعبئة تلقائية بالبوستر والقصة والممثلين والتريلر)</label>
        <div style="display:flex;gap:8px"><input id="tq" placeholder="اكتب اسم الفيلم أو المسلسل"><button type="button" class="btn sm" id="tgo">بحث</button></div>
        <div id="tres" style="display:grid;gap:6px;margin-top:8px"></div></div>
      <div><label>الاسم</label><input id="title" required value="${esc(t?.title)}"></div>
      <div class="two"><div><label>السنة</label><input id="year" value="${esc(t?.year)}"></div><div><label>التقييم</label><input id="rating" value="${esc(t?.rating)}"></div></div>
      <div><label>رابط البوستر</label><input id="poster" dir="ltr" value="${esc(t?.poster)}"></div>
      <div><label>رابط الخلفية</label><input id="backdrop" dir="ltr" value="${esc(t?.backdrop)}"></div>
      <div><label>التصنيفات (افصل بفاصلة)</label><input id="genres" value="${esc((t?.genres || []).join("، "))}"></div>
      <div><label>القصة</label><textarea id="overview" rows="4">${esc(t?.overview)}</textarea></div>
      <div id="mvBox"><label>رابط الفيديو (mp4 أو m3u8 أو يوتيوب)</label><input id="videoUrl" dir="ltr" value="${esc(t?.videoUrl)}">
        <small>لو عندك أكتر من جودة اكتب: <code dir="ltr">1080p@https://...mp4 ; 720p@https://...mp4</code></small></div>
      <div id="mvSubs"><label>الترجمة (اختياري)</label><input id="subs" dir="ltr" value="${esc(t?.subs)}">
        <small>رابط ملف .vtt أو .srt بصيغة UTF-8. لأكتر من ترجمة: <code dir="ltr">عربي@https://...vtt ; English@https://...vtt</code></small></div>
      <div id="srBox"><label>الحلقات — سطر لكل حلقة</label>
        <textarea id="episodes" rows="7" dir="ltr" placeholder="1|1|https://example.com/s1e1.mp4&#10;1|2|1080p@https://a.mp4 ; 720p@https://b.mp4|https://subs/s1e2.vtt">${esc(epsText)}</textarea>
        <small>الصيغة: موسم | حلقة | رابط الفيديو | رابط الترجمة (اختياري). الجودات المتعددة تتكتب زي الفيلم.</small></div>
      <div class="two"><div><label>بداية المقدمة (ثواني)</label><input id="i0" type="number" min="0" value="${esc(t?.introStart ?? "")}" placeholder="0"></div><div><label>نهاية المقدمة (ثواني)</label><input id="i1" type="number" min="0" value="${esc(t?.introEnd ?? "")}" placeholder="مثلاً 90"></div></div>
      <small style="margin-top:-6px">لو كتبت نهاية المقدمة بيظهر زرار «تخطي المقدمة» في المشغّل.</small>
      <button class="btn">💾 حفظ</button>
      <div id="msg"></div>
    </form>
    <h1 class="pgtitle" style="font-size:17px">المحتوى الحالي</h1>
    ${titles.map((x) => `<div class="item"><span>${esc(x.title)} <small style="color:var(--mu)">(${x.type === "series" ? "مسلسل" : "فيلم"})</small></span><a class="btn sm alt" href="#/admin/edit/${x.id}">تعديل</a><button class="btn sm danger" data-del="${x.id}">حذف</button></div>`).join("") || `<div class="empty">فاضي</div>`}
    <div class="btns" style="padding:16px"><button class="btn alt sm" id="bak">⬇️ نسخة احتياطية (JSON)</button></div>`;

  getCountFromServer(collection(db, "users")).then((c) => ($("#ucount") && ($("#ucount").textContent = fmtNum(c.data().count)))).catch(() => ($("#ucount") && ($("#ucount").textContent = "—")));
  const typeEl = $("#type"); typeEl.value = t?.type || "movie";
  const toggle = () => { const m = typeEl.value === "movie"; $("#mvBox").hidden = !m; $("#mvSubs").hidden = !m; $("#srBox").hidden = m; };
  typeEl.onchange = toggle; toggle();
  $("#bak").onclick = () => {
    const blob = new Blob([JSON.stringify(titles.map(({ _ts, ...r }) => r), null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `luka-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  $("#tgo").onclick = async () => {
    const q = $("#tq").value.trim(); if (!q) return;
    if (!hasTmdb()) return ($("#tres").innerHTML = `<span class="err">ضيف مفتاح TMDB في firebase-config.js</span>`);
    $("#tres").textContent = "جاري البحث...";
    try {
      const res = await tmdbSearch(q);
      $("#tres").innerHTML = res.map((x, i) => `<div class="sr" data-i="${i}" tabindex="0"><img src="${x.poster_path ? TMDB_IMG + "w92" + x.poster_path : ""}" alt=""><span>${esc(x.title || x.name)} (${esc((x.release_date || x.first_air_date || "").slice(0, 4))})</span></div>`).join("") || "مفيش نتائج";
      $$("#tres .sr").forEach((el) => (el.onclick = async () => {
        const x = res[+el.dataset.i], d = await tmdbDetails(x);
        typeEl.value = x.media_type === "tv" ? "series" : "movie"; toggle();
        $("#title").value = d.title || d.name || "";
        $("#year").value = (d.release_date || d.first_air_date || "").slice(0, 4);
        $("#rating").value = d.vote_average ? d.vote_average.toFixed(1) : "";
        $("#poster").value = d.poster_path ? TMDB_IMG + "w500" + d.poster_path : "";
        $("#backdrop").value = d.backdrop_path ? TMDB_IMG + "w1280" + d.backdrop_path : "";
        $("#genres").value = (d.genres || []).map((g) => g.name).join("، ");
        $("#overview").value = d.overview || "";
        ex = pickExtras(d);
        $("#tres").innerHTML = `<span class="ok">✔ تم جلب البيانات (${ex.cast.length} ممثل${ex.trailer ? " + تريلر" : ""})</span>`;
      }));
    } catch { $("#tres").innerHTML = `<span class="err">تعذر البحث — تأكد من مفتاح TMDB</span>`; }
  };
  $("#af").onsubmit = async (ev) => {
    ev.preventDefault();
    const type = typeEl.value;
    const num = (id) => { const v = $(id).value.trim(); return v === "" ? null : +v; };
    const data = {
      type, title: $("#title").value.trim(), year: $("#year").value.trim(), rating: $("#rating").value.trim(),
      poster: $("#poster").value.trim(), backdrop: $("#backdrop").value.trim(),
      genres: $("#genres").value.split(/[,،]/).map((x) => x.trim()).filter(Boolean),
      overview: $("#overview").value.trim(),
      videoUrl: type === "movie" ? $("#videoUrl").value.trim() : "",
      subs: type === "movie" ? $("#subs").value.trim() : "",
      episodes: type === "series" ? parseEps($("#episodes").value) : [],
      introStart: num("#i0") ?? 0, introEnd: num("#i1") ?? 0,
      cast: ex.cast || [], trailer: ex.trailer || ""
    };
    $("#msg").textContent = "جاري الحفظ...";
    try {
      if (editId) await setDoc(doc(db, "titles", editId), data, { merge: true });
      else await addDoc(collection(db, "titles"), { ...data, createdAt: serverTimestamp(), views: 0 });
      await loadTitles(true);
      location.hash = "#/admin"; adminView(); toast("تم الحفظ ✔");
    } catch (e) { console.error(e); $("#msg").innerHTML = `<span class="err">فشل الحفظ — راجع قواعد Firestore (firestore.rules) والإيميل</span>`; }
  };
  $$("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("متأكد إنك عايز تحذف؟")) return;
    try { await deleteDoc(doc(db, "titles", b.dataset.del)); await loadTitles(true); adminView(); } catch { toast("فشل الحذف"); }
  }));
}

/* ============================================================
   الراوتر + التحكم بالكيبورد / ريموت التلفزيون
   ============================================================ */
let cleanups = [];
const onLeave = (fn) => cleanups.push(fn);
function focusFirst() {
  setTimeout(() => {
    if (app.contains(document.activeElement) && document.activeElement !== app) return;
    const el = $("#app .slide.on a") || $("#app .card") || $("#app a.btn") || $("#app button") || $("#app input");
    if (el) el.focus({ preventScroll: true });
  }, 60);
}
function route() {
  cleanups.splice(0).forEach((f) => { try { f(); } catch (e) { console.warn(e); } });
  closeModal();
  const p = location.hash.replace(/^#\/?/, "").split("?")[0].split("/").map(dec);
  const [r, a, b, c] = p;
  $$("#tabs a").forEach((el) => el.classList.toggle("on", el.dataset.r === (r || "")));
  document.body.classList.toggle("watching", r === "watch");
  window.scrollTo(0, 0);
  const run = (fn) => { const x = fn(); if (x && x.catch) x.catch((e) => { console.error(e); emptyView("حصلت مشكلة غير متوقعة"); }); };
  switch (r) {
    case "movies": run(() => browseView("movies", "أفلام", titles.filter((t) => t.type === "movie"))); break;
    case "series": run(() => browseView("series", "مسلسلات", titles.filter((t) => t.type === "series"))); break;
    case "genre": run(() => { F["g:" + a] = F["g:" + a] || { g: a, sort: "new", year: "", minr: "" }; browseView("g:" + a, a, titles, a); }); break;
    case "favs": run(favsView); break;
    case "search": run(searchView); break;
    case "notifs": run(notifsView); break;
    case "title": run(() => titleView(a)); break;
    case "watch": run(() => watchView(a, b, c)); break;
    case "account": run(accountView); break;
    case "admin": run(() => adminView(a === "edit" ? b : null)); break;
    default: run(homeView);
  }
  if (TV) focusFirst();
}

const isBack = (ev) => ev.key === "Escape" || ev.key === "XF86Back" || ev.key === "GoBack" || ev.keyCode === 10009 || ev.keyCode === 461 || (TV && ev.key === "Backspace");
function visible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden]");
}
function spatialNav(dir) {
  const els = $$("a[href],button:not([disabled]),select,input,textarea,[tabindex]:not([tabindex='-1'])").filter(visible);
  let cur = document.activeElement;
  if (!cur || cur === document.body || !els.includes(cur)) { const f = els.find((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }) || els[0]; if (f) f.focus(); return; }
  const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bs = Infinity;
  for (const el of els) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect(), dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy;
    let ok, pr, se;
    if (dir === "ArrowRight") { ok = dx > 4; pr = dx; se = Math.abs(dy); }
    else if (dir === "ArrowLeft") { ok = dx < -4; pr = -dx; se = Math.abs(dy); }
    else if (dir === "ArrowDown") { ok = dy > 4; pr = dy; se = Math.abs(dx); }
    else { ok = dy < -4; pr = -dy; se = Math.abs(dx); }
    if (!ok) continue;
    const sc = pr + se * 2.5;
    if (sc < bs) { bs = sc; best = el; }
  }
  if (best) { best.focus({ preventScroll: true }); best.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" }); }
}
function playerKey(ev) {
  const v = player && player.v; if (!v) return false;
  const k = ev.key, tg = ev.target, onCtl = tg.closest && tg.closest("button,select,a,input");
  const toggle = () => (v.paused ? v.play() : v.pause());
  if (k === "MediaPlayPause" || k === "k" || [415, 19, 179].includes(ev.keyCode)) { toggle(); return true; }
  if ((k === " " || k === "Enter") && !onCtl) { toggle(); return true; }
  if (k === "MediaTrackNext" || k === "j" || ev.keyCode === 412) { v.currentTime = Math.max(0, v.currentTime - 10); return true; }
  if (k === "l" || ev.keyCode === 417) { v.currentTime += 10; return true; }
  if (!onCtl || tg === v) {
    if (k === "ArrowLeft") { v.currentTime = Math.max(0, v.currentTime - 10); return true; }
    if (k === "ArrowRight") { v.currentTime += 10; return true; }
    if (!TV && k === "ArrowUp") { v.volume = Math.min(1, v.volume + 0.1); return true; }
    if (!TV && k === "ArrowDown") { v.volume = Math.max(0, v.volume - 0.1); return true; }
  }
  if (k === "f") { player.toggleFs(); return true; }
  if (k === "m") { v.muted = !v.muted; return true; }
  return false;
}
document.addEventListener("keydown", (ev) => {
  if ($("#modal .mbk")) { if (isBack(ev)) { closeModal(); ev.preventDefault(); } return; }
  const tag = (ev.target.tagName || "").toLowerCase();
  const typing = (tag === "input" && !/^(checkbox|radio|button|range|submit)$/.test(ev.target.type)) || tag === "textarea";
  if (isBack(ev) && !typing && ev.key !== "Escape") { ev.preventDefault(); history.length > 1 ? history.back() : (location.hash = "#/"); return; }
  if (player && !typing && playerKey(ev)) { ev.preventDefault(); return; }
  if (TV && /^Arrow/.test(ev.key)) {
    if (typing && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) return;
    ev.preventDefault(); spatialNav(ev.key);
  }
});

window.addEventListener("hashchange", route);
onAuthStateChanged(auth, async (u) => {
  user = u; isAdmin = !!(u && u.email && u.email.toLowerCase() === String(ADMIN_EMAIL).toLowerCase());
  if (u) await pullCloud();
  if (ready) { updateBadge(); if (!/^#\/(watch|title)/.test(location.hash)) route(); }
});
loadTitles().then(() => { initSeen(); updateBadge(); ready = true; route(); });
