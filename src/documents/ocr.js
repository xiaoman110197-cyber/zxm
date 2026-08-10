import { createRequire } from 'node:module';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const DEFAULT_TESSDATA_DIR = process.env.TESSERACT_CACHE_PATH || '/tmp/zhenduan-tessdata';
const DEFAULT_WORKER_INIT_TIMEOUT_MS = 20_000;
const DEFAULT_NODE_WORKER_PATH = require.resolve('tesseract.js/src/worker-script/node/index.js');
const DEFAULT_CORE_PATH = path.dirname(require.resolve('tesseract.js-core'));
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

function workerInitTimeoutError(timeoutMs) {
  const error = new Error(`OCR worker 初始化超时 (${timeoutMs}ms)`);
  error.code = 'OCR_INIT_TIMEOUT';
  return error;
}

async function createWorkerWithTimeout(createWorker, options, timeoutMs) {
  const workerPromise = Promise.resolve().then(() => createWorker('chi_sim', 1, options));
  let timer;
  let timedOut = false;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(workerInitTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([workerPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      workerPromise
        .then(async (lateWorker) => {
          try { await lateWorker?.terminate?.(); } catch {}
        })
        .catch(() => {});
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createBundledImageOcr({
  createWorker: injectedCreateWorker,
  prepareTessdata = prepareBundledTessdata,
  workerInitTimeoutMs = DEFAULT_WORKER_INIT_TIMEOUT_MS,
  workerPath = DEFAULT_NODE_WORKER_PATH,
  corePath = DEFAULT_CORE_PATH
} = {}) {
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
      worker = await createWorkerWithTimeout(createWorker, {
        workerPath,
        corePath,
        langPath:tessdataDir,
        cachePath:tessdataDir,
        gzip:true,
        logger:(message) => reportProgress?.(message)
      }, workerInitTimeoutMs);
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
