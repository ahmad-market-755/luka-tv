import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, addDoc, setDoc, deleteDoc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, TMDB_KEY, ADMIN_EMAIL } from "./firebase-config.js";

const fb = initializeApp(firebaseConfig);
const db = getFirestore(fb);
const auth = getAuth(fb);

/* ---------- أدوات مساعدة ---------- */
const $ = (s) => document.querySelector(s);
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};
const sortEps = (eps = []) => [...eps].sort((a, b) => a.s - b.s || a.e - b.e);
const ytId = (u = "") => {
  const m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/);
  return m && m[1];
};
const playHref = (t, s, e) =>
  t.type === "series"
    ? (s ? `#/watch/${t.id}/${s}/${e}` : (sortEps(t.episodes)[0] ? `#/watch/${t.id}/${sortEps(t.episodes)[0].s}/${sortEps(t.episodes)[0].e}` : `#/title/${t.id}`))
    : `#/watch/${t.id}`;

let titles = [];
let loadError = "";
let user = null;

async function loadTitles() {
  loadError = "";
  try {
    const snap = await getDocs(query(collection(db, "titles"), orderBy("createdAt", "desc")));
    titles = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error(e);
    loadError = "تعذر تحميل المحتوى. تأكد من إعدادات Firebase في firebase-config.js";
  }
}

/* ---------- مكونات العرض ---------- */
const card = (t, href) =>
  `<a class="card" href="${href || "#/title/" + t.id}">
     <img loading="lazy" src="${esc(t.poster)}" alt="">
     <b>${esc(t.title)}</b>
     <small>${esc(t.year || "")} ${t.rating ? "⭐ " + esc(t.rating) : ""}</small>
   </a>`;
const rowOf = (name, list) =>
  list.length ? `<section><h2>${name}</h2><div class="row">${list.map((t) => card(t)).join("")}</div></section>` : "";
const emptyView = (msg) => (app.innerHTML = `<div class="empty">${msg}</div>`);

/* ---------- الصفحات ---------- */
function homeView() {
  if (loadError) return emptyView(esc(loadError));
  if (!titles.length)
    return emptyView("لسه مفيش محتوى 🎬<br>ادخل على تبويب «الإدارة» وضيف أول فيلم.");
  const hero = titles[0];
  const recent = LS.get("recent", [])
    .map((r) => ({ r, t: titles.find((x) => x.id === r.id) }))
    .filter((x) => x.t);
  app.innerHTML = `
    <a class="hero" href="#/title/${hero.id}" style="background-image:url('${esc(hero.backdrop || hero.poster)}')">
      <div><h1>${esc(hero.title)}</h1><p>${esc((hero.overview || "").slice(0, 110))}…</p></div>
    </a>
    ${recent.length ? `<section><h2>كمّل مشاهدة</h2><div class="row">${recent.map(({ r, t }) => card(t, playHref(t, r.s, r.e))).join("")}</div></section>` : ""}
    ${rowOf("أحدث الإضافات", titles.slice(0, 12))}
    ${rowOf("أفلام", titles.filter((t) => t.type === "movie").slice(0, 12))}
    ${rowOf("مسلسلات", titles.filter((t) => t.type === "series").slice(0, 12))}`;
}

function listView(name, list) {
  app.innerHTML = `<h1 class="pgtitle">${name}</h1>` +
    (list.length ? `<div class="grid">${list.map((t) => card(t)).join("")}</div>` : `<div class="empty">مفيش حاجة هنا لسه</div>`);
}

function searchView() {
  app.innerHTML = `<div class="form"><input id="q" type="search" placeholder="ابحث عن فيلم أو مسلسل..." autofocus></div><div id="res" class="grid"></div>`;
  const q = $("#q");
  const run = () => {
    const v = q.value.trim().toLowerCase();
    const list = v ? titles.filter((t) => (t.title || "").toLowerCase().includes(v) || (t.genres || []).join(" ").toLowerCase().includes(v)) : [];
    $("#res").innerHTML = list.map((t) => card(t)).join("") || (v ? `<div class="empty" style="grid-column:1/-1">مفيش نتائج</div>` : "");
  };
  q.addEventListener("input", run);
}

function favsView() {
  const ids = LS.get("favs", []);
  listView("قائمتي ❤️", titles.filter((t) => ids.includes(t.id)));
}

