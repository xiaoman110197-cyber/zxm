export function createCachedImageOcr({ createWorker: injectedCreateWorker, cachePath = process.env.TESSERACT_CACHE_PATH || '/tmp' } = {}) {
  async function loadCreateWorker() {
    if (injectedCreateWorker) return injectedCreateWorker;
    const module = await import('tesseract.js');
    return module.createWorker;
  }

  return async function recognize(buffer, reportProgress) {
    const createWorker = await loadCreateWorker();
    let worker;
    try {
      worker = await createWorker(['chi_sim','eng'], 1, {
        cachePath,
        logger: (message) => reportProgress?.(message)
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

export const defaultImageOcr = createCachedImageOcr();
