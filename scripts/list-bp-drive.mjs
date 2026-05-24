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
  "name contains 'BP' and trashed = false and mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
  80,
);
console.log("xlsx BP count", bps.length);
const candidates = bps.filter(
  (f) => !/template|old bp|analysis|synth/i.test(f.name),
);
console.log("non-template candidates", candidates.length);
for (const f of candidates.slice(0, 30)) {
  console.log(f.modifiedTime?.slice(0, 10), f.name, f.id);
}

const wenabi = await search("name contains 'Wenabi' and name contains 'BP'");
console.log("\nWenabi BP hits:", wenabi.length);
for (const f of wenabi.slice(0, 5)) console.log(" -", f.name, f.id);

const tomcatBp = await search("name contains 'Tomcat BP'");
console.log("\nTomcat BP hits:", tomcatBp.length);
for (const f of tomcatBp.slice(0, 10)) console.log(" -", f.name, f.id);
