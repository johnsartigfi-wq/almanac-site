// open_days.mjs - the one renderer for every generated page on almanac.vayelion.com.
//
// MASTER COPY: C:/Dev/frequency-almanac/tools/site/opener/open_days.mjs (app repo).
// build_site_pages.py copies it to <site>/tools/open_days.mjs on every release,
// and verify_site_pages.js fails if the two ever differ. Edit the master only.
//
// Input: <site>/d/days.json, written by build_site_pages.py. Every day the app
// loads is there as one sealed payload (the same FNV-1a + mulberry32 XOR
// keystream as the pages, seed "p:" + date, base64), plus the size of its plate
// image. Nothing in that file is legible.
//
// Output, a pure function of days.json and "today" (America/Los_Angeles):
//   d/<date>/index.html     a day strictly before today: the OPEN page, readable
//                           without JavaScript, carrying exactly the app's free
//                           tier for that day. Today and every later day: the
//                           SEALED page, the same client-side seal as before.
//   d/<YYYY-MM>/index.html  the month: open days by name, the rest by date only
//   prompts/<YYYY-MM>/      the free questions of that month's open days
//   sitemap.xml, robots.txt, and the month links block in index.html
//
// The release (python tools/site/build_site_pages.py) and the daily GitHub
// Action (.github/workflows/open-days.yml) both run THIS file, so what a
// release writes and what the Action writes the next morning cannot drift.
// No dependencies, no network, no clock except "today".
//
// Usage: node tools/open_days.mjs --site <site dir> [--today YYYY-MM-DD] [--dry]
//   --dry   compute everything, write nothing, list what would change (exit 0)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORIGIN = 'https://almanac.vayelion.com';
const APP_ID = '6791434766';
const PROVIDER_TOKEN = '129156050';
const APP_SCHEME = 'frequencyalmanac';
const GOOGLE_BASE = 'https://play.google.com/store/apps/details?id=com.vayelion.frequencyalmanac';
const SEALED_DESC = 'Every day has a name. Open to see what this one is called.';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const LEGAL = ['privacy.html', 'terms.html', 'support.html'];
const DIAMOND = '\u2726';

// ---------------------------------------------------------------- store links
// THE SHARE LINK CONTRACT: ct is "send" or "q" when the visitor arrived by a
// shared link carrying exactly that src, otherwise "d"; the root page is "site".
export const appleUrl = (ct) => `https://apps.apple.com/app/apple-store/id${APP_ID}?pt=${PROVIDER_TOKEN}&ct=${ct}&mt=8`;
export const googleUrl = (medium, campaign) =>
  GOOGLE_BASE + '&referrer=' + encodeURIComponent(`utm_source=almanac_site&utm_medium=${medium}&utm_campaign=${campaign}`);

// ---------------------------------------------------------------- seal
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(str, 'utf8')) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}
export function unseal(date, payload) {
  const rnd = mulberry32(fnv1a('p:' + date));
  const raw = Buffer.from(payload, 'base64');
  const out = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ (rnd() & 0xff);
  return new TextDecoder('utf-8', { fatal: true }).decode(out);
}

// ---------------------------------------------------------------- dates
export function pacificToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function labels(date) {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const monthDay = `${MONTHS[m - 1]} ${d}`;
  return { weekday, monthDay, long: `${monthDay}, ${y}`, full: `${weekday}, ${monthDay}, ${y}`,
    month: date.slice(0, 7), monthName: `${MONTHS[m - 1]} ${y}` };
}
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// ---------------------------------------------------------------- escaping
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

// ---------------------------------------------------------------- shared pieces
// The badges carry ids so the src script can swap in the matching campaign
// link. The art is the stores' own files, never redrawn.
function badges(rel, ct, campaign) {
  return `  <div class="badges">
    <a id="store-apple" href="${escAttr(appleUrl(ct))}"><img src="${rel}badge-appstore.svg" alt="Download on the App Store" width="162" height="54"></a>
    <a id="store-google" href="${escAttr(googleUrl(ct, campaign))}"><img src="${rel}badge-googleplay.png" alt="Get it on Google Play" width="181" height="54"></a>
  </div>`;
}