function titleView(id) {
  const t = titles.find((x) => x.id === id);
  if (!t) return emptyView("العنوان غير موجود");
  const favs = LS.get("favs", []);
  const isFav = favs.includes(id);
  const eps = sortEps(t.episodes);
  const seasons = [...new Set(eps.map((x) => x.s))];
  app.innerHTML = `
    <div class="detail">
      <div class="bd" style="background-image:url('${esc(t.backdrop || t.poster)}')"></div>
      <div class="info">
        <img class="pp" src="${esc(t.poster)}" alt="">
        <h1>${esc(t.title)}</h1>
        <div class="meta">${esc(t.year || "")} • ${t.type === "series" ? "مسلسل" : "فيلم"} ${t.rating ? "• ⭐ " + esc(t.rating) : ""} ${(t.genres || []).length ? "• " + esc(t.genres.join("، ")) : ""}</div>
        <p>${esc(t.overview || "")}</p>
        <div class="btns">
          <a class="btn" href="${playHref(t)}">▶ شاهد الآن</a>
          <button class="btn alt" id="fav">${isFav ? "💔 إزالة من قائمتي" : "❤️ أضف لقائمتي"}</button>
        </div>
        ${t.type === "series" && seasons.length ? `<select id="ss">${seasons.map((s) => `<option value="${s}">الموسم ${s}</option>`).join("")}</select><div id="eps"></div>` : ""}
      </div>
    </div>`;
  $("#fav").onclick = () => {
    const f = LS.get("favs", []);
    LS.set("favs", isFav ? f.filter((x) => x !== id) : [...f, id]);
    titleView(id);
  };
  if (t.type === "series" && seasons.length) {
    const prog = LS.get("prog", {});
    const draw = () => {
      const s = +$("#ss").value;
      $("#eps").innerHTML = eps.filter((x) => x.s === s).map((x) => {
        const p = prog[`${id}_${x.s}_${x.e}`];
        const pct = p && p.d ? Math.min(100, Math.round((p.t / p.d) * 100)) : 0;
        return `<a class="ep" href="#/watch/${id}/${x.s}/${x.e}"><b>${x.e}</b><div style="flex:1">الحلقة ${x.e}${pct ? `<div class="pr"><i style="width:${pct}%"></i></div>` : ""}</div>▶</a>`;
      }).join("");
    };
    $("#ss").onchange = draw;
    draw();
  }
}

/* ---------- المشغّل ---------- */
let hlsPromise;
const loadHls = () =>
  window.Hls ? Promise.resolve() : (hlsPromise ||= new Promise((res) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/hls.js@1";
    s.onload = res; s.onerror = res;
    document.head.appendChild(s);
  }));

async function watchView(id, s, e) {
  const t = titles.find((x) => x.id === id);
  if (!t) return emptyView("العنوان غير موجود");
  let url = t.videoUrl || "", key = id, title = t.title, next = null;
  if (t.type === "series") {
    const eps = sortEps(t.episodes);
    const i = eps.findIndex((x) => x.s == s && x.e == e);
    if (i < 0) return emptyView("الحلقة غير موجودة");
    url = eps[i].url; key = `${id}_${s}_${e}`; title = `${t.title} - م${s} ح${e}`; next = eps[i + 1];
  }
  if (!url) return emptyView("مفيش رابط فيديو لده لسه");

  const rec = LS.get("recent", []).filter((r) => r.id !== id);
  rec.unshift({ id, s: s ? +s : null, e: e ? +e : null });
  LS.set("recent", rec.slice(0, 12));

  const yt = ytId(url);
  app.innerHTML = `
    <div class="player">
      <div class="ptop"><button id="bk">→</button><span>${esc(title)}</span></div>
      ${yt ? `<iframe src="https://www.youtube.com/embed/${yt}?autoplay=1" allow="autoplay; fullscreen" allowfullscreen></iframe>`
           : `<video id="v" controls playsinline autoplay></video>
              <div class="pbar">
                <button id="b10">⏪ 10 ث</button><button id="f10">10 ث ⏩</button>
                ${next ? `<a class="btn sm" href="#/watch/${id}/${next.s}/${next.e}">الحلقة التالية ⏭</a>` : ""}
              </div>`}
    </div>`;
  $("#bk").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/title/" + id));
  if (yt) return;

  const v = $("#v");
  if (/\.m3u8(\?|$)/i.test(url) && !v.canPlayType("application/vnd.apple.mpegurl")) {
    await loadHls();
    if (window.Hls && Hls.isSupported()) {
      const h = new Hls(); h.loadSource(url); h.attachMedia(v);
    } else v.src = url;
  } else v.src = url;

  $("#b10").onclick = () => (v.currentTime = Math.max(0, v.currentTime - 10));
  $("#f10").onclick = () => (v.currentTime += 10);

  const prog = LS.get("prog", {});
  v.addEventListener("loadedmetadata", () => {
    const p = prog[key];
    if (p && p.t > 5 && p.t < v.duration - 30) v.currentTime = p.t;
  });
  let last = 0;
  v.addEventListener("timeupdate", () => {
    const now = Date.now();
    if (now - last < 5000) return;
    last = now;
    const all = LS.get("prog", {});
    all[key] = { t: v.currentTime, d: v.duration || 0 };
    LS.set("prog", all);
  });
  v.addEventListener("ended", () => {
    if (next) location.hash = `#/watch/${id}/${next.s}/${next.e}`;
  });
}

