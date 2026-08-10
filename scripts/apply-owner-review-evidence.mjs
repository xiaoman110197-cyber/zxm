import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../public/app.js', import.meta.url);
let source = await readFile(path, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`patch target not found: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`function commitSuccessfulFileAnalysis(file, contentBase64, result) {
  if (result.document.type === 'excel') {
    state.originalFile = file;
    state.originalBase64 = contentBase64;
  } else {
    state.originalFile = null;
    state.originalBase64 = '';
  }

  state.audit = result.audit;
  state.diagnosis.documents = [result.document];
  state.diagnosis.evidence = state.diagnosis.evidence.filter((item) => !(typeof item === 'string' && item.startsWith('file_analysis:')));
  state.diagnosis.evidence.push(\`file_analysis:\${JSON.stringify(result.summary)}\`);
  $('file-status').textContent = fileStatusText(result);
  $('file-errors').textContent = '';
  updateDownloadState();
  saveSession();
}`,
`function correctionDecisionEvidence(pending) {
  const corrections = (pending?.result?.corrections || []).filter((item) => item.kind === 'calculation_error');
  return corrections.map((correction, index) => {
    const choice = pending.correctionDecisions[index];
    const decision = choice === 'accept' ? 'accepted' : 'kept_original';
    return \`correction_decision:\${JSON.stringify({
      label:correction.label,
      originalValue:correction.originalValue,
      correctedValue:correction.correctedValue,
      decision,
      explanation:correction.explanation || ''
    })}\`;
  });
}

function unresolvedReviewEvidence(result) {
  return (result?.corrections || [])
    .filter((item) => item.kind !== 'calculation_error')
    .map((item) => \`file_review:\${JSON.stringify({
      kind:item.kind,
      label:item.label,
      originalValue:item.originalValue,
      explanation:item.explanation || '',
      evidence:Array.isArray(item.evidence) ? item.evidence : []
    })}\`);
}

function commitSuccessfulFileAnalysis(file, contentBase64, result, reviewEvidence = []) {
  if (result.document.type === 'excel') {
    state.originalFile = file;
    state.originalBase64 = contentBase64;
  } else {
    state.originalFile = null;
    state.originalBase64 = '';
  }

  state.audit = result.audit;
  state.diagnosis.documents = [result.document];
  state.diagnosis.evidence = state.diagnosis.evidence.filter((item) => !(typeof item === 'string' && (
    item.startsWith('file_analysis:') ||
    item.startsWith('correction_decision:') ||
    item.startsWith('file_review:')
  )));
  state.diagnosis.evidence.push(\`file_analysis:\${JSON.stringify(result.summary)}\`, ...reviewEvidence);
  $('file-status').textContent = fileStatusText(result);
  $('file-errors').textContent = '';
  updateDownloadState();
  saveSession();
}`,
'commit evidence'
);

replaceOnce(
`function confirmPendingFileReview() {
  const pending = state.pendingFileReview;
  if (!pending || $('confirm-file').disabled) return;
  state.pendingFileReview = null;
  hideFileReview();
  commitSuccessfulFileAnalysis(pending.file, pending.contentBase64, pending.result);
  $('file-status').textContent = \`\${fileStatusText(pending.result)} 已确认资料检查结果。\`;
}`,
`function confirmPendingFileReview() {
  const pending = state.pendingFileReview;
  if (!pending || $('confirm-file').disabled) return;
  const reviewEvidence = [
    ...correctionDecisionEvidence(pending),
    ...unresolvedReviewEvidence(pending.result)
  ];
  state.pendingFileReview = null;
  hideFileReview();
  commitSuccessfulFileAnalysis(pending.file, pending.contentBase64, pending.result, reviewEvidence);
  $('file-status').textContent = \`\${fileStatusText(pending.result)} 已确认资料检查结果。\`;
}`,
'confirm evidence'
);

replaceOnce(
`  pending.correctionDecisions[index] = choice;
  const card = $(\`file-review-correction-\${index}\`);
  void card;
  for (const button of document.querySelectorAll(\`[data-correction-index="\${index}"]\`)) {`,
`  pending.correctionDecisions[index] = choice;
  for (const button of document.querySelectorAll(\`[data-correction-index="\${index}"]\`)) {`,
'cleanup correction choice'
);

replaceOnce(
`  state.diagnosis.evidence = state.diagnosis.evidence.filter((item) => !(typeof item === 'string' && item.startsWith('file_analysis:')));
  updateDownloadState();`,
`  state.diagnosis.evidence = state.diagnosis.evidence.filter((item) => !(typeof item === 'string' && (
    item.startsWith('file_analysis:') ||
    item.startsWith('correction_decision:') ||
    item.startsWith('file_review:')
  )));
  updateDownloadState();`,
'reset file evidence'
);

await writeFile(path, source);
console.log('public/app.js patched successfully');
