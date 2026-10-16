// Plugin de Kino: Gente Clic (genteclic.com) — películas en español.
// El sitio es un WordPress con el tema Jeg: cada película vive en https://www.genteclic.com/<slug>/
// y el reproductor es un embed (ok.ru, bitchute, youtube, vimeo...). De ok.ru sacamos el HLS directo
// con kino.fetch; de los demás, abrimos el embed en el navegador oculto.

const BASE = "https://www.genteclic.com";

function log(...args) {
  try {
    kino.log(...args);
  } catch {
    // la línea de log se pierde, el resultado no
  }
}

const NAMED = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  rsquo: "\u2019",
  lsquo: "\u2018",
  ldquo: "\u201c",
  rdquo: "\u201d",
};

function decodeEntities(raw) {
  let s = String(raw == null ? "" : raw);
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)));
  s = s.replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)));
  s = s.replace(/&([a-z]+);/gi, (m, name) => {
    const v = NAMED[name.toLowerCase()];
    return v == null ? m : v;
  });
  return s;
}

function codePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 1114111) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

function stripTags(s) {
  return decodeEntities(String(s == null ? "" : s).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// ---- URL helpers ------------------------------------------------------------------------------

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isHost(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

// A YouTube/Vimeo link becomes its embed form so the hidden browser has a player to open.
function normalizeEmbedUrl(raw) {
  let u = String(raw == null ? "" : raw).trim();
  if (!u) return null;
  if (u.startsWith("//")) u = "https:" + u;
  u = u.replace(/&amp;/g, "&").trim();
  if (!/^https?:\/\//i.test(u)) return null;
  let x;
  try {
    x = new URL(u);
  } catch {
    return null;
  }
  const host = x.hostname.toLowerCase();
  if (isHost(host, "youtu.be")) {
    const id = x.pathname.replace(/^\/+/, "").split("/")[0];
    if (id) return "https://www.youtube.com/embed/" + id;
  }
  if (isHost(host, "youtube.com") && /\/watch$/.test(x.pathname)) {
    const id = x.searchParams.get("v");
    if (id) return "https://www.youtube.com/embed/" + id;
  }
  if (isHost(host, "vimeo.com") && !/\/video\/\d+/.test(x.pathname)) {
    const id = (x.pathname.match(/\d+/) || [])[0];
    if (id) return "https://player.vimeo.com/video/" + id;
  }
  return u;
}

function isVideoEmbed(u) {
  let x;
  try {
    x = new URL(u);
  } catch {
    return false;
  }
  const host = x.hostname.toLowerCase();
  const path = x.pathname.toLowerCase();
  if (isHost(host, "ok.ru")) return true;
  if (isHost(host, "bitchute.com")) return true;
  if (isHost(host, "youtube.com") || isHost(host, "youtu.be")) return true;
  if (isHost(host, "vimeo.com")) return true;
  if (isHost(host, "dailymotion.com") || isHost(host, "dai.ly")) return true;
  if (/\/(embed|videoembed|player)\//.test(path)) return true;
  return false;
}

function labelOf(u) {
  const host = hostOf(u);
  if (isHost(host, "ok.ru")) return "ok.ru";
  if (isHost(host, "youtube.com") || isHost(host, "youtu.be")) return "YouTube";
  if (isHost(host, "vimeo.com")) return "Vimeo";
  if (isHost(host, "bitchute.com")) return "Bitchute";
  if (isHost(host, "dailymotion.com") || isHost(host, "dai.ly")) return "Dailymotion";
  return host.replace(/^www\./, "") || "Servidor";
}

function idFromUrl(url) {
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const slug = path.replace(/^\/+|\/+$/g, "");
  if (!slug) return null;
  const id = slug.replace(/[^A-Za-z0-9._~-]/g, "-").slice(0, 128);
  return id || null;
}

// ---- Search -----------------------------------------------------------------------------------

function findPoster(block) {
  let m = /\bdata-src="([^"]+)"/i.exec(block);
  let u = m ? m[1] : null;
  if (!u) {
    m = /<img\b[^>]*\bsrc="([^"]+)"/i.exec(block);
    u = m ? m[1] : null;
  }
  if (!u) return undefined;
  u = u.replace(/&amp;/g, "&").trim();
  if (!/^https?:\/\//i.test(u)) return undefined;
  if (/jeg-empty|themes\/jnews\/assets|placeholder|blank\.|data:image/i.test(u)) return undefined;
  return u.slice(0, 2048);
}

function parseArticles(html) {
  const out = [];
  const arts = html.match(/<article\b[\s\S]*?<\/article>/gi) || [];
  for (const a of arts) {
    let url = null;
    let name = "";
    const titled = /<h3[^>]*class="[^"]*jeg_post_title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(a);
    if (titled) {
      url = titled[1];
      name = stripTags(titled[2]);
    }
    if (!url) {
      const aria = /<a[^>]*href="([^"]+)"[^>]*aria-label="Read article:\s*([^"]*)"/i.exec(a);
      if (aria) {
        url = aria[1];
        name = decodeEntities(aria[2]).trim();
      }
    }
    if (!url) continue;
    url = url.replace(/&amp;/g, "&").trim();
    if (/\/category\/|\/tag\/|\/author\/|\/page\/|\/feed|\/wp-|\?s=/i.test(url)) continue;
    if (!name) continue;
    const poster = findPoster(a);
    if (!poster) continue;
    const id = idFromUrl(url);
    if (!id) continue;
    out.push({ id, ref: url, title: name.slice(0, 200), kind: "movie", poster });
  }
  return out;
}

export async function search(query) {
  const q = query && typeof query.q === "string" ? query.q.trim() : "";
  if (!q) return [];
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= 3; page++) {
    const url = BASE + "/?s=" + encodeURIComponent(q) + (page > 1 ? "&paged=" + page : "");
    let r;
    try {
      r = await kino.fetch(url, { headers: { "Accept-Language": "es-CO,es;q=0.9" } });
    } catch (e) {
      if (page === 1) throw e;
      break;
    }
    if (!r.ok) {
      if (page === 1) throw kino.error("unavailable", "genteclic respondió " + r.status);
      break;
    }
    const items = parseArticles(r.text());
    if (!items.length) break;
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
      if (out.length >= 100) return out;
    }
    if (items.length < 20) break;
  }
  return out;
}

