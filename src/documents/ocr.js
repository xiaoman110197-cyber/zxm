export function createReusableImageOcr({ createWorker: injectedCreateWorker } = {}) {
  let workerPromise = null;
  let activeProgress = null;
  let queue = Promise.resolve();

  async function loadCreateWorker() {
    if (injectedCreateWorker) return injectedCreateWorker;
    const module = await import('tesseract.js');
    return module.createWorker;
  }

  async function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        const createWorker = await loadCreateWorker();
        return createWorker(['chi_sim','eng'], 1, {
          logger: (message) => activeProgress?.(message)
        });
      })().catch((error) => {
        workerPromise = null;
        throw error;
      });
    }
    return workerPromise;
  }

  async function discardWorker() {
    const pending = workerPromise;
    workerPromise = null;
    if (!pending) return;
    try {
      const worker = await pending;
      await worker.terminate?.();
    } catch {
      // A failed worker is already unusable; ignore cleanup errors.
    }
  }

  function recognize(buffer, reportProgress) {
    const run = queue.then(async () => {
      activeProgress = reportProgress;
      try {
        const worker = await getWorker();
        const result = await worker.recognize(buffer);
        return {
          text:String(result.data?.text || '').trim(),
          confidence:Math.max(0, Math.min(1, Number(result.data?.confidence || 0) / 100))
        };
      } catch (error) {
        await discardWorker();
        throw error;
      } finally {
        activeProgress = null;
      }
    });

    queue = run.catch(() => {});
    return run;
  }

  recognize.reset = discardWorker;
  return recognize;
}

export const defaultImageOcr = createReusableImageOcr();