// On a day page only: ?src=send and ?src=q choose their own campaign. The
// query text is compared against two fixed words and never written anywhere;
// the only values this script can write are the four literal links below.
function srcScript() {
  return `  <script>
  /* Store links by source, THE SHARE LINK CONTRACT: a day shared from the app
     arrives with ?src=send, a shared question with ?src=q, and each gets its
     own App Store campaign and Play referrer. Anything else keeps ct=d. Only
     these fixed links are ever written; the query text itself never is. */
  (function () {
    try {
      var m = /[?&]src=([^&#]*)/.exec(location.search || ""), src = m ? m[1] : "";
      if (src !== "send" && src !== "q") return;
      var links = {
        send: ["${appleUrl('send')}", "${googleUrl('send', 'day_page')}"],
        q: ["${appleUrl('q')}", "${googleUrl('q', 'day_page')}"]
      };
      var a = document.getElementById("store-apple"), g = document.getElementById("store-google");
      if (a) a.setAttribute("href", links[src][0]);
      if (g) g.setAttribute("href", links[src][1]);
    } catch (e) { /* leave the links as they were */ }
  })();
  </script>`;
}

function footer(rel) {
  return `  <footer>
    <a href="${rel}privacy.html">Privacy</a> &nbsp;&#10022;&nbsp;
    <a href="${rel}terms.html">Terms</a> &nbsp;&#10022;&nbsp;
    <a href="${rel}support.html">Support</a>
    <div class="fine">App Store is a service mark of Apple Inc. Google Play and the Google Play logo are trademarks of Google LLC.</div>
    <div class="fine">Vayelion Soul Maps &nbsp;&#10022;&nbsp; The Frequency Almanac does not predict the future. Your own inner authority is primary.</div>
  </footer>`;
}

// The open, month and prompts pages share the sealed page's palette and type.
const BASE_CSS = `  :root { --ink: #ece5d4; --soft: #b3a98f; --gold: #cfa851; --goldDeep: #a8873c; --bg: #181419; --bg2: #0d0b10; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: var(--ink);
         background: radial-gradient(ellipse 120% 90% at 50% 20%, var(--bg) 0%, var(--bg2) 100%);
         min-height: 100vh; text-align: center; }
  main { max-width: 640px; margin: 0 auto; padding: 44px 20px 80px; overflow-wrap: anywhere; }
  .brand { display: inline-block; font-size: 15px; letter-spacing: 5px; text-transform: uppercase;
           color: var(--gold); text-decoration: none; line-height: 1.6; }
  .divider { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 18px 0 26px; color: var(--gold); }
  .divider .ln { display: inline-block; width: 90px; height: 1px; background: #6f5f38; }
  .card { margin: 0 auto; padding: 26px 18px 28px; width: 100%; max-width: 560px;
          border: 1px solid #4a3f26; border-radius: 10px; background: rgba(207,168,81,0.04); }
  .date { font-size: 13px; letter-spacing: 3px; text-transform: uppercase; color: var(--soft); }
  h1 { font-weight: 400; }
  h1 .lead { display: block; margin-top: 14px; font-style: italic; font-size: 17px; color: var(--soft); }
  h1 .name { display: block; margin-top: 6px; font-style: italic; font-size: 36px; font-size: clamp(30px, 7.5vw, 46px);
             line-height: 1.2; color: var(--gold); }
  h1.page { font-style: italic; font-size: 34px; font-size: clamp(28px, 7vw, 42px); line-height: 1.2; color: var(--gold); }
  .keys { margin-top: 14px; font-size: 12px; letter-spacing: 3px; text-transform: uppercase; line-height: 1.9; color: var(--soft); }
  .reading { margin-top: 18px; font-style: italic; font-size: 17px; line-height: 1.65; color: var(--ink); }
  .plate { display: inline-block; margin: 28px auto 0; padding: 8px; max-width: 100%;
           background: #fbf7ee; border: 1px solid #4a3f26; border-radius: 6px; }
  .plate img { display: block; width: 100%; max-width: 560px; height: auto; }
  .text { max-width: 560px; margin: 0 auto; text-align: left; }
  h2 { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 34px 0 12px;
       font-weight: 400; font-size: 13px; letter-spacing: 3px; text-transform: uppercase; color: var(--gold); text-align: center; }
  h2::before, h2::after { content: ""; display: block; width: 46px; height: 1px; background: #6f5f38; }
  .text p { font-size: 17px; line-height: 1.7; color: var(--ink); }
  .text p.aphorism { text-align: center; font-style: italic; font-size: 19px; line-height: 1.6; color: var(--ink); white-space: pre-line; }
  .text p.gem { text-align: center; color: var(--gold); font-size: 14px; line-height: 1; margin-bottom: 8px; }
  .inapp { margin-top: 30px; font-style: italic; font-size: 16px; line-height: 1.6; color: var(--soft); }
  .intro { margin-top: 14px; font-style: italic; font-size: 17px; line-height: 1.6; color: var(--soft); }
  .badges { margin-top: 30px; display: flex; justify-content: center; align-items: center; gap: 16px; flex-wrap: wrap; }
  .badges img { height: 54px; width: auto; display: block; }
  .cta { display: inline-block; margin-top: 22px; padding: 13px 30px; border: 1px solid var(--goldDeep);
         border-radius: 8px; color: var(--gold); text-decoration: none; font-size: 16px; }
  .cta:hover { background: rgba(207,168,81,0.08); }
  .nav { margin-top: 34px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 14px 20px; font-size: 15px; line-height: 1.5; }
  .nav a, .home a, .days a, .prompts a { color: var(--gold); text-decoration: none; }
  .nav .up { flex-basis: 100%; text-align: center; letter-spacing: 2px; text-transform: uppercase; font-size: 14px; }
  .home { margin-top: 30px; font-size: 15px; letter-spacing: 2px; text-transform: uppercase; }
  .home a { border-bottom: 1px solid var(--goldDeep); padding-bottom: 2px; }
  .days, .prompts { list-style: none; margin: 26px auto 0; max-width: 560px; text-align: left; }
  .days li { padding: 10px 2px; border-bottom: 1px solid #2c2619; font-size: 17px; line-height: 1.5; }
  .days .d { display: inline-block; min-width: 7.5em; color: var(--soft); font-size: 14px; letter-spacing: 1px; text-transform: uppercase; }
  .days .n { font-style: italic; }
  .days .sealed { color: var(--soft); font-style: italic; }
  .prompts li { padding: 16px 2px; border-bottom: 1px solid #2c2619; }
  .prompts .q { font-size: 18px; line-height: 1.6; color: var(--ink); }
  .prompts .from { margin-top: 6px; font-size: 14px; color: var(--soft); }
  footer { margin-top: 56px; font-size: 13px; color: var(--soft); line-height: 2; }
  footer a { color: var(--soft); }
  .fine { font-size: 12px; margin-top: 10px; font-style: italic; }`;