// ---- The movie page and its players -----------------------------------------------------------

const pageCache = new Map();
const PAGE_CACHE_MAX = 40;

async function moviePage(url) {
  if (pageCache.has(url)) return pageCache.get(url);
  const r = await kino.fetch(url, { headers: { "Accept-Language": "es-CO,es;q=0.9" } });
  if (!r.ok) throw kino.error("unavailable", "genteclic respondió " + r.status);
  const text = r.text();
  if (pageCache.size >= PAGE_CACHE_MAX) pageCache.delete(pageCache.keys().next().value);
  pageCache.set(url, text);
  return text;
}

function parseEmbeds(html) {
  const found = [];
  const seen = new Set();
  const add = (raw) => {
    const u = normalizeEmbedUrl(raw);
    if (!u) return;
    const key = u.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(u);
  };
  let m;
  const reIframe = /<iframe\b[^>]*\bsrc\s*=\s*"([^"]+)"/gi;
  while ((m = reIframe.exec(html))) add(m[1]);
  const reJs = /setAttribute\(\s*['"]src['"]\s*,\s*['"]([^'"]+)['"]\s*\)/gi;
  while ((m = reJs.exec(html))) add(m[1]);
  const reDiv = /<div\b[^>]*\bdata-type\s*=\s*"[^"]*"[^>]*>/gi;
  while ((m = reDiv.exec(html))) {
    const ds = /\bdata-src\s*=\s*"([^"]+)"/i.exec(m[0]);
    if (ds) add(ds[1]);
  }
  return found.filter(isVideoEmbed);
}

