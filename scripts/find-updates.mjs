// Sucht auf festen Quellseiten nach konkreten Hinweisen für Leonida Vault.
// Ergebnis: data/updates.json mit Kandidaten, die ein Mensch vor dem Übernehmen prüft.
// Läuft per GitHub Action (siehe .github/workflows/update-finder.yml).
import { readFile, writeFile } from "node:fs/promises";

const USER_AGENT = "LeonidaVaultUpdater/1.0 (+https://github.com/mrcrapsle/Gt_a)";
const SOURCES = [
  { name: "GTABase (DE, Karte)", url: "https://www.gtabase.com/de/gta-6/karte/" },
  { name: "Beebom (Geld-Spots)", url: "https://beebom.com/gta-6-best-money-spots/" }
];
const MAX_PER_SOURCE = 15;
const OUT = "data/updates.json";

// Konkrete Angaben: Geldbetrag oder benannter Gegenstand/Ort aus dem Spiel.
const MONEY = /\$\s?\d[\d.,]*|\d[\d.,]*\s?\$/;
const ITEM_TERMS = /\b(safe|vent|duffel|cash register|cocaine|collectible|card|crash site|treasure|weapon|shotgun|smg|rifle|pistol|launcher|lmg|glitch|code|cheat)\b/i;
const WEAPON_TERMS = /\b(hobo shotgun|marabunta grande|kingfisher|hunter'?s laird|gutterball|couch potato|crabshack|nipper|gorse|goodwin|hauners|smg|kalinga|duke 556)\b/i;
// Angaben, die bei uns schon stehen (Waffe oder Ort). Treffer dazu werden nicht übernommen.
// Stand: Einträge in index.html. Bei neuen Einträgen hier ergänzen.
const KNOWN_TERMS = [
  /hobo shotgun|marabunta grande/i,      // hobo-shotgun-hamlet
  /apollo aggregates/i,                  // Lagerhaus South Vice-Dale = Apollo Aggregates
  /south of hamlet|three miles from jason/i, // Übersichtssatz desselben Lagerhauses (Richtung unklar: App sagt „östlich“)
  /type 9|conspiracist/i,                // balsero-bunker
  /kingfisher|w-?22/i,                   // kingfishers-w22
  /crabshack|vf5/i,
  /nipper/i, /gorse/i, /gutterball/i, /couch potato|mustang .357/i,
  /waffenfreak|raketenwerfer|hauners h-at/i,
  /corkers/i,
  /exotic animals/i,                     // Glitch-Guide in index.html
  /treasure|kenton|leonida keys/i        // Guide "Schatzsuche um die Leonida Keys"
];
// Ich-Form und Nutzerkommentare: keine Fundort-Angaben, sondern Meinungen.
const FIRST_PERSON = /\b(ich|mein|meine|meinen|mir|mich)\b|\bI\b|\bmy\b|\bme\b|\bwe\b/i;
// Typische Nicht-Hinweise: Überschriften, Anleitungen, Werbung, Nutzerkommentare.
const REJECT = [
  /@/,                                   // Nutzerkommentar
  /^tips? to /i, /making money is only/i,  // Überschriften
  /^use an atm/i,                        // allgemeiner Tipp ohne Fundort
  /plenty of opportunities|some gta 6 locations for money|make extra money\.?$/i, // Einleitungen
  /\batm\b|trunk|house safe|store (them|your earnings)|deposit your/i,            // allgemeine Spiel-Tipps ohne Fundort
  /\b(cookie|newsletter|subscribe|sign up|advertis|share this|read more|click here)\b/i,
  /\b(interaktive karte|map: |unsere karte|komplettierer)\b/i,   // Werbetexte der Karte
  /\b(persönlich|mybase|seitenleiste)\b/i
];

const norm = s => s.toLowerCase().replace(/\s+/g, " ").trim();

// Entfernt Navigation, Kommentare, Werbung und Skripte, bevor Text extrahiert wird.
function stripBoilerplate(html) {
  return html
    .replace(/<(script|style|noscript|svg|iframe|form|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+(class|id)="[^"]*(comment|sidebar|menu|cookie|share|newsletter|related|promo|ad-)[^"]*"[^>]*>[\s\S]*?<\/(div|section|ul|aside)>/gi, " ");
}

// Liefert Sätze mit der zuletzt gesehenen Überschrift als Kontext.
function extract(html) {
  const cleaned = stripBoilerplate(html)
    .replace(/<(h[1-4])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner) => `\n@@H ${inner.replace(/<[^>]+>/g, " ")}\n`)
    .replace(/<\/(p|li|div|br|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&rsquo;|&#8217;/g, "’").replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"');
  const out = [];
  let heading = "";
  for (const line of cleaned.split("\n")) {
    const t = line.replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (t.startsWith("@@H ")) { heading = t.slice(4).trim(); continue; }
    for (const s of t.split(/(?<=[.!?])\s+/)) {
      const sent = s.trim();
      if (sent) out.push({ text: sent, heading });
    }
  }
  return out;
}

// Prüft, ob ein Satz ein konkreter, nutzbarer Hinweis ist.
export function isUsefulHint(text, context = "") {
  if (text.length < 40 || text.length > 300) return false;
  if (REJECT.some(r => r.test(text))) return false;
  if (FIRST_PERSON.test(text)) return false;
  // Alles unter einer „Tips …“-Überschrift ist Ratgeber, kein Fundort.
  if (/^tips?\b/i.test(context)) return false;
  // Doppelt zu einem Eintrag in der App? Die Überschrift zählt nur bei Guides/Einträgen,
  // die einen eigenen Namen in der Überschrift tragen (Exotic Animals, Kingfisher).
  const useContext = /exotic animals|kingfisher/i.test(context);
  const haystack = useContext ? `${text} ${context}` : text;
  if (KNOWN_TERMS.some(k => k.test(haystack))) return false;
  const concrete = MONEY.test(text) || WEAPON_TERMS.test(text) || ITEM_TERMS.test(text);
  return concrete;
}

async function robotsAllows(url) {
  try {
    const u = new URL(url);
    const res = await fetch(`${u.origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return true;
    let applies = false;
    for (const l of (await res.text()).split("\n").map(x => x.trim())) {
      const [k, ...rest] = l.split(":");
      const v = rest.join(":").trim();
      if (/^user-agent$/i.test(k)) applies = v === "*" || /leonida/i.test(v);
      if (applies && /^disallow$/i.test(k) && v && u.pathname.startsWith(v)) return false;
    }
    return true;
  } catch { return false; }
}

async function collect(source, existingText) {
  if (!(await robotsAllows(source.url))) return { source, error: "robots.txt verbietet den Abruf", candidates: [] };
  const res = await fetch(source.url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return { source, error: `HTTP ${res.status}`, candidates: [] };
  const seen = new Set();
  const candidates = [];
  for (const { text, heading } of extract(await res.text())) {
    if (!isUsefulHint(text, heading)) continue;
    const n = norm(text);
    if (seen.has(n.slice(0, 60)) || existingText.includes(n.slice(0, 60))) continue;
    seen.add(n.slice(0, 60));
    candidates.push({
      id: "cand-" + Buffer.from(n.slice(0, 40)).toString("base64url").slice(0, 16),
      text,
      context: heading || null,
      source: source.name,
      sourceUrl: source.url,
      language: "en",
      status: "ungeprüft"
    });
    if (candidates.length >= MAX_PER_SOURCE) break;
  }
  return { source, error: null, candidates };
}

async function main() {
  const existingText = norm(await readFile("index.html", "utf8"));
  const results = [];
  for (const src of SOURCES) {
    try { results.push(await collect(src, existingText)); }
    catch (e) { results.push({ source: src, error: String(e.message || e), candidates: [] }); }
  }
  const candidates = results.flatMap(r => r.candidates);
  const out = {
    generatedAt: new Date().toISOString(),
    note: "Automatisch gesammelt. Nichts davon ist im Spiel bestätigt. Quellen sind größtenteils Englisch.",
    sources: results.map(r => ({ name: r.source.name, url: r.source.url, error: r.error, found: r.candidates.length })),
    candidates
  };
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Kandidaten: ${candidates.length}`);
  for (const r of results) console.log(`- ${r.source.name}: ${r.error ? "Fehler: " + r.error : r.candidates.length + " Treffer"}`);
}

await main();