function head({ title, desc, url, banner, extra = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="apple-itunes-app" content="${escAttr(banner)}">
<title>${escText(title)}</title>
<meta name="description" content="${escAttr(desc)}">
<link rel="canonical" href="${escAttr(url)}">
${extra}<style>
${BASE_CSS}
</style>
</head>`;
}

function breadcrumb(items) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
  };
}

// ---------------------------------------------------------------- the sealed page
// Today and every later day. The seal and its two scripts are exactly the
// ones the site has carried since 9/24; the payload now also holds the free
// fields the opener needs on the morning after, which the page never reads.
function sealedPage(date, sealed) {
  const lab = labels(date);
  const title = `${lab.weekday}, ${lab.monthDay} \u00b7 The Frequency Almanac`;
  const url = `${ORIGIN}/d/${date}/`;
  const image = `${ORIGIN}/d/og/${date}.jpg`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="apple-itunes-app" content="app-id=${APP_ID}, app-argument=${APP_SCHEME}://day/${date}">
<title>${title}</title>
<meta name="description" content="${SEALED_DESC}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="The Frequency Almanac">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${SEALED_DESC}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="An engraved plate from The Frequency Almanac for ${lab.full}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${SEALED_DESC}">
<meta name="twitter:image" content="${image}">
<style>
  :root { --ink: #ece5d4; --soft: #b3a98f; --gold: #cfa851; --goldDeep: #a8873c; --bg: #181419; --bg2: #0d0b10; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: var(--ink);
         background: radial-gradient(ellipse 120% 90% at 50% 20%, var(--bg) 0%, var(--bg2) 100%);
         min-height: 100vh; text-align: center; }
  main { max-width: 620px; margin: 0 auto; padding: 44px 20px 80px; }
  .brand { display: inline-block; font-size: 15px; letter-spacing: 5px; text-transform: uppercase;
           color: var(--gold); text-decoration: none; line-height: 1.6; }
  .divider { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 18px 0 26px; color: var(--gold); }
  .divider .ln { display: inline-block; width: 90px; height: 1px; background: #6f5f38; }
  .day { margin: 0 auto; padding: 26px 18px 28px; width: 100%; max-width: 520px;
         border: 1px solid #4a3f26; border-radius: 10px; background: rgba(207,168,81,0.04); }
  .day { overflow-wrap: anywhere; }
  .day .date { font-size: 13px; letter-spacing: 3px; text-transform: uppercase; color: var(--soft); }
  .open, .sealed { display: none; }
  .is-open .open, .is-sealed .sealed { display: block; }
  .is-open .plain, .is-sealed .plain { display: none; }
  .plain, .sealed { margin-top: 16px; font-style: italic; font-size: 18px; line-height: 1.6; color: var(--soft); }
  .lead { margin-top: 14px; font-style: italic; font-size: 17px; color: var(--soft); }
  .name { margin-top: 6px; font-style: italic; font-size: 36px; font-size: clamp(30px, 7.5vw, 46px);
          line-height: 1.2; color: var(--gold); }
  .keys { margin-top: 14px; font-size: 12px; letter-spacing: 3px; text-transform: uppercase; line-height: 1.9; color: var(--soft); }
  .closing { margin-top: 18px; font-style: italic; font-size: 18px; line-height: 1.6; color: var(--ink); }
  .badges { margin-top: 30px; display: flex; justify-content: center; align-items: center; gap: 16px; flex-wrap: wrap; }
  .badges img { height: 54px; width: auto; display: block; }
  .cta { display: inline-block; margin-top: 22px; padding: 13px 30px; border: 1px solid var(--goldDeep);
         border-radius: 8px; color: var(--gold); text-decoration: none; font-size: 16px; }
  .cta:hover { background: rgba(207,168,81,0.08); }
  .home { margin-top: 30px; font-size: 15px; letter-spacing: 2px; text-transform: uppercase; }
  .home a { color: var(--gold); text-decoration: none; border-bottom: 1px solid var(--goldDeep); padding-bottom: 2px; }
  footer { margin-top: 56px; font-size: 13px; color: var(--soft); line-height: 2; }
  footer a { color: var(--soft); }
  .fine { font-size: 12px; margin-top: 10px; font-style: italic; }
</style>
<script>
/* This day's name, sealed until the visitor's own calendar reaches it: the
   same rule the app follows. The payload is written by
   tools/site/build_site_pages.py in the app repo (FNV-1a seed, mulberry32 XOR,
   base64, seed "p:" + date). Any failure leaves the page as it was. */
window.__page = { date: "${date}", sealed: "${sealed}" };
(function () {
  function isoOf(d) {
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  var page = window.__page, rendered = isoOf(new Date());
  try {
    if (rendered < page.date) {
      document.documentElement.className += " is-sealed";
    } else {
      var fnv1a = function (str) {
        var h = 0x811c9dc5, b = new TextEncoder().encode(str);
        for (var i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
        return h >>> 0;
      };
      var mulberry32 = function (a) {
        return function () {
          a = (a + 0x6D2B79F5) | 0;
          var t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return (t ^ (t >>> 14)) >>> 0;
        };
      };
      var raw = atob(page.sealed), rnd = mulberry32(fnv1a("p:" + page.date)), out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i) ^ (rnd() & 0xff);
      var day = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(out));
      if (day && day.n) {
        window.__day = day;
        document.documentElement.className += " is-open";
      }
    }
  } catch (e) { /* leave the page as it was */ }
  /* A sealed page left open overnight opens itself in the morning. */
  try {
    var again = function () { if (isoOf(new Date()) !== rendered) location.reload(); };
    window.addEventListener("pageshow", again);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") again();
    });
  } catch (e) {}
})();
</script>
</head>
<body>
<main>
  <a class="brand" href="../../">The Frequency Almanac</a>
  <div class="divider"><span class="ln"></span><span>&#10022;</span><span class="ln"></span></div>
  <section class="day" id="day">
    <div class="date">${lab.full}</div>
    <p class="plain">Every day has a name.</p>
    <div class="open">
      <div class="lead">${lab.monthDay} is called</div>
      <div class="name" id="day-name"></div>
      <div class="keys" id="day-keys"></div>
      <p class="closing" id="day-closing"></p>
    </div>
    <p class="sealed">This page is still sealed. It opens on the morning of ${lab.monthDay}.</p>
  </section>
  <script>
  (function () {
    var t = window.__day; if (!t) return;
    try {
      document.getElementById("day-name").textContent = t.n;
      document.getElementById("day-keys").textContent = (t.k || []).join("  \\u2726  ");
      document.getElementById("day-closing").textContent = t.c || "";
    } catch (e) {
      document.documentElement.className = document.documentElement.className.replace(" is-open", "");
    }
  })();
  </script>

${badges('../../', 'd', 'day_page')}
${srcScript()}

  <div class="open"><a class="cta" href="${APP_SCHEME}://day/${date}">Open in the app</a></div>

  <p class="home"><a href="../../">Find out what today is called</a></p>

${footer('../../')}
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------- the open page
// A day before today. Exactly what the app's free tier shows for a day, in the
// app's order (app/day/[date].tsx with isPremium false): the name card (date,
// name, keywords, the doorway reading from src/cards.ts), the plate, the first
// Overall Frequency paragraph, one reflection question, one practice, then
// where the app shows its paywall one line saying the rest lives in the app,
// then the aphorism. Nothing premium: no traditions, no theme, no second
// question or practice.
function openPage(date, day, plate, ctx) {
  const lab = labels(date);
  const title = `${day.n} \u00b7 ${lab.long} reflection \u00b7 The Frequency Almanac`;
  const h1Text = `${lab.long}: ${day.n}`;
  const url = `${ORIGIN}/d/${date}/`;
  const image = `${ORIGIN}/d/og/${date}.jpg`;
  const monthUrl = `${ORIGIN}/d/${lab.month}/`;
  const plateUrl = plate ? `${ORIGIN}/d/plate/${date}.jpg` : null;
  const article = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: h1Text, description: day.q, datePublished: date,
    image: plateUrl ? [image, plateUrl] : [image],
    keywords: day.k.join(', '), inLanguage: 'en', url, mainEntityOfPage: url,
    author: { '@type': 'Organization', name: 'Vayelion Soul Maps', url: ORIGIN + '/' },
    publisher: { '@type': 'Organization', name: 'Vayelion Soul Maps', url: ORIGIN + '/',
      logo: { '@type': 'ImageObject', url: ORIGIN + '/hero.png' } },
    isPartOf: { '@type': 'WebSite', name: 'The Frequency Almanac', url: ORIGIN + '/' },
  };
  const crumbs = breadcrumb([['The Frequency Almanac', ORIGIN + '/'], [lab.monthName, monthUrl], [day.n, url]]);
  const extra = `<meta property="og:type" content="article">
<meta property="og:site_name" content="The Frequency Almanac">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(day.q)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="An engraved plate from The Frequency Almanac for ${lab.full}">
<meta property="article:published_time" content="${date}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(title)}">
<meta name="twitter:description" content="${escAttr(day.q)}">
<meta name="twitter:image" content="${image}">
<script type="application/ld+json">${jsonLd(article)}</script>
<script type="application/ld+json">${jsonLd(crumbs)}</script>
`;
  const navLink = (d, word) => {
    if (!d) return '<span></span>';
    const l = labels(d);
    const open = ctx.isOpen(d);
    const text = open ? `${l.monthDay}, ${ctx.day(d).n}` : l.monthDay;
    return `<a href="../${d}/" rel="${word === 'Previous' ? 'prev' : 'next'}">${word}: ${escText(text)}</a>`;
  };
  const plateHtml = plate
    ? `\n  <figure class="plate"><img src="../plate/${date}.jpg" alt="${escAttr(day.s ? 'An engraving of ' + day.s : 'The engraved plate for ' + lab.long)}" width="${plate[0]}" height="${plate[1]}"></figure>`
    : '';
  return `${head({ title, desc: day.q, url, banner: `app-id=${APP_ID}, app-argument=${APP_SCHEME}://day/${date}`, extra })}
<body>
<main>
  <a class="brand" href="../../">The Frequency Almanac</a>
  <div class="divider"><span class="ln"></span><span>&#10022;</span><span class="ln"></span></div>
  <article>
  <header class="card">
    <div class="date">${lab.weekday}</div>
    <h1><span class="lead">${lab.long}:</span> <span class="name">${escText(day.n)}</span></h1>
    <div class="keys">${day.k.map(escText).join(`  ${DIAMOND}  `)}</div>
    <p class="reading">${escText(day.r)}</p>
  </header>${plateHtml}
  <div class="text">
    <h2>Overall Frequency</h2>
    <p>${escText(day.f)}</p>
    <h2>A Reflection Question</h2>
    <p>${escText(day.q)}</p>
    <h2>A Practice for Today</h2>
    <p>${escText(day.p)}</p>
  </div>
  <p class="inapp">The rest of this day lives in the app: its traditions, its theme, and the fuller set of questions and practices.</p>
  <div class="text">
    <h2>Universal Guidance</h2>
    <p class="gem">&#10022;</p>
    <p class="aphorism">${escText(day.a)}</p>
  </div>
  </article>

${badges('../../', 'd', 'day_page')}
${srcScript()}

  <div><a class="cta" href="${APP_SCHEME}://day/${date}">Open in the app</a></div>

  <nav class="nav" aria-label="Days">
    ${navLink(ctx.prev(date), 'Previous')}
    ${navLink(ctx.next(date), 'Next')}
    <a class="up" href="../${lab.month}/">All of ${lab.monthName}</a>
  </nav>

  <p class="home"><a href="../../">Find out what today is called</a></p>

${footer('../../')}
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------- the month page
function monthPage(ym, ctx) {
  const name = monthLabel(ym);
  const url = `${ORIGIN}/d/${ym}/`;
  const title = `${name} \u00b7 Day pages \u00b7 The Frequency Almanac`;
  const desc = `The ${name} pages of The Frequency Almanac: a name for every day, with its reflection question and one practice. An invitation, not a forecast.`;
  const dates = ctx.monthDates(ym);
  const anyOpen = dates.some(ctx.isOpen);
  const crumbs = breadcrumb([['The Frequency Almanac', ORIGIN + '/'], [name, url]]);
  const items = dates.map((d) => {
    const l = labels(d);
    if (ctx.isOpen(d)) {
      return `    <li><a href="../${d}/"><span class="d">${l.monthDay}</span> <span class="n">${escText(ctx.day(d).n)}</span></a></li>`;
    }
    return `    <li><a href="../${d}/"><span class="d">${l.monthDay}</span> <span class="sealed">still sealed</span></a></li>`;
  }).join('\n');
  const months = ctx.months;
  const i = months.indexOf(ym);
  const prevM = i > 0 ? months[i - 1] : null;
  const nextM = i < months.length - 1 ? months[i + 1] : null;
  const robots = anyOpen ? '' : '<meta name="robots" content="noindex">\n';
  const extra = `${robots}<script type="application/ld+json">${jsonLd(crumbs)}</script>
`;
  const promptsLink = ctx.promptMonths.includes(ym)
    ? `\n  <p class="home"><a href="../../prompts/${ym}/">${name} journal prompts</a></p>` : '';
  return `${head({ title, desc, url, banner: `app-id=${APP_ID}`, extra })}
<body>
<main>
  <a class="brand" href="../../">The Frequency Almanac</a>
  <div class="divider"><span class="ln"></span><span>&#10022;</span><span class="ln"></span></div>
  <h1 class="page">${name}</h1>
  <p class="intro">Every day has a name. A day's page opens the morning after it, with its reflection question and one practice; the days still to come stay sealed.</p>
  <ul class="days">
${items}
  </ul>${promptsLink}

  <nav class="nav" aria-label="Months">
    ${prevM ? `<a href="../${prevM}/" rel="prev">${monthLabel(prevM)}</a>` : '<span></span>'}
    ${nextM ? `<a href="../${nextM}/" rel="next">${monthLabel(nextM)}</a>` : '<span></span>'}
  </nav>

${badges('../../', 'd', 'month_page')}

  <p class="home"><a href="../../">Find out what today is called</a></p>

${footer('../../')}
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------- the prompts page
function promptsPage(ym, ctx) {
  const name = monthLabel(ym);
  const url = `${ORIGIN}/prompts/${ym}/`;
  const title = `${name} journal prompts \u00b7 The Frequency Almanac`;
  const desc = `Journal prompts for ${name}: one reflection question for each day, from The Frequency Almanac. An invitation, not a forecast.`;
  const crumbs = breadcrumb([['The Frequency Almanac', ORIGIN + '/'], [name, `${ORIGIN}/d/${ym}/`], [`${name} journal prompts`, url]]);
  const items = ctx.monthDates(ym).filter(ctx.isOpen).map((d) => {
    const day = ctx.day(d);
    return `    <li><p class="q">${escText(day.q)}</p><p class="from"><a href="../../d/${d}/">${labels(d).monthDay} &nbsp;&#10022;&nbsp; ${escText(day.n)}</a></p></li>`;
  }).join('\n');
  const extra = `<script type="application/ld+json">${jsonLd(crumbs)}</script>
`;
  return `${head({ title, desc, url, banner: `app-id=${APP_ID}`, extra })}
<body>
<main>
  <a class="brand" href="../../">The Frequency Almanac</a>
  <div class="divider"><span class="ln"></span><span>&#10022;</span><span class="ln"></span></div>
  <h1 class="page">${name} journal prompts</h1>
  <p class="intro">One reflection question for each day of ${name} that has opened, a question to journal with. Each links to its day, with the practice that goes with it.</p>
  <ul class="prompts">
${items}
  </ul>

  <p class="home"><a href="../../d/${ym}/">All of ${name}</a></p>

${badges('../../', 'd', 'prompts_page')}

  <p class="home"><a href="../../">Find out what today is called</a></p>

${footer('../../')}
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------- sitemap, robots, home links
function sitemap(ctx, legalPresent) {
  const urls = [ORIGIN + '/'];
  for (const ym of ctx.months) if (ctx.monthDates(ym).some(ctx.isOpen)) urls.push(`${ORIGIN}/d/${ym}/`);
  for (const ym of ctx.promptMonths) urls.push(`${ORIGIN}/prompts/${ym}/`);
  for (const d of ctx.dates) if (ctx.isOpen(d)) urls.push(`${ORIGIN}/d/${d}/`);
  for (const f of legalPresent) urls.push(`${ORIGIN}/${f}`);
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((u) => `  <url><loc>${escText(u)}</loc></url>`).join('\n')
    + '\n</urlset>\n';
}

const ROBOTS = `User-agent: *
Disallow: /tools/
Allow: /

Sitemap: ${ORIGIN}/sitemap.xml
`;

// The landing page links to each month that has begun.
function homeMonths(ctx) {
  const begun = ctx.months.filter((ym) => ctx.monthDates(ym).some(ctx.isOpen));
  const links = begun.map((ym) => `<a href="d/${ym}/">${monthLabel(ym)}</a>`).join(' &nbsp;&#10022;&nbsp; ');
  return `<!--MONTHS-START--><nav class="months" aria-label="Past days"><p class="months-head">Past days, open to read</p><p>${links}</p></nav><!--MONTHS-END-->`;
}

// What must never be legible for a sealed day: its name always; its keyword
// line; and from each longer text the whole of it and a 40-character slice
// from its middle, raw and HTML-escaped.
export function sealedNeedles(day) {
  const list = [{ text: day.n, always: true }, { text: escText(day.n), always: true },
    { text: day.k.join(`  ${DIAMOND}  `) }, { text: day.k.map(escText).join(`  ${DIAMOND}  `) }];
  for (const field of ['r', 'f', 'q', 'p', 'a', 's']) {
    const t = day[field];
    if (!t || t.length < 24) continue;
    const mid = Math.max(0, Math.floor(t.length / 2) - 20);
    for (const piece of [t, t.slice(mid, mid + 40)]) list.push({ text: piece }, { text: escText(piece) });
  }
  return list;
}

// ---------------------------------------------------------------- build
export function render(siteDir, today) {
  if (!DATE_RE.test(today)) throw new Error('today must be YYYY-MM-DD, got ' + today);
  const data = JSON.parse(fs.readFileSync(path.join(siteDir, 'd', 'days.json'), 'utf8'));
  if (data.format !== 1 || !Array.isArray(data.days)) throw new Error('d/days.json: unknown format');
  const entries = data.days;
  const dates = entries.map((e) => e.date);
  for (let i = 0; i < dates.length; i++) {
    if (!DATE_RE.test(dates[i])) throw new Error('d/days.json: bad date ' + dates[i]);
    if (i && dates[i] <= dates[i - 1]) throw new Error('d/days.json: dates not strictly ascending at ' + dates[i]);
  }
  const days = {}, plates = {}, sealedOf = {};
  for (const e of entries) {
    const d = JSON.parse(unseal(e.date, e.sealed));
    for (const k of ['n', 'c', 'r', 'f', 'q', 'p', 'a', 's']) {
      if (typeof d[k] !== 'string') throw new Error(`${e.date}: payload field ${k} missing`);
    }
    if (!Array.isArray(d.k) || !d.n) throw new Error(`${e.date}: payload name or keywords missing`);
    days[e.date] = d; plates[e.date] = e.plate || null; sealedOf[e.date] = e.sealed;
  }
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const isOpen = (d) => d < today;
  const ctx = {
    dates, months, isOpen, day: (d) => days[d],
    prev: (d) => { const i = dates.indexOf(d); return i > 0 ? dates[i - 1] : null; },
    next: (d) => { const i = dates.indexOf(d); return i < dates.length - 1 ? dates[i + 1] : null; },
    monthDates: (ym) => dates.filter((d) => d.startsWith(ym + '-')),
  };
  ctx.promptMonths = months.filter((ym) => ctx.monthDates(ym).some(isOpen));

  const out = new Map();
  for (const d of dates) {
    out.set(`d/${d}/index.html`, isOpen(d) ? openPage(d, days[d], plates[d], ctx) : sealedPage(d, sealedOf[d]));
  }
  for (const ym of months) out.set(`d/${ym}/index.html`, monthPage(ym, ctx));
  for (const ym of ctx.promptMonths) out.set(`prompts/${ym}/index.html`, promptsPage(ym, ctx));
  const legalPresent = LEGAL.filter((f) => fs.existsSync(path.join(siteDir, f)));
  out.set('sitemap.xml', sitemap(ctx, legalPresent));
  out.set('robots.txt', ROBOTS);
  const indexPath = path.join(siteDir, 'index.html');
  const index = fs.readFileSync(indexPath, 'utf8');
  const blockRe = /<!--MONTHS-START-->[\s\S]*?<!--MONTHS-END-->/g;
  if ((index.match(blockRe) || []).length !== 1) throw new Error('index.html must hold exactly one <!--MONTHS-START-->...<!--MONTHS-END--> block');
  out.set('index.html', index.replace(blockRe, () => homeMonths(ctx)));

  // Guard: nothing of today or any later day may be legible in anything this
  // run writes. If it ever is, write nothing at all. A phrase that an open
  // day legitimately prints too (a shared keyword, a common opening) proves
  // nothing either way and is skipped; the name never is.
  const leaks = [];
  const texts = [...out.values()];
  const openCorpus = dates.filter(isOpen).map((d) => {
    const x = days[d];
    return [x.n, x.k.join('  ' + DIAMOND + '  '), x.r, x.f, x.q, x.p, x.a, x.s]
      .map((t) => t + '\n' + escText(t)).join('\n');
  }).join('\n');
  for (const d of dates) {
    if (isOpen(d)) continue;
    for (const n of sealedNeedles(days[d])) {
      if (n.always || !openCorpus.includes(n.text)) {
        if (texts.some((t) => t.includes(n.text))) leaks.push(`${d}: "${n.text}"`);
      }
    }
  }
  if (leaks.length) throw new Error('REFUSING TO WRITE: a sealed day would be legible: ' + leaks.slice(0, 3).join('; '));

  // What to remove: generated pages for days, months or prompts no longer loaded or opened.
  const remove = [];
  const dDir = path.join(siteDir, 'd');
  for (const e of fs.existsSync(dDir) ? fs.readdirSync(dDir) : []) {
    if ((DATE_RE.test(e) && !dates.includes(e)) || (MONTH_RE.test(e) && !months.includes(e))) remove.push(`d/${e}`);
  }
  const pDir = path.join(siteDir, 'prompts');
  for (const e of fs.existsSync(pDir) ? fs.readdirSync(pDir) : []) {
    if (MONTH_RE.test(e) && !ctx.promptMonths.includes(e)) remove.push(`prompts/${e}`);
  }
  return { out, remove, open: dates.filter(isOpen), sealed: dates.filter((d) => !isOpen(d)), months, promptMonths: ctx.promptMonths };
}

export function apply(siteDir, result) {
  const changed = [];
  for (const [rel, text] of result.out) {
    const p = path.join(siteDir, rel);
    const prev = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (prev === text) continue;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
    changed.push(rel);
  }
  for (const rel of result.remove) {
    fs.rmSync(path.join(siteDir, rel), { recursive: true, force: true });
    changed.push(rel + ' (removed)');
  }
  return changed;
}

function changes(siteDir, result) {
  const list = [];
  for (const [rel, text] of result.out) {
    const p = path.join(siteDir, rel);
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== text) list.push(rel);
  }
  return list.concat(result.remove.map((r) => r + ' (removed)'));
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const site = arg('--site');
  if (!site) { console.log('usage: node open_days.mjs --site <site dir> [--today YYYY-MM-DD] [--dry]'); process.exit(2); }
  const today = arg('--today') || pacificToday();
  const result = render(path.resolve(site), today);
  const first = result.open[0], last = result.open[result.open.length - 1];
  console.log(`today (America/Los_Angeles): ${today}`);
  console.log(`open day pages: ${result.open.length}${first ? ` (${first} to ${last})` : ''}; sealed: ${result.sealed.length}`);
  console.log(`month pages: ${result.months.length}; prompts pages: ${result.promptMonths.length}`);
  if (argv.includes('--dry')) {
    const list = changes(path.resolve(site), result);
    console.log(`would change: ${list.length}`);
    for (const r of list.slice(0, 40)) console.log('  ' + r);
    return;
  }
  const changed = apply(path.resolve(site), result);
  console.log(`files changed: ${changed.length}`);
  for (const r of changed.slice(0, 40)) console.log('  ' + r);
  if (changed.length > 40) console.log(`  ... and ${changed.length - 40} more`);
}

const invoked = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}
