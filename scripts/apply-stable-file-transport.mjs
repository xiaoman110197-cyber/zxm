import { readFile, writeFile } from 'node:fs/promises';

function replaceBetween(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`markers not found: ${startMarker} -> ${endMarker}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

let app = await readFile('public/app.js', 'utf8');

app = replaceBetween(
  app,
  'async function postFileAnalysisStream',
  '\nfunction correctionDecisionEvidence',
  `async function postFileAnalysis(file, contentBase64, { signal } = {}) {\n  let response;\n  try {\n    response = await fetch('/api/analyze-file', {\n      method:'POST',\n      headers:{ 'Content-Type':'application/json' },\n      body:JSON.stringify({ file:{ name:file.name, contentBase64 } }),\n      signal\n    });\n  } catch (cause) {\n    if (signal?.aborted || cause?.name === 'AbortError') throw cause;\n    const error = new Error('分析请求没有正常连接到服务器。请保持页面打开并重试。');\n    error.code = 'FILE_TRANSPORT_FAILED';\n    throw error;\n  }\n\n  const data = await response.json().catch(() => ({}));\n  if (!response.ok) {\n    const error = new Error(data.error || \`文件分析请求失败 (\${response.status})\`);\n    error.requestId = data.requestId || '';\n    error.status = response.status;\n    throw error;\n  }\n  return data;\n}\n`
);

app = replaceBetween(
  app,
  'async function analyzeBusinessFile',
  '\nfunction base64ToBlob',
  `async function analyzeBusinessFile(file) {\n  if (!file || state.fileAnalysisController) return;\n  const capturedDiagnosisId = state.diagnosis.id;\n  const previousDocument = state.diagnosis.documents[0] || null;\n  clearPendingFileReview();\n  state.pendingFile = file;\n  $('file-errors').textContent = '';\n  if (!isImageFile(file) && file.size > MAX_FILE_BYTES) {\n    state.pendingFile = null;\n    $('file-progress').hidden = true;\n    $('file-errors').textContent = \`文件过大：当前版本单个文件最大支持 3 MB。\${previousDocument ? ' 此前成功分析的资料仍保留。' : ''}\`;\n    return;\n  }\n  const controller = new AbortController();\n  state.fileAnalysisController = controller;\n  $('workbook').disabled = true;\n  $('file-status').textContent = previousDocument ? '正在分析新资料；此前成功分析的资料会保留到新结果确认后再替换。' : '';\n  setFileProgress(2, isImageFile(file) ? '正在优化图片' : '正在读取文件', { reset:true });\n  setFileProgressActions({ analyzing:true, retry:false });\n  startFileElapsedTimer();\n  try {\n    const transportFile = isImageFile(file) ? await optimizeImageForOcr(file, { signal:controller.signal }) : file;\n    if (transportFile.size > MAX_FILE_BYTES) throw new Error('优化后的文件仍超过 3 MB，请先裁剪或压缩后再上传');\n    if (transportFile !== file) setFileProgress(6, '图片已优化，正在读取');\n    const contentBase64 = await fileToBase64(transportFile, {\n      signal:controller.signal,\n      onProgress:(fraction) => setFileProgress(2 + fraction * 6, transportFile !== file ? '正在读取优化后的图片' : '正在读取文件')\n    });\n    setFileProgress(8, '正在上传资料');\n    setFileProgress(15, '正在分析报表，请保持页面打开');\n    const result = await postFileAnalysis(transportFile, contentBase64, { signal:controller.signal });\n    if (controller.signal.aborted || state.diagnosis.id !== capturedDiagnosisId) return;\n    applySuccessfulFileAnalysis(file, contentBase64, result);\n    state.pendingFile = null;\n    const reportSummary = result.reportReview?.summary || null;\n    const completionMessage = result.document?.type === 'image'\n      ? (reportSummary?.recognitionMode === 'ocr_unavailable'\n          ? '报表识别未完成，请重新上传'\n          : reportSummary?.completeReview === true\n            ? '报表检查完成，等待确认'\n            : '报表检查未完成，等待核对')\n      : (requiresFileReview(result) ? '报表检查完成，等待确认' : '分析完成');\n    setFileProgress(100, completionMessage);\n    setFileProgressActions({ analyzing:false, retry:false });\n  } catch (error) {\n    if (state.diagnosis.id !== capturedDiagnosisId) return;\n    const cancelled = error?.name === 'AbortError';\n    let baseMessage;\n    if (cancelled) baseMessage = '已取消分析。';\n    else if (error.code === 'FILE_TRANSPORT_FAILED') baseMessage = \`\${error.message}（错误类型：FILE_TRANSPORT_FAILED）\`;\n    else if (error.status === 429) baseMessage = errorWithRequestId('文件分析请求较频繁，请稍后再试。', error.requestId);\n    else baseMessage = errorWithRequestId(\`文件分析失败：\${error.message}\`, error.requestId);\n    $('file-errors').textContent = \`\${baseMessage}\${previousDocument ? ' 此前成功分析的资料仍保留。' : ''}\`;\n    $('file-progress-message').textContent = cancelled ? '分析已取消，可重新分析' : '分析已中断，可重新分析';\n    setFileProgressActions({ analyzing:false, retry:Boolean(state.pendingFile) });\n  } finally {\n    if (state.fileAnalysisController === controller) {\n      stopFileElapsedTimer();\n      renderFileElapsed();\n      $('workbook').disabled = false;\n      state.fileAnalysisController = null;\n    }\n  }\n}\n`
);

app = replaceBetween(
  app,
  'function retryPendingFile',
  '\nrestoreSession();',
  `function retryPendingFile() {\n  if (!state.pendingFile || state.fileAnalysisController) return;\n  analyzeBusinessFile(state.pendingFile);\n}\n\n$('send').addEventListener('click', sendDiagnosis);\n$('retry-diagnosis').addEventListener('click', () => { if (state.pendingDiagnosisRequest) requestDiagnosis(); });\n$('new-diagnosis').addEventListener('click', resetDiagnosisExperience);\n$('owner-input').addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') sendDiagnosis(); });\n$('workbook').addEventListener('change', (event) => {\n  const file = event.target.files?.[0];\n  if (file) analyzeBusinessFile(file);\n});\n$('cancel-file').addEventListener('click', () => { state.fileAnalysisController?.abort(); });\n$('retry-file').addEventListener('click', () => { retryPendingFile(); });\n$('file-review-corrections').addEventListener('click', (event) => {\n  const button = event.target.closest?.('[data-correction-choice]');\n  if (!button) return;\n  const index = Number(button.dataset.correctionIndex);\n  if (Number.isInteger(index)) chooseCorrection(index, button.dataset.correctionChoice);\n});\n$('confirm-file').addEventListener('click', confirmPendingFileReview);\n$('replace-file').addEventListener('click', replacePendingFileReview);\n$('download-excel').addEventListener('click', downloadReport);\n`
);

await writeFile('public/app.js', app);

let flow = await readFile('tests/ui/flow.test.js', 'utf8');
flow = flow.replace(
`test('switching the page to the background pauses a long file request and automatically retries once on return', () => {\n  assert.match(js, /visibilitychange/);\n  assert.match(js, /visibilityState/);\n  assert.match(js, /fileResumeAfterBackground/);\n  assert.match(js, /fileBackgroundRetryCount/);\n  assert.match(js, /自动重新分析|自动重试/);\n});`,
`test('file analysis does not promise automatic background continuation', () => {\n  assert.match(js, /正在分析报表，请保持页面打开/);\n  assert.doesNotMatch(js, /自动重新分析|自动重试|返回本页面后会自动/);\n});`
);
flow = flow.replace(
`test('file analysis exposes live percent stage elapsed time cancel and retry', () => {\n  assert.match(html, /id="file-progress"/);\n  assert.match(html, /role="progressbar"/);\n  assert.match(html, /id="file-progress-percent"/);\n  assert.match(html, /id="file-progress-message"/);\n  assert.match(html, /id="file-progress-elapsed"/);\n  assert.match(html, /id="cancel-file"/);\n  assert.match(html, /id="retry-file"/);\n  assert.match(js, /analyze-file\\?stream=1/);\n  assert.match(js, /getReader\\(\\)/);\n  assert.match(js, /AbortController/);\n  assert.match(js, /pendingFile/);\n  assert.match(css, /progress-track/);\n  assert.match(css, /progress-bar/);\n});`,
`test('file analysis exposes coarse stage elapsed time cancel and retry without SSE transport', () => {\n  assert.match(html, /id="file-progress"/);\n  assert.match(html, /role="progressbar"/);\n  assert.match(html, /id="file-progress-message"/);\n  assert.match(html, /id="file-progress-elapsed"/);\n  assert.match(html, /id="cancel-file"/);\n  assert.match(html, /id="retry-file"/);\n  assert.match(js, /fetch\\(['"]\\/api\\/analyze-file['"]/);\n  assert.doesNotMatch(js, /analyze-file\\?stream=1/);\n  assert.match(js, /AbortController/);\n  assert.match(js, /pendingFile/);\n  assert.match(css, /progress-track/);\n  assert.match(css, /progress-bar/);\n});`
);
if (flow.includes("switching the page to the background pauses a long file request")) throw new Error('old background retry test was not replaced');
if (flow.includes("file analysis exposes live percent stage elapsed time cancel and retry")) throw new Error('old SSE progress test was not replaced');
await writeFile('tests/ui/flow.test.js', flow);