// ok.ru hides the direct HLS address in its embed page: "hlsManifestUrl":"https://...\u0026...".
function extractOkRu(text) {
  const at = text.indexOf("hlsManifestUrl");
  if (at === -1) return null;
  const seg = text.slice(at, at + 8000);
  const start = seg.indexOf("https:");
  if (start === -1) return null;
  let end = seg.indexOf("&quot;", start);
  if (end === -1) end = seg.indexOf("\\u0022", start);
  if (end === -1) end = seg.indexOf('"', start);
  if (end === -1) end = seg.length;
  const url = seg
    .slice(start, end)
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\u003D/gi, "=")
    .replace(/\\u003F/gi, "?")
    .replace(/&amp;/g, "&");
  return /^https?:\/\/[^\s"']+$/i.test(url) ? url : null;
}

async function resolveOkRu(embedUrl) {
  const r = await kino.fetch(embedUrl, { headers: { "Referer": BASE + "/" } });
  if (!r.ok) throw kino.error("unavailable", "ok.ru respondió " + r.status);
  const hls = extractOkRu(r.text());
  if (!hls) throw kino.error("not_found", "ok.ru no entregó el video");
  return { url: hls };
}

async function capture(embedUrl) {
  if (!kino.browser || typeof kino.browser.capture !== "function") {
    throw kino.error("unavailable", "este dispositivo no puede abrir el reproductor");
  }
  const page = await kino.browser.capture(embedUrl, { timeoutMs: 18000 });
  const media = (page && page.media) || [];
  if (!media.length) throw kino.error("not_found", "el reproductor no entregó el video");
  const stream = streamOf(media[0]);
  const alts = [];
  for (let i = 1; i < media.length && alts.length < 4; i++) alts.push(streamOf(media[i]));
  if (alts.length) stream.alternatives = alts;
  return stream;
}

function streamOf(m) {
  const s = { url: m.url };
  if (m.mime) s.mime = m.mime;
  if (m.headers && typeof m.headers === "object") s.headers = m.headers;
  return s;
}

async function resolveEmbed(embedUrl) {
  if (isHost(hostOf(embedUrl), "ok.ru")) {
    try {
      return await resolveOkRu(embedUrl);
    } catch (e) {
      log("ok.ru falló, pruebo el navegador:", e && e.message);
      return await capture(embedUrl);
    }
  }
  return await capture(embedUrl);
}

export async function details(ref) {
  await null;
  return null;
}

export async function resolve(ref) {
  const cut = ref.indexOf("|");
  const movieUrl = cut === -1 ? ref : ref.slice(0, cut);
  const idx = cut === -1 ? -1 : Number(ref.slice(cut + 1));
  const html = await moviePage(movieUrl);
  const embeds = parseEmbeds(html);
  if (!embeds.length) throw kino.error("not_found", "esta película no tiene reproductor");
  if (idx >= 0) {
    const chosen = embeds[idx];
    if (!chosen) throw kino.error("not_found", "ese servidor ya no está disponible");
    return await resolveEmbed(chosen);
  }
  let firstError = null;
  const tries = Math.min(embeds.length, 3);
  for (let i = 0; i < tries; i++) {
    try {
      const stream = await resolveEmbed(embeds[i]);
      const alternatives = [];
      for (let j = 0; j < embeds.length && alternatives.length < 8; j++) {
        if (j === i) continue;
        alternatives.push({ label: labelOf(embeds[j]), ref: movieUrl + "|" + j });
      }
      const out = { ...stream, label: labelOf(embeds[i]) };
      if (alternatives.length) out.alternatives = alternatives;
      return out;
    } catch (e) {
      if (!firstError) firstError = e;
      const code = e && e.code;
      if (code === "blocked" || code === "timeout" || code === "unavailable" || code === "not_found") continue;
      break;
    }
  }
  throw firstError || kino.error("not_found", "no se pudo abrir el video");
}
