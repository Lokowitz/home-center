// Engine file: relative imports and npm packages only.
// A single offline page: no network, no framework, DOM built with textContent
// so names and notes from the data can never become markup.
import type { ArchiveWriter } from "./archive"
import { READABLE_PREFIX } from "./format"
import { csvTables, loadReadable, rawPlacement, type ReadableData, type ReadableRegional } from "./readable"

export function dataJs(data: ReadableData): string {
  // <, >, & and the two JS line separators are escaped so no data can close the script or end a string early.
  const safe = JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
  return `window.HC_DATA = ${safe};\n`
}

export async function writeReadableLayer(w: ArchiveWriter, data: ReadableData, regional?: ReadableRegional): Promise<void> {
  await w.addBytes(`${READABLE_PREFIX}index.html`, viewerHtml(regional?.currency))
  await w.addBytes(`${READABLE_PREFIX}data.js`, dataJs(data))
  const json: Record<string, unknown> = {
    "assets.json": data.assets, "service-records.json": data.serviceRecords, "warranties.json": data.warranties,
    "reminders.json": data.reminders, "documents.json": data.documents, "rooms.json": data.rooms, "insurance.json": data.insurance, ...(data.health ? { "health.json": data.health } : {}),
  }
  for (const [n, v] of Object.entries(json)) await w.addBytes(`${READABLE_PREFIX}data/${n}`, JSON.stringify(v, null, 2))
  for (const [n, csv] of Object.entries(csvTables(data))) await w.addBytes(`${READABLE_PREFIX}csv/${n}`, csv)
}

/** createBackup's readable hook: everything, linked to the files already stored under files/<rel>. */
export async function backupReadable(snapshot: string, w: ArchiveWriter): Promise<void> {
  const { data, regional } = await loadReadable(snapshot, { kind: "all", includeHealth: true }, rawPlacement)
  await writeReadableLayer(w, data, regional)
}

