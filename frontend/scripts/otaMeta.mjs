import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.css', '.html', '.json', '.svg', '.md', '.txt',
]);

function collectFiles(targetPath, baseDir, out = []) {
  if (!fs.existsSync(targetPath)) return out;
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(targetPath).sort();
    for (const entry of entries) {
      collectFiles(path.join(targetPath, entry), baseDir, out);
    }
  } else if (stat.isFile()) {
    out.push({
      abs: targetPath,
      rel: path.relative(baseDir, targetPath).replace(/\\/g, '/'),
    });
  }
  return out;
}

function readGitCommitTimestamp(frontendDir) {
  try {
    const out = execSync('git log -1 --format=%ct', {
      cwd: frontendDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    const parsed = Number(out);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch {
    // Ignore
  }
  return 0;
}

/**
 * Computes deterministic build metadata for the web bundle so Vercel and
 * Capacitor APK builds from the same commit produce the exact same version.
 */
export function computeWebBuildMeta(frontendDir) {
  const hash = crypto.createHash('sha256');
  const targets = [
    'src',
    'public',
    'index.html',
    'package.json',
    'tailwind.config.js',
    'postcss.config.js',
    'vite.config.js',
  ];

  const files = [];
  for (const target of targets) {
    collectFiles(path.join(frontendDir, target), frontendDir, files);
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));

  for (const file of files) {
    hash.update(file.rel);
    hash.update('\0');
    const ext = path.extname(file.rel).toLowerCase();
    const raw = fs.readFileSync(file.abs);
    if (TEXT_EXTENSIONS.has(ext)) {
      hash.update(raw.toString('utf8').replace(/\r\n/g, '\n'));
    } else {
      hash.update(raw);
    }
    hash.update('\0');
  }

  const shortHash = hash.digest('hex').slice(0, 8);
  const buildTime = readGitCommitTimestamp(frontendDir);

  return {
    version: `1.0.${shortHash}`,
    buildTime,
    minNativeVersion: 13,
  };
}
