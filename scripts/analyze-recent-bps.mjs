import { readFileSync } from "fs";
import { GoogleAuth } from "google-auth-library";

const SHARED = "0AO2MAh9ncUDNUk9PVA";
const CREDS = JSON.parse(
  readFileSync(".secrets/tomcat-ai-backend-71e0e34e307f.json", "utf8"),
);
const auth = new GoogleAuth({
  credentials: CREDS,
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});
const token = await auth.getAccessToken();

async function search(q, limit = 100) {
  const p = new URLSearchParams({
    q,
    pageSize: String(limit),
    fields: "files(id,name,mimeType,modifiedTime)",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    corpora: "drive",
    driveId: SHARED,
    orderBy: "modifiedTime desc",
  });
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?${p}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await r.json()).files ?? [];
}

const bps = await search(
  "(name contains 'BP' or name contains 'Business Plan') and trashed = false and mimeType != 'application/vnd.google-apps.folder'",
  60,
);

const recent = bps.filter((f) => (f.modifiedTime ?? "").startsWith("2026"));
console.log(`Recent 2026 BP files: ${recent.length}\n`);

const patterns = {
  tomcat_label: 0,
  m2_analysis: 0,
  custom_saas: 0,
  stub_small: 0,
  other: 0,
};

for (const f of recent) {
  const n = f.name.toLowerCase();
  let bucket = "other";
  if (/tomcat| - tomcat|bp tomcat/.test(n)) bucket = "tomcat_label";
  else if (/analysis|synthèse|synth|m2|questions/.test(n)) bucket = "m2_analysis";
  else if (/business plan|fundraising|revenue|mrr/.test(n)) bucket = "custom_saas";
  else if (n.endsWith(".xlsx") && !n.includes("template")) bucket = "other";
  patterns[bucket] += 1;
  console.log(f.modifiedTime?.slice(0, 10), `[${bucket}]`, f.name);
}

console.log("\nPattern counts (filename heuristics):");
for (const [k, v] of Object.entries(patterns)) {
  console.log(`  ${k}: ${v}`);
}
