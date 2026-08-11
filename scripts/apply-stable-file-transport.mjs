import { readFile, writeFile } from 'node:fs/promises';

function replaceBetween(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`markers not found: ${startMarker} -> ${endMarker}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

let app = await readFile('public/app.js', 'utf8');
app = replaceBetween(app, 'function parseSseBlock', '\nasync function postFileAnalysis', '');
if (/function parseSseBlock|function handleAnalysisStreamEvent|function readAnalysisStream|postFileAnalysisStream|analyze-file\?stream=1/.test(app)) {
  throw new Error('dead SSE helper remains in browser bundle');
}
await writeFile('public/app.js', app);

let flow = await readFile('tests/ui/flow.test.js', 'utf8');
if (!flow.includes("browser bundle no longer contains file-analysis SSE parser helpers")) {
  flow += `\n\ntest('browser bundle no longer contains file-analysis SSE parser helpers', () => {\n  assert.doesNotMatch(js, /function parseSseBlock/);\n  assert.doesNotMatch(js, /function readAnalysisStream/);\n  assert.doesNotMatch(js, /postFileAnalysisStream/);\n});\n`;
}
await writeFile('tests/ui/flow.test.js', flow);
