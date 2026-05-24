/**
 * Extract canonical BP template structure from Drive xlsx into repo artifacts.
 *
 * Outputs:
 *   src/playbooks/bp/template-spec.md
 *   src/playbooks/bp/template-schema.ts
 *
 * Usage:
 *   npm run extract:bp-template
 *   node scripts/extract-bp-template-spec.mjs --local /tmp/bp-study/template_maj.xlsx
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { GoogleAuth } from "google-auth-library";
import { DRIVE_FILE_ID } from "./lib/bpTemplateCatalog.mjs";
import {
  analyzeWorkbookBuffer,
  renderSchema,
  renderSpec,
} from "./lib/bpTemplateExtract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "src/playbooks/bp");
const SPEC_PATH = join(OUT_DIR, "template-spec.md");
const SCHEMA_PATH = join(OUT_DIR, "template-schema.ts");

const SHARED_DRIVE_ID = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID ?? "0AO2MAh9ncUDNUk9PVA";
const CREDS_PATH =
  process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE ??
  join(ROOT, ".secrets/tomcat-ai-backend-71e0e34e307f.json");

function parseArgs(argv) {
  const localIdx = argv.indexOf("--local");
  return {
    localPath: localIdx >= 0 ? argv[localIdx + 1] : undefined,
    dryRun: argv.includes("--dry-run"),
  };
}

async function getDriveMeta() {
  const creds = JSON.parse(readFileSync(CREDS_PATH, "utf8"));
  const auth = new GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const token = await auth.getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?fields=id,name,mimeType&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`Drive metadata failed (${res.status}): ${await res.text()}`);
  }
  return { token, meta: await res.json() };
}

async function downloadTemplate() {
  const { token, meta } = await getDriveMeta();
  const isGSheet = meta.mimeType === "application/vnd.google-apps.spreadsheet";
  const url = isGSheet
    ? `https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}&supportsAllDrives=true`
    : `https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Drive download failed (${res.status}): ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const { localPath, dryRun } = parseArgs(process.argv.slice(2));
  let buffer;
  if (localPath) {
    if (!existsSync(localPath)) {
      throw new Error(`Local file not found: ${localPath}`);
    }
    buffer = readFileSync(localPath);
    console.log("Using local file:", localPath);
  } else {
    console.log("Downloading template from Drive:", DRIVE_FILE_ID);
    buffer = await downloadTemplate();
  }

  const spec = analyzeWorkbookBuffer(buffer, SHARED_DRIVE_ID);
  const md = renderSpec(spec);
  const ts = renderSchema(spec);

  if (dryRun) {
    console.log("Dry run OK — tabs:", spec.tabCount, "sha256:", spec.source.contentSha256.slice(0, 12));
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(SPEC_PATH, md, "utf8");
  writeFileSync(SCHEMA_PATH, ts, "utf8");
  console.log("Wrote", SPEC_PATH);
  console.log("Wrote", SCHEMA_PATH);
  console.log("Tabs extracted:", spec.tabCount);
  console.log("SHA256:", spec.source.contentSha256);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