/** Only a plain ISO 4217 code is ever placed in the page; anything else falls back to USD. */
// eslint-disable-next-line no-restricted-syntax -- offline standalone viewer; default currency literal
export function viewerHtml(currency = "USD"): string {
  // eslint-disable-next-line no-restricted-syntax -- offline standalone viewer; fallback currency literal
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "USD"
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data: 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline' file: 'self'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HomeCenter export</title>
<style>
:root { --bg:#fbfaf8; --fg:#1f1d1a; --muted:#6b665e; --line:#e6e1d9; --card:#fff; --accent:#b4532a; }
@media (prefers-color-scheme: dark) { :root { --bg:#151412; --fg:#ece8e1; --muted:#a39d93; --line:#2c2a26; --card:#1d1b18; --accent:#e08a5f; } }
* { box-sizing: border-box; }
body { margin:0; font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--fg); }
header { padding:16px; border-bottom:1px solid var(--line); display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
header h1 { margin:0; font-size:18px; }
input[type=search] { flex:1; min-width:180px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:var(--card); color:var(--fg); }
main { max-width:960px; margin:0 auto; padding:16px; }
a { color:var(--accent); }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px; }
.card img { width:100%; height:120px; object-fit:cover; border-radius:6px; }
.muted { color:var(--muted); font-size:13px; }
h2 { font-size:16px; margin:24px 0 8px; }
table { width:100%; border-collapse:collapse; font-size:14px; }
td, th { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
dl { display:grid; grid-template-columns:max-content 1fr; gap:4px 12px; margin:0; }
dt { color:var(--muted); }
@media print { header input, .back { display:none; } body { background:#fff; color:#000; } }
</style>
</head>
<body>
<header><h1>HomeCenter</h1><input type="search" id="q" placeholder="Search everything" aria-label="Search"><span class="muted" id="when"></span></header>
<main id="app"></main>
<script src="data.js"></script>
<script>
(function () {
  var D = window.HC_DATA, app = document.getElementById("app");
  if (!D) { app.textContent = "data.js is missing next to this page."; return; }
  document.getElementById("when").textContent = "Exported " + new Date(D.generatedAt).toLocaleString();
  // Only relative paths under files/ (written as ../files/... next to this page) become links; anything else, such as a javascript: URL, is dropped.
  function safePath(p) {
    if (typeof p !== "string" || p.indexOf("../files/") !== 0) return null;
    var segs = p.split("/");
    for (var i = 1; i < segs.length; i++) { if (segs[i] === "" || segs[i] === "." || segs[i] === ".." || segs[i].indexOf("\\\\") >= 0) return null; }
    return "../" + segs.slice(1).map(encodeURIComponent).join("/");
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "href" && typeof attrs[k] === "string" && attrs[k].charAt(0) === "#") n.setAttribute(k, attrs[k]);
      else if (k === "href" || k === "src") { var u = safePath(attrs[k]); if (u) n.setAttribute(k, u); }
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function day(s) { return s ? new Date(s).toLocaleDateString() : ""; }
  var CURRENCY = "${code}";
  function money(v) {
    if (v == null) return "";
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY }).format(Number(v)); }
    catch (e) { return CURRENCY + " " + Number(v).toFixed(2); }
  }
  function files(list) { return el("span", {}, (list || []).map(function (f) { return el("a", { href: f.path, text: f.name, style: "margin-right:8px" }); })); }
  function table(cols, rows) {
    return el("table", {}, [el("thead", {}, [el("tr", {}, cols.map(function (c) { return el("th", { text: c[0] }); }))]),
      el("tbody", {}, rows.map(function (r) { return el("tr", {}, cols.map(function (c) { var v = c[1](r); return v instanceof Node ? el("td", {}, [v]) : el("td", { text: v == null ? "" : String(v) }); })); }))]);
  }
  var LABEL = { property: "Properties", vehicle: "Vehicles", equipment: "Equipment", person: "People" };
  function home(filter) {
    app.replaceChildren();
    var f = (filter || "").toLowerCase();
    ["property", "vehicle", "equipment", "person"].forEach(function (t) {
      var list = D.assets.filter(function (a) { return a.type === t && (!f || JSON.stringify(a).toLowerCase().indexOf(f) >= 0 || related(a).toLowerCase().indexOf(f) >= 0); });
      if (!list.length) return;
      app.appendChild(el("h2", { text: LABEL[t] + " (" + list.length + ")" }));
      app.appendChild(el("div", { class: "grid" }, list.map(function (a) {
        var link = el("a", { href: "#" + encodeURIComponent(a.id), text: a.name });
        return el("div", { class: "card" }, [a.photo ? el("img", { src: a.photo, alt: "" }) : null, el("div", {}, [link]),
          el("div", { class: "muted", text: D.serviceRecords.filter(function (r) { return r.assetId === a.id; }).length + " records" })]);
      })));
    });
  }
  function related(a) {
    return JSON.stringify([D.serviceRecords, D.warranties, D.reminders, D.documents].map(function (l) { return l.filter(function (r) { return r.assetId === a.id; }); }));
  }
  function asset(id) {
    var a = D.assets.find(function (x) { return x.id === id; });
    if (!a) return home();
    app.replaceChildren();
    app.appendChild(el("p", { class: "back" }, [el("a", { href: "#", text: "← All" })]));
    app.appendChild(el("h2", { text: a.name }));
    if (a.photo) app.appendChild(el("img", { src: a.photo, alt: "", style: "max-width:320px;border-radius:8px" }));
    var dl = el("dl");
    Object.keys(a.details).forEach(function (k) { var v = a.details[k]; if (v == null || v === "") return; dl.appendChild(el("dt", { text: k })); dl.appendChild(el("dd", { text: /T\\d\\d:/.test(String(v)) ? day(v) : String(v) })); });
    app.appendChild(dl);
    var mine = function (l) { return l.filter(function (r) { return r.assetId === a.id; }); };
    var sr = mine(D.serviceRecords);
    if (sr.length) { app.appendChild(el("h2", { text: "History" })); app.appendChild(table([["Date", function (r) { return day(r.date); }], ["What", function (r) { return r.title; }], ["Vendor", function (r) { return r.vendor; }], ["Cost", function (r) { return money(r.cost); }], ["Notes", function (r) { return r.notes; }], ["Files", function (r) { return files(r.files); }]], sr)); }
    var rem = mine(D.reminders);
    if (rem.length) { app.appendChild(el("h2", { text: "Reminders" })); app.appendChild(table([["What", function (r) { return r.title; }], ["Last done", function (r) { return day(r.lastDone); }], ["Next due", function (r) { return day(r.nextDue) + (r.nextDueMileage ? " / " + r.nextDueMileage : ""); }], ["Files", function (r) { return files(r.files); }]], rem)); }
    var w = mine(D.warranties);
    if (w.length) { app.appendChild(el("h2", { text: "Warranties" })); app.appendChild(table([["Product", function (r) { return r.product; }], ["Expires", function (r) { return day(r.expires); }], ["Vendor", function (r) { return r.vendor; }], ["Files", function (r) { return files(r.files); }]], w)); }
    var rm = mine(D.rooms || []);
    if (rm.length) { app.appendChild(el("h2", { text: "Rooms" })); app.appendChild(table([["Room", function (r) { return r.name; }], ["Level", function (r) { return r.level; }], ["Flooring", function (r) { return [r.flooringType, r.flooringProduct].filter(Boolean).join(" - "); }], ["Paint", function (r) { return r.paints.map(function (p) { return [p.surface, p.colorName, p.colorCode].filter(Boolean).join(" "); }).join("; "); }], ["Files", function (r) { return files(r.files); }]], rm)); }
    var docs = mine(D.documents);
    if (docs.length) { app.appendChild(el("h2", { text: "Documents" })); app.appendChild(table([["Name", function (r) { return el("a", { href: r.path, text: r.name }); }], ["Added", function (r) { return day(r.uploaded); }]], docs)); }
    if (a.type === "person" && D.health) {
      var H = D.health, p = function (l) { return l.filter(function (r) { return r.personId === a.id; }); };
      [["Conditions", p(H.conditions), [["Name", function (r) { return r.name; }], ["Status", function (r) { return r.status; }], ["Diagnosed", function (r) { return day(r.diagnosed); }], ["Files", function (r) { return files(r.files); }]]],
       ["Medications", p(H.medications), [["Name", function (r) { return r.name; }], ["Dosage", function (r) { return r.dosage; }], ["Frequency", function (r) { return r.frequency; }], ["Files", function (r) { return files(r.files); }]]],
       ["Allergies", p(H.allergies), [["Substance", function (r) { return r.substance; }], ["Reaction", function (r) { return r.reaction; }], ["Severity", function (r) { return r.severity; }]]],
       ["Immunizations", p(H.immunizations), [["Vaccine", function (r) { return r.vaccine; }], ["Given", function (r) { return day(r.given); }], ["Next due", function (r) { return day(r.nextDue); }]]],
       ["Observations", p(H.observations), [["Date", function (r) { return day(r.date); }], ["Type", function (r) { return r.type; }], ["Severity", function (r) { return r.severity; }], ["Notes", function (r) { return r.notes; }]]]
      ].forEach(function (s) { if (s[1].length) { app.appendChild(el("h2", { text: s[0] })); app.appendChild(table(s[2], s[1])); } });
    }
    window.scrollTo(0, 0);
  }
  function route() { var id = ""; try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { id = ""; } if (id) asset(id); else home(document.getElementById("q").value); }
  document.getElementById("q").addEventListener("input", function (e) { location.hash = ""; home(e.target.value); });
  window.addEventListener("hashchange", route);
  route();
})();
</script>
</body>
</html>
`
}
