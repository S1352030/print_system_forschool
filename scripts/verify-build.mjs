import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
  gunzipSync,
} from 'node:zlib';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = resolve(projectRoot, 'static', 'builds');
const buildId = process.env.APP_BUILD_ID || process.env.BUILD_ID || 'local';
const buildDir = process.env.BUILD_OUTPUT_DIR
  ? resolve(projectRoot, process.env.BUILD_OUTPUT_DIR)
  : resolve(buildRoot, buildId);
const basePath = `/static/builds/${buildId}/`;
const maxInitialRequests = 4;
const maxInitialBrotliBytes = 100 * 1024;
const errors = [];

const relativeBuildDir = relative(buildRoot, buildDir);
if (
  !relativeBuildDir
  || relativeBuildDir === '..'
  || relativeBuildDir.startsWith(`..${sep}`)
) {
  throw new Error('Build verification target must be a child of static/builds.');
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function stripQueryAndHash(url) {
  return url.split('#', 1)[0].split('?', 1)[0];
}

function localAssetPath(url) {
  const cleanUrl = stripQueryAndHash(url);
  if (!cleanUrl.startsWith(basePath)) return null;
  const relativeAsset = decodeURIComponent(cleanUrl.slice(basePath.length));
  const candidate = resolve(buildDir, relativeAsset);
  const relativeCandidate = relative(buildDir, candidate);
  if (
    !relativeCandidate
    || relativeCandidate === '..'
    || relativeCandidate.startsWith(`..${sep}`)
  ) {
    errors.push(`Asset URL escapes build directory: ${url}`);
    return null;
  }
  return candidate;
}

function extractReferences(html) {
  const references = [];
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
    const url = match[1];
    if (
      !url
      || url.startsWith('#')
      || url.startsWith('data:')
      || url.startsWith('blob:')
      || url.startsWith('mailto:')
    ) {
      continue;
    }
    references.push(url);
  }
  return references;
}

function estimateBrotliSize(filePath) {
  const sidecar = `${filePath}.br`;
  if (existsSync(sidecar)) return statSync(sidecar).size;
  return brotliCompressSync(readFileSync(filePath), {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  }).length;
}

for (const htmlName of ['index.html', 'admin.html']) {
  const htmlPath = resolve(buildDir, htmlName);
  if (!existsSync(htmlPath)) {
    errors.push(`Missing generated ${htmlName}`);
    continue;
  }

  const html = readFileSync(htmlPath, 'utf8');
  if (/fonts\.(?:googleapis|gstatic)\.com/i.test(html)) {
    errors.push(`${htmlName} still references Google Fonts.`);
  }

  for (const reference of extractReferences(html)) {
    const cleanReference = stripQueryAndHash(reference);
    const isJavaScriptOrCss = /\.(?:m?js|css)$/i.test(cleanReference);
    const assetPath = localAssetPath(reference);

    if (assetPath) {
      if (!existsSync(assetPath) || !statSync(assetPath).isFile()) {
        errors.push(`${htmlName} references a missing asset: ${reference}`);
      }
    } else if (isJavaScriptOrCss && !/^https?:\/\//i.test(reference)) {
      errors.push(`${htmlName} has an unhashed/out-of-release asset: ${reference}`);
    }
  }
}

const indexPath = resolve(buildDir, 'index.html');
if (existsSync(indexPath)) {
  const indexHtml = readFileSync(indexPath, 'utf8');
  const initialAssets = [...new Set(
    extractReferences(indexHtml)
      .map(stripQueryAndHash)
      .filter((url) => /\.(?:m?js|css)$/i.test(url)),
  )];

  if (initialAssets.length > maxInitialRequests) {
    errors.push(
      `index.html has ${initialAssets.length} initial JS/CSS requests; maximum is ${maxInitialRequests}.`,
    );
  }

  let brotliBytes = 0;
  for (const assetUrl of initialAssets) {
    const assetPath = localAssetPath(assetUrl);
    if (!assetPath || !existsSync(assetPath)) continue;
    brotliBytes += estimateBrotliSize(assetPath);
  }

  if (brotliBytes > maxInitialBrotliBytes) {
    errors.push(
      `Initial index JS/CSS Brotli size is ${brotliBytes} bytes; maximum is ${maxInitialBrotliBytes}.`,
    );
  }

  console.log(
    `Initial index assets: ${initialAssets.length} requests, ${brotliBytes} Brotli bytes.`,
  );
}

if (existsSync(buildDir)) {
  const files = walk(buildDir);
  const sourceMaps = files.filter((file) => file.toLowerCase().endsWith('.map'));
  if (sourceMaps.length > 0) {
    errors.push(`Source maps found: ${sourceMaps.map((file) => relative(buildDir, file)).join(', ')}`);
  }

  for (const file of files.filter((path) => /\.(?:m?js|css|html)$/i.test(path))) {
    const content = readFileSync(file, 'utf8');
    if (/fonts\.(?:googleapis|gstatic)\.com/i.test(content)) {
      errors.push(`Google Fonts reference found in ${relative(buildDir, file)}.`);
    }
    if (/sourceMappingURL\s*=/i.test(content)) {
      errors.push(`Source map reference found in ${relative(buildDir, file)}.`);
    }

    for (const extension of ['.br', '.gz']) {
      if (!existsSync(`${file}${extension}`)) {
        errors.push(`Missing ${extension} sidecar: ${relative(buildDir, file)}`);
      }
    }
  }

  for (const sidecar of files.filter((path) => /\.(?:br|gz)$/i.test(path))) {
    const source = sidecar.slice(0, -3);
    if (!existsSync(source) || !statSync(source).isFile()) {
      errors.push(`Orphan compressed sidecar: ${relative(buildDir, sidecar)}`);
      continue;
    }
    try {
      const compressed = readFileSync(sidecar);
      const decoded = sidecar.toLowerCase().endsWith('.br')
        ? brotliDecompressSync(compressed)
        : gunzipSync(compressed);
      if (!decoded.equals(readFileSync(source))) {
        errors.push(`Compressed sidecar content mismatch: ${relative(buildDir, sidecar)}`);
      }
    } catch (error) {
      errors.push(
        `Compressed sidecar cannot be decompressed: ${relative(buildDir, sidecar)} (${error.message})`,
      );
    }
  }
}

const metadataPath = resolve(buildDir, 'build-meta.json');
if (!existsSync(metadataPath)) {
  errors.push('Missing build-meta.json PDF.js guard metadata.');
} else {
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  if (metadata.buildId !== buildId || metadata.base !== basePath) {
    errors.push('build-meta.json does not match the requested build ID/base.');
  }
  const suspiciousInitialFile = (metadata.initialFiles || []).find((file) =>
    /(?:pdfjs|pdf\.worker|pdf\.min)/i.test(file),
  );
  if (suspiciousInitialFile) {
    errors.push(`PDF.js-like file is part of the initial graph: ${suspiciousInitialFile}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[verify-build] ${error}`);
  process.exit(1);
}

console.log(`Build verified: ${relative(projectRoot, buildDir)} (${buildId}).`);
