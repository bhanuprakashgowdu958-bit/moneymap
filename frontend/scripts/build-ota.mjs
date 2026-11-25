import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { computeWebBuildMeta } from './otaMeta.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, '..');
const distDir = path.join(frontendDir, 'dist');

const BUNDLE_FILENAME = 'ota-bundle.zip';
const MANIFEST_FILENAME = 'ota-version.json';
const EXCLUDED_FILES = new Set([BUNDLE_FILENAME, MANIFEST_FILENAME]);

function addDirToZip(zip, dirPath, rootDir) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const abs = path.join(dirPath, entry.name);
    const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      addDirToZip(zip, abs, rootDir);
    } else if (entry.isFile() && !EXCLUDED_FILES.has(rel)) {
      zip.file(rel, fs.readFileSync(abs));
    }
  }
}

async function main() {
  if (!fs.existsSync(distDir)) {
    throw new Error('dist directory does not exist. Run vite build first.');
  }

  const meta = computeWebBuildMeta(frontendDir);
  const baseUrl = (
    process.env.OTA_BASE_URL ||
    process.env.VITE_API_BASE_URL ||
    'https://moneymap-pl9w.vercel.app'
  ).replace(/\/+$/, '');
  const apkUrl =
    process.env.OTA_APK_URL ||
    'https://github.com/bhanuprakashgowdu958-bit/moneymap/releases/latest/download/MoneyMap.apk';

  const zip = new JSZip();
  addDirToZip(zip, distDir, distDir);

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  const checksum = crypto.createHash('sha256').update(zipBuffer).digest('hex');

  const bundlePath = path.join(distDir, BUNDLE_FILENAME);
  fs.writeFileSync(bundlePath, zipBuffer);

  const manifest = {
    version: meta.version,
    buildTime: meta.buildTime,
    minNativeVersion: meta.minNativeVersion,
    url: `${baseUrl}/${BUNDLE_FILENAME}`,
    checksum,
    apkUrl,
    notes: process.env.OTA_NOTES || 'Latest improvements and bug fixes are ready.',
    forceUpdate: process.env.OTA_FORCE_UPDATE === 'true',
  };

  const manifestPath = path.join(distDir, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const sizeKb = (zipBuffer.length / 1024).toFixed(1);
  console.log(`✅ OTA bundle ready: ${meta.version} (${sizeKb} KB) -> dist/${BUNDLE_FILENAME} + dist/${MANIFEST_FILENAME}`);
}

main().catch((err) => {
  console.error('❌ Failed to generate OTA bundle:', err);
  process.exit(1);
});
