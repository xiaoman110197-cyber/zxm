import { createRequire } from 'node:module';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const DEFAULT_TESSDATA_DIR = process.env.TESSERACT_CACHE_PATH || '/tmp/zhenduan-tessdata';
let bundledTessdataPromise = null;

function bundledLanguageSource() {
  return require.resolve('@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz');
}

export async function prepareBundledTessdata(targetDir = DEFAULT_TESSDATA_DIR) {
  if (targetDir === DEFAULT_TESSDATA_DIR && bundledTessdataPromise) return bundledTessdataPromise;

  const prepare = async () => {
    await mkdir(targetDir, { recursive:true });
    const source = bundledLanguageSource();
    const destination = path.join(targetDir, 'chi_sim.traineddata.gz');
    await copyFile(source, destination);
    return targetDir;
  };

  if (targetDir !== DEFAULT_TESSDATA_DIR) return prepare();
  bundledTessdataPromise = prepare().catch((error) => {
    bundledTessdataPromise = null;
    throw error;
  });
  return bundledTessdataPromise;
}

export function createBundledImageOcr({ createWorker: injectedCreateWorker, prepareTessdata = prepareBundledTessdata } = {}) {
  async function loadCreateWorker() {
    if (injectedCreateWorker) return injectedCreateWorker;
    const module = await import('tesseract.js');
    return module.createWorker;
  }

  return async function recognize(buffer, reportProgress) {
    const [createWorker, tessdataDir] = await Promise.all([
      loadCreateWorker(),
      prepareTessdata()
    ]);
    let worker;
    try {
      worker = await createWorker('chi_sim', 1, {
        langPath:tessdataDir,
        cachePath:tessdataDir,
        gzip:true,
        logger:(message) => reportProgress?.(message)
      });
      const result = await worker.recognize(buffer);
      return {
        text:String(result.data?.text || '').trim(),
        confidence:Math.max(0, Math.min(1, Number(result.data?.confidence || 0) / 100))
      };
    } finally {
      if (worker) {
        try {
          await worker.terminate?.();
        } catch {
          // Recognition result/error is more important than cleanup failure.
        }
      }
    }
  };
}

export const defaultImageOcr = createBundledImageOcr();
