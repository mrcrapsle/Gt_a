// Sucht auf festen Quellseiten nach neuen Hinweisen für Leonida Vault.
// Ergebnis: data/updates.json mit Kandidaten, die ein Mensch vor dem Übernehmen prüft.
// Läuft per GitHub Action (siehe .github/workflows/update-finder.yml).
import { readFile, writeFile } from "node:fs/promises";

const USER_AGENT = "LeonidaVaultUpdater/1.0 (+https://github.com/mrcrapsle/Gt_a)";
const SOURCES = [
  { name: "GTABase (DE, Karte)", url: "https://www.gtabase.com/de/gta-6/karte/" },
  { name: "Beebom (Geld-Spots)", url: "https://beebom.com/gta-6-best-money-spots/" }
];
const KEYWORDS = ["fundort", "versteck", "lagerhaus", "waffe", "glitch", "cheat", "geld", "$", "safe", "schatz", "gold"];
const MAX_PER_SOURCE = 15;
const OUT = "data/updates.json";

const norm = s => s.toLowerCase().replace(/\s+/g, " ").trim();

function htmlToSentences(html) {
  const text = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"');
  return text.split(/(?<=[.!?])\s+|\n+/).map(x => x.replace(/\s+/g, " ").trim());
}

async function robotsAllows(url) {
  try {
    const u = new URL(url);
    const res = await fetch(`${u.origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return true; // kein robots.txt → erlaubt
    const lines = (await res.text()).split("\n").map(l => l.trim());
    let applies = false;
    for (const l of lines) {
      const [k, ...rest] = l.split(":");
      const v = rest.join(":").trim();
      if (/^user-agent$/i.test(k)) applies = v === "*" || /leonida/i.test(v);
      if (applies && /^disallow$/i.test(k) && v && u.pathname.startsWith(v)) return false;
    }
    return true;
  } catch { return false; }
}

async function collect(source, existingText) {
  if (!(await robotsAllows(source.url))) {
    return { source, error: "robots.txt verbietet den Abruf", candidates: [] };
  }
  const res = await fetch(source.url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return { source, error: `HTTP ${res.status}`, candidates: [] };
  const sentences = htmlToSentences(await res.text());
  const seen = new Set();
  const candidates = [];
  for (const s of sentences) {
    if (s.length < 40 || s.length > 300) continue;
    const n = norm(s);
    if (!KEYWORDS.some(k => n.includes(k))) continue;
    if (seen.has(n.slice(0, 60))) continue;
    seen.add(n.slice(0, 60));
    // Doppelt, wenn der Anfang schon in der App steht.
    if (existingText.includes(n.slice(0, 60))) continue;
    candidates.push({
      id: "cand-" + Buffer.from(n.slice(0, 40)).toString("base64url").slice(0, 16),
      text: s,
      source: source.name,
      sourceUrl: source.url,
      status: "ungeprüft"
    });
    if (candidates.length >= MAX_PER_SOURCE) break;
  }
  return { source, error: null, candidates };
}

async function main() {
  const html = await readFile("index.html", "utf8");
  const existingText = norm(html);
  const results = [];
  for (const src of SOURCES) {
    try { results.push(await collect(src, existingText)); }
    catch (e) { results.push({ source: src, error: String(e.message || e), candidates: [] }); }
  }
  const candidates = results.flatMap(r => r.candidates);
  const out = {
    generatedAt: new Date().toISOString(),
    note: "Automatisch gesammelt. Nichts davon ist im Spiel bestätigt.",
    sources: results.map(r => ({ name: r.source.name, url: r.source.url, error: r.error, found: r.candidates.length })),
    candidates
  };
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Kandidaten: ${candidates.length}`);
  for (const r of results) console.log(`- ${r.source.name}: ${r.error ? "Fehler: " + r.error : r.candidates.length + " Treffer"}`);
}

await main();
