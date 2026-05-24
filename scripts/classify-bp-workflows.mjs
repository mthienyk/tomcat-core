/**
 * Classify portfolio BP files on Drive into workflow types:
 * - transform: founder/custom BP → Tomcat template
 * - generate: inputs only (DSN, prêts, template) → Tomcat template from scratch
 * - analysis: M2 / due diligence / synthèse (not operational BP)
 * - canonical: already uses MAJ Template BP SaaS structure
 *
 * Usage: node scripts/classify-bp-workflows.mjs
 */
import { readFileSync } from "fs";
import { join } from "path";
import { GoogleAuth } from "google-auth-library";
import {
  BP_CANONICAL_DETECTION_TABS,
} from "./lib/bpTemplateCatalog.mjs";

const SHARED = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID ?? "0AO2MAh9ncUDNUk9PVA";
const CREDS_PATH =
  process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE ??
  ".secrets/tomcat-ai-backend-71e0e34e307f.json";

const CREDS = JSON.parse(readFileSync(CREDS_PATH, "utf8"));
const auth = new GoogleAuth({
  credentials: CREDS,
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});
const token = await auth.getAccessToken();

const CANONICAL_TABS = new Set(BP_CANONICAL_DETECTION_TABS);

async function search(q, limit = 200, fields = "files(id,name,mimeType,modifiedTime,parents)") {
  const p = new URLSearchParams({
    q,
    pageSize: String(Math.min(limit, 200)),
    fields: `nextPageToken,${fields}`,
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    corpora: "drive",
    driveId: SHARED,
    orderBy: "modifiedTime desc",
  });
  const all = [];
  let pageToken;
  do {
    if (pageToken) p.set("pageToken", pageToken);
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?${p}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json();
    all.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
    if (all.length >= limit) break;
  } while (pageToken);
  return all.slice(0, limit);
}

function classifyByFilename(name) {
  const n = name.toLowerCase();
  if (/template|maj template|old bp saas/.test(n)) return "template_ref";
  if (/analysis|synthèse|synth|m2|questions m2|due diligence|dd /.test(n))
    return "analysis";
  if (/tomcat bp|bp tomcat| - tomcat|tomcat -/.test(n)) return "tomcat_labeled";
  if (/business plan|bp financier|bp saas|fundraising|previsionnel|prévisionnel/.test(n))
    return "founder_bp";
  if (/dsn|bulletin|paie|payroll/.test(n)) return "payroll_input";
  if (/prêt|pret|loan|échéancier|echeancier|financement|bpi|emprunt/.test(n))
    return "debt_input";
  if (/bp/.test(n)) return "bp_other";
  return "other";
}

function inferWorkflow(signals) {
  const { filenameClass, hasCanonicalTabs, hasFounderStructure, hasInputsNearby } =
    signals;

  if (filenameClass === "template_ref") return "reference";
  if (hasCanonicalTabs) return "canonical";
  if (filenameClass === "analysis" || filenameClass === "tomcat_labeled") {
    if (hasFounderStructure && !hasCanonicalTabs) return "transform";
    if (filenameClass === "analysis") return "analysis";
    return hasInputsNearby ? "generate" : "transform_or_generate";
  }
  if (filenameClass === "founder_bp" || filenameClass === "bp_other") {
    if (hasCanonicalTabs) return "canonical";
    if (hasFounderStructure) return "transform";
    return "transform_or_generate";
  }
  if (filenameClass === "payroll_input" || filenameClass === "debt_input") {
    return "generate_input";
  }
  return "unknown";
}

async function analyzeLocalXlsx(path) {
  if (!existsSync(path)) return null;
  try {
    const openpyxl = await import("openpyxl").catch(() => null);
    if (!openpyxl) return null;
    // openpyxl is python-only; skip — use shell python instead
    return null;
  } catch {
    return null;
  }
}

// --- Drive scan ---
console.log("Scanning Drive for BP-related files...\n");

const queries = [
  ["bp_xlsx", "name contains 'BP' and mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and trashed = false"],
  ["business_plan", "(name contains 'Business Plan' or name contains 'Business plan') and trashed = false and mimeType != 'application/vnd.google-apps.folder'"],
  ["tomcat_bp", "name contains 'Tomcat' and (name contains 'BP' or name contains 'Business') and trashed = false"],
  ["dsn", "(name contains 'DSN' or name contains 'dsn') and trashed = false and mimeType != 'application/vnd.google-apps.folder'"],
  ["loan", "(name contains 'prêt' or name contains 'pret' or name contains 'échéancier' or name contains 'emprunt') and trashed = false"],
];

const seen = new Set();
const files = [];

for (const [label, q] of queries) {
  const hits = await search(q, 120);
  for (const f of hits) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    files.push({ ...f, querySource: label });
  }
}

console.log(`Unique files across queries: ${files.length}\n`);

const byFilename = {};
for (const f of files) {
  const c = classifyByFilename(f.name);
  byFilename[c] = (byFilename[c] ?? 0) + 1;
}
console.log("Filename classification:");
for (const [k, v] of Object.entries(byFilename).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}

// Portfolio-ish: exclude templates folder and marketing
const portfolioCandidates = files.filter((f) => {
  const n = f.name.toLowerCase();
  return (
    !/template|05\. templates|marketing|cold call|events internes/.test(n) &&
    !/\.(png|jpg|jpeg|svg|webp|pdf)$/.test(n) &&
    (n.includes("bp") || n.includes("business plan") || n.includes("dsn"))
  );
});

console.log(`\nPortfolio-ish candidates (excl. templates/marketing): ${portfolioCandidates.length}`);

// Recent 2025-2026 only
const recent = portfolioCandidates.filter((f) => {
  const y = (f.modifiedTime ?? "").slice(0, 4);
  return y === "2025" || y === "2026";
});
console.log(`Recent (2025-2026): ${recent.length}\n`);

for (const f of recent.slice(0, 40)) {
  const fc = classifyByFilename(f.name);
  console.log(
    f.modifiedTime?.slice(0, 10),
    `[${fc.padEnd(14)}]`,
    f.name.slice(0, 70),
  );
}