/* ---------- لوحة الإدارة ---------- */
function loginView(msg = "") {
  app.innerHTML = `
    <h1 class="pgtitle">دخول الأدمن</h1>
    <form class="form" id="lf">
      <input id="em" type="email" placeholder="الإيميل" required autocomplete="username">
      <input id="pw" type="password" placeholder="كلمة السر" required autocomplete="current-password">
      <button class="btn">دخول</button>
      <div class="err">${esc(msg)}</div>
    </form>`;
  $("#lf").onsubmit = async (ev) => {
    ev.preventDefault();
    try { await signInWithEmailAndPassword(auth, $("#em").value.trim(), $("#pw").value); }
    catch { loginView("الإيميل أو كلمة السر غلط"); }
  };
}

const TMDB_IMG = "https://image.tmdb.org/t/p/";
async function tmdbSearch(q) {
  const r = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&language=ar&query=${encodeURIComponent(q)}`);
  const j = await r.json();
  return (j.results || []).filter((x) => x.media_type === "movie" || x.media_type === "tv").slice(0, 8);
}
async function tmdbDetails(x) {
  const r = await fetch(`https://api.themoviedb.org/3/${x.media_type}/${x.id}?api_key=${TMDB_KEY}&language=ar`);
  return r.json();
}

function adminView(editId) {
  if (!user) return loginView();
  if (user.email !== ADMIN_EMAIL) {
    app.innerHTML = `<div class="empty">الحساب ده مش أدمن.<br><br><button class="btn alt" id="lo">تسجيل خروج</button></div>`;
    $("#lo").onclick = () => signOut(auth);
    return;
  }
  const t = editId ? titles.find((x) => x.id === editId) : null;
  const epsText = t ? sortEps(t.episodes).map((x) => `${x.s}|${x.e}|${x.url}`).join("\n") : "";
  app.innerHTML = `
    <h1 class="pgtitle">${t ? "تعديل: " + esc(t.title) : "إضافة جديد"}</h1>
    <form class="form" id="af">
      <div><label>النوع</label>
        <select id="type"><option value="movie">فيلم</option><option value="series">مسلسل</option></select></div>
      <div><label>ابحث في TMDB (تعبئة تلقائية)</label>
        <div style="display:flex;gap:8px"><input id="tq" placeholder="اكتب اسم الفيلم أو المسلسل"><button type="button" class="btn sm" id="tgo">بحث</button></div>
        <div id="tres" style="display:grid;gap:6px;margin-top:8px"></div></div>
      <div><label>الاسم</label><input id="title" required value="${esc(t?.title)}"></div>
      <div><label>السنة</label><input id="year" value="${esc(t?.year)}"></div>
      <div><label>التقييم</label><input id="rating" value="${esc(t?.rating)}"></div>
      <div><label>رابط البوستر</label><input id="poster" value="${esc(t?.poster)}"></div>
      <div><label>رابط الخلفية</label><input id="backdrop" value="${esc(t?.backdrop)}"></div>
      <div><label>التصنيفات (افصل بفاصلة)</label><input id="genres" value="${esc((t?.genres || []).join("، "))}"></div>
      <div><label>القصة</label><textarea id="overview" rows="4">${esc(t?.overview)}</textarea></div>
      <div id="mvBox"><label>رابط الفيديو (mp4 أو m3u8 أو يوتيوب)</label><input id="videoUrl" dir="ltr" value="${esc(t?.videoUrl)}"></div>
      <div id="srBox"><label>الحلقات — سطر لكل حلقة</label>
        <textarea id="episodes" rows="6" dir="ltr" placeholder="1|1|https://example.com/s1e1.mp4&#10;1|2|https://example.com/s1e2.mp4">${esc(epsText)}</textarea>
        <small>الصيغة: رقم الموسم | رقم الحلقة | رابط الفيديو</small></div>
      <button class="btn">💾 حفظ</button>
      <div id="msg"></div>
    </form>
    <h1 class="pgtitle" style="font-size:17px">المحتوى الحالي</h1>
    ${titles.map((x) => `<div class="item"><span>${esc(x.title)} <small style="color:var(--mu)">(${x.type === "series" ? "مسلسل" : "فيلم"})</small></span><a class="btn sm alt" href="#/admin/edit/${x.id}">تعديل</a><button class="btn sm danger" data-del="${x.id}">حذف</button></div>`).join("") || `<div class="empty">فاضي</div>`}
    <div style="padding:16px"><button class="btn alt sm" id="lo">تسجيل خروج</button></div>`;

  const typeEl = $("#type");
  typeEl.value = t?.type || "movie";
  const toggle = () => {
    $("#mvBox").style.display = typeEl.value === "movie" ? "" : "none";
    $("#srBox").style.display = typeEl.value === "series" ? "" : "none";
  };
  typeEl.onchange = toggle; toggle();
  $("#lo").onclick = () => signOut(auth);

  $("#tgo").onclick = async () => {
    const q = $("#tq").value.trim(); if (!q) return;
    $("#tres").innerHTML = "جاري البحث...";
    try {
      const res = await tmdbSearch(q);
      $("#tres").innerHTML = res.map((x, i) => `<div class="sr" data-i="${i}"><img src="${x.poster_path ? TMDB_IMG + "w92" + x.poster_path : ""}" alt=""><span>${esc(x.title || x.name)} (${esc((x.release_date || x.first_air_date || "").slice(0, 4))})</span></div>`).join("") || "مفيش نتائج";
      $("#tres").querySelectorAll(".sr").forEach((el) => (el.onclick = async () => {
        const x = res[+el.dataset.i];
        const d = await tmdbDetails(x);
        typeEl.value = x.media_type === "tv" ? "series" : "movie"; toggle();
        $("#title").value = d.title || d.name || "";
        $("#year").value = (d.release_date || d.first_air_date || "").slice(0, 4);
        $("#rating").value = d.vote_average ? d.vote_average.toFixed(1) : "";
        $("#poster").value = d.poster_path ? TMDB_IMG + "w500" + d.poster_path : "";
        $("#backdrop").value = d.backdrop_path ? TMDB_IMG + "w1280" + d.backdrop_path : "";
        $("#genres").value = (d.genres || []).map((g) => g.name).join("، ");
        $("#overview").value = d.overview || "";
        $("#tres").innerHTML = `<span class="ok">✔ تم جلب البيانات</span>`;
      }));
    } catch { $("#tres").innerHTML = `<span class="err">تعذر البحث — تأكد من مفتاح TMDB</span>`; }
  };

  $("#af").onsubmit = async (ev) => {
    ev.preventDefault();
    const type = typeEl.value;
    const data = {
      type,
      title: $("#title").value.trim(),
      year: $("#year").value.trim(),
      rating: $("#rating").value.trim(),
      poster: $("#poster").value.trim(),
      backdrop: $("#backdrop").value.trim(),
      genres: $("#genres").value.split(/[,،]/).map((x) => x.trim()).filter(Boolean),
      overview: $("#overview").value.trim(),
      videoUrl: type === "movie" ? $("#videoUrl").value.trim() : "",
      episodes: type === "series"
        ? $("#episodes").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
            const [s, e, ...r] = l.split("|");
            return { s: +s, e: +e, url: r.join("|").trim() };
          }).filter((x) => x.s && x.e && x.url)
        : []
    };
    $("#msg").innerHTML = "جاري الحفظ...";
    try {
      if (editId) await setDoc(doc(db, "titles", editId), data, { merge: true });
      else await addDoc(collection(db, "titles"), { ...data, createdAt: serverTimestamp() });
      await loadTitles();
      location.hash = "#/admin";
      adminView();
    } catch (e) {
      console.error(e);
      $("#msg").innerHTML = `<span class="err">فشل الحفظ — راجع قواعد Firestore (firestore.rules) والإيميل</span>`;
    }
  };

  app.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("متأكد إنك عايز تحذف؟")) return;
    await deleteDoc(doc(db, "titles", b.dataset.del));
    await loadTitles();
    adminView();
  }));
}

/* ---------- الراوتر ---------- */
function route() {
  const p = location.hash.replace(/^#\/?/, "").split("/");
  const [r, a, b, c] = p;
  document.querySelectorAll("#tabs a").forEach((el) => el.classList.toggle("on", el.getAttribute("href") === "#/" + (r || "")));
  document.body.classList.toggle("watching", r === "watch");
  window.scrollTo(0, 0);
  switch (r) {
    case "movies": return listView("أفلام", titles.filter((t) => t.type === "movie"));
    case "series": return listView("مسلسلات", titles.filter((t) => t.type === "series"));
    case "favs": return favsView();
    case "search": return searchView();
    case "title": return titleView(a);
    case "watch": return watchView(a, b, c);
    case "admin": return adminView(a === "edit" ? b : null);
    default: return homeView();
  }
}

window.addEventListener("hashchange", route);
onAuthStateChanged(auth, (u) => {
  user = u;
  if ((location.hash || "").startsWith("#/admin")) route();
});

app.innerHTML = `<div class="empty">جاري التحميل...</div>`;
loadTitles().then(route);
