import { existsSync, lstatSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const buildRoot = resolve(projectRoot, 'static', 'builds');
const buildId = process.env.APP_BUILD_ID || process.env.BUILD_ID || 'local';

if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(buildId)) {
  throw new Error(`Invalid APP_BUILD_ID/BUILD_ID: ${JSON.stringify(buildId)}`);
}

const requestedOutDir = process.env.BUILD_OUTPUT_DIR
  ? resolve(projectRoot, process.env.BUILD_OUTPUT_DIR)
  : resolve(buildRoot, buildId);
const relativeOutDir = relative(buildRoot, requestedOutDir);
const outputDirectoryName = relativeOutDir.split(sep).at(-1);

if (
  !relativeOutDir
  || relativeOutDir === '..'
  || relativeOutDir.startsWith(`..${sep}`)
  || resolve(buildRoot, relativeOutDir) !== requestedOutDir
) {
  throw new Error('BUILD_OUTPUT_DIR must be a child of static/builds.');
}
if (
  relativeOutDir.includes(sep)
  || outputDirectoryName === 'current'
  || !outputDirectoryName.includes(buildId)
) {
  throw new Error('BUILD_OUTPUT_DIR must be a direct, build-ID-specific release directory.');
}
if (existsSync(requestedOutDir) && lstatSync(requestedOutDir).isSymbolicLink()) {
  throw new Error('BUILD_OUTPUT_DIR must not be a symlink.');
}

function guardPdfJsFromInitialBundles() {
  return {
    name: 'guard-pdfjs-from-initial-bundles',
    generateBundle(_options, bundle) {
      const chunks = new Map(
        Object.values(bundle)
          .filter((item) => item.type === 'chunk')
          .map((chunk) => [chunk.fileName, chunk]),
      );
      const pending = [...chunks.values()].filter((chunk) => chunk.isEntry);
      const initialFiles = new Set();

      while (pending.length > 0) {
        const chunk = pending.pop();
        if (!chunk || initialFiles.has(chunk.fileName)) continue;
        initialFiles.add(chunk.fileName);

        for (const moduleId of Object.keys(chunk.modules)) {
          const normalizedId = moduleId.replaceAll('\\', '/').toLowerCase();
          if (normalizedId.includes('/static/pdfjs/')) {
            throw new Error(
              `PDF.js entered an initial bundle (${chunk.fileName} via ${moduleId}).`,
            );
          }
        }

        for (const importedFile of chunk.imports) {
          const importedChunk = chunks.get(importedFile);
          if (importedChunk) pending.push(importedChunk);
        }
      }

      this.emitFile({
        type: 'asset',
        fileName: 'build-meta.json',
        source: `${JSON.stringify({
          buildId,
          base: `/static/builds/${buildId}/`,
          initialFiles: [...initialFiles].sort(),
        }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  root: projectRoot,
  base: `/static/builds/${buildId}/`,
  publicDir: false,
  plugins: [guardPdfJsFromInitialBundles()],
  build: {
    outDir: requestedOutDir,
    emptyOutDir: true,
    sourcemap: false,
    manifest: true,
    copyPublicDir: false,
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        index: resolve(projectRoot, 'index.html'),
        admin: resolve(projectRoot, 'admin.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
