import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
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
const dir = "/tmp/bp-study";
mkdirSync(dir, { recursive: true });

async function getMeta(id) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.json();
}

async function download(id, outPath) {
  const meta = await getMeta(id);
  const isGSheet = meta.mimeType === "application/vnd.google-apps.spreadsheet";
  const url = isGSheet
    ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}&supportsAllDrives=true`
    : `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  console.log("saved", meta.name, "->", outPath, buf.length, "bytes");
}

async function search(q) {
  const params = new URLSearchParams({
    q,
    pageSize: "20",
    fields: "files(id,name,mimeType)",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    corpora: "drive",
    driveId: SHARED,
    orderBy: "modifiedTime desc",
  });
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  return data.files ?? [];
}

for (const [k, id] of Object.entries({
  template_maj: "1iE3sfRF-oyGXp11BO9Uxn7xH-f--Oxo2",
  template_bis: "1m8CPUe6r6qLRnkBEQGheY1E0RMhiKm5V",
  template_old: "1UZUQ3bP_iMpHzIgWQLan3UFBoMNVBbH3",
})) {
  await download(id, join(dir, `${k}.xlsx`));
}

const sampleQueries = [
  ["webyn", "name contains 'Webyn' and name contains 'Business Plan'"],
  ["incom", "name contains 'Incom' and name contains 'Business Plan'"],
  ["mendo", "name contains 'Mendo' and name contains 'BP'"],
  ["supply", "name contains 'Supply Finder' and name contains 'BP'"],
  ["hermine", "name contains 'HermineIA' and name contains 'BP'"],
  ["yuccan", "name contains 'Yuccan' and name contains 'BP'"],
  ["alasuite", "name contains 'Alasuite' and name contains 'BP'"],
  ["kowl", "name contains 'Kowl' and name contains 'Business Plan'"],
  ["casawatt", "name contains 'Casawatt' and name contains 'Business plan'"],
  ["umamy", "name contains 'Umamy' and name contains 'BP'"],
  ["wenabi", "name contains 'wenabi' and name contains 'BP Financier V2 - TOMCAT'"],
  ["meteoria", "name contains 'Meteoria BP TOMCAT'"],
  ["eswit", "name contains 'eSwit BP' and name contains 'Tomcat'"],
  ["praiz", "name contains 'Praiz' and name contains 'BP Tomcat'"],
  ["supply_tomcat", "name contains 'Supply Finder - Tomcat'"],
  ["nova", "name contains 'Nova_BP'"],
  ["oscar", "name contains 'OSCAR' and name contains 'BP'"],
];

for (const [key, q] of sampleQueries) {
  const files = await search(q);
  if (!files.length) {
    console.log("MISSING", key);
    continue;
  }
  const f = files[0];
  console.log("PICK", key, f.name, f.id);
  await download(f.id, join(dir, `${key}.xlsx`));
}
