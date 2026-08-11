from pathlib import Path
import re

path = Path('public/app.js')
text = path.read_text()

status_block = r'''function fileStatusText(result) {
  const summary = result.summary || {};
  const type = fileTypeLabel(result.document?.type);
  const businessAnomalyText = summary.anomalyCount > 0 ? `程序识别到经营异常 ${summary.anomalyCount} 个` : '经营异常将在问诊中结合经营背景继续判断';
  if (result.document?.structured) return `已读取 ${type}：${summary.sheetCount || 0} 个表，${summary.rowCount || 0} 行数据；${businessAnomalyText}。资料已加入本次问诊。`;
  if (result.reportReview) {
    const mode = result.reportReview.summary?.recognitionMode;
    const complete = result.reportReview.summary?.completeReview === true;
    if (mode === 'local_ocr_degraded') return '报表已用降级识别读取。按你的确认加入本次问诊；未确认的数据不会作为确定事实。';
    if (!complete) return '报表检查未完整完成。仅已验证的内容会用于本次问诊。';
    return '已完成报表检查。资料已加入本次问诊。';
  }
  return `已读取 ${type}：提取 ${summary.textLength || 0} 个字符；${businessAnomalyText}。资料已加入本次问诊。`;
}

function imageReviewStatusText(result) {
  const summary = result.reportReview?.summary || {};
  if (summary.recognitionMode === 'ocr_unavailable') return '报表识别未完成。请重新上传更清晰的图片后再继续诊断。';
  if (summary.completeReview !== true) return '报表检查未完成。请先核对识别状态和关键数据，再决定是否用于经营诊断。';
  if (result.reportReview) return '报表已检查完成。请先看具体问题和依据，确认后再用于经营诊断。';
  return '资料已读取。请先确认识别内容，确认后再用于经营诊断。';
}
'''
text, count = re.subn(r"function fileStatusText\(result\) \{.*?\n\}\n\nfunction imageReviewStatusText\(result\) \{.*?\n\}\n", status_block, text, count=1, flags=re.S)
assert count == 1, 'status block not found'

review_block = r'''function renderReportReview(file, contentBase64, result) {
  const review = result.reportReview || { issues:[], summary:{} };
  const issues = Array.isArray(review.issues) ? review.issues : [];
  const confirmedIssues = issues.filter((item) => item.kind !== 'needs_confirmation');
  const confirmations = issues.filter((item) => item.kind === 'needs_confirmation');
  const recognitionMode = review.summary?.recognitionMode || 'ocr_unavailable';
  const completeReview = review.summary?.completeReview === true;
  state.pendingFileReview = { file, contentBase64, result, mode:'report', correctionDecisions:{} };

  if (recognitionMode === 'cloud_ocr_deepseek' && completeReview) $('file-review-confidence').textContent = '云端原图已读取并复算';
  else if (recognitionMode === 'local_ocr_degraded') $('file-review-confidence').textContent = '降级识别，关键数据需核对';
  else $('file-review-confidence').textContent = '报表识别或分析未完整完成';

  const lead = $('file-review-lead');
  lead.replaceChildren();
  const headline = document.createElement('strong');
  const problemCount = Number(review.summary?.problemCount) || confirmedIssues.length;
  const correctionCount = Number(review.summary?.provableCorrectionCount) || confirmedIssues.filter((item) => item.kind === 'calculation_error').length;
  const confirmationCount = Number(review.summary?.confirmationCount) || confirmations.length;
  if (recognitionMode === 'ocr_unavailable') {
    headline.textContent = '这张报表还没有可靠识别';
  } else if (problemCount) {
    headline.textContent = `发现 ${problemCount} 处报表问题${correctionCount ? `，其中 ${correctionCount} 处可以确定订正` : ''}`;
  } else if (!completeReview) {
    headline.textContent = '当前证据下没有发现可证明的错误，但本次识别或分析不完整，不能据此判断报表没有问题。';
  } else {
    headline.textContent = '暂未发现可以确定的报表错误';
  }
  lead.append(headline);
  if (confirmationCount) {
    const note = document.createElement('span');
    note.textContent = `另有 ${confirmationCount} 个关键数据需要核对，不会当成确定事实。`;
    lead.append(note);
  }

  const summary = $('file-review-summary');
  summary.replaceChildren();
  summary.append(summaryItem(`${problemCount} 处`, '发现的问题'));
  summary.append(summaryItem(`${correctionCount} 处`, '可以确定订正'));
  summary.append(summaryItem(`${confirmationCount} 个`, '关键数据待核对'));

  const problemList = $('file-review-corrections-list');
  problemList.replaceChildren();
  confirmedIssues.forEach((issue, index) => problemList.append(renderReportIssueCard(issue, index)));
  $('file-review-corrections').hidden = confirmedIssues.length === 0;

  const confirmationList = $('file-review-important-list');
  confirmationList.replaceChildren();
  confirmations.forEach((issue, index) => confirmationList.append(renderReportIssueCard(issue, index)));
  $('file-review-important').hidden = confirmations.length === 0;

  $('file-review-other').hidden = true;
  $('file-review-other').open = false;
  $('file-review-text').textContent = String(result.document?.text || '').trim() || '没有可展示的文字识别详情。';
  $('file-review-fulltext').hidden = !String(result.document?.text || '').trim();
  $('file-review-fulltext').open = false;

  if (review.summary?.reviewWarning) {
    $('file-review-warning').textContent = `${review.summary.reviewWarning}${completeReview ? '' : ' 本次结果不能视为完整报表检查。'}`;
  } else if (recognitionMode === 'ocr_unavailable') {
    $('file-review-warning').textContent = '请重新上传更清晰的图片；在可靠识别前，这份报表不会进入经营诊断。';
  } else if (confirmationCount) {
    $('file-review-warning').textContent = '待核对的数据不会作为确定事实；其余有明确依据的问题可以继续用于经营诊断。';
  } else if (!completeReview) {
    $('file-review-warning').textContent = '本次识别或分析不完整，不能把“0 个确定问题”理解为报表没有问题。';
  } else {
    $('file-review-warning').textContent = '只有程序能够复算或明确验证的内容，才会显示“正确结果”。';
  }
  $('confirm-file').disabled = recognitionMode === 'ocr_unavailable';
  $('file-review').hidden = false;
  $('file-errors').textContent = '';
  $('file-status').textContent = imageReviewStatusText(result);
}
'''
text, count = re.subn(r"function renderReportReview\(file, contentBase64, result\) \{.*?\n\}\n\nfunction plainAuditIssues", review_block + "\nfunction plainAuditIssues", text, count=1, flags=re.S)
assert count == 1, 'review block not found'

confirm_block = r'''function confirmPendingFileReview() {
  const pending = state.pendingFileReview;
  if (!pending) return;
  if (pending.mode === 'report' && pending.result.reportReview?.summary?.recognitionMode === 'ocr_unavailable') {
    $('confirm-file').disabled = true;
    $('file-review-warning').textContent = '这张报表还没有可靠识别，请重新上传更清晰的图片后再继续诊断。';
    return;
  }
  if ($('confirm-file').disabled) return;
  const reviewEvidence = pending.mode === 'report'
    ? reportReviewEvidence(pending.result)
    : [...correctionDecisionEvidence(pending), ...unresolvedReviewEvidence(pending.result)];
  state.pendingFileReview = null;
  hideFileReview();
  commitSuccessfulFileAnalysis(pending.file, pending.contentBase64, pending.result, reviewEvidence);
  $('file-status').textContent = `${fileStatusText(pending.result)} 已确认资料检查结果。`;
}
'''
text, count = re.subn(r"function confirmPendingFileReview\(\) \{.*?\n\}\n\nfunction replacePendingFileReview", confirm_block + "\nfunction replacePendingFileReview", text, count=1, flags=re.S)
assert count == 1, 'confirm block not found'

old_progress = "    setFileProgress(100, (result.document?.type === 'image' || requiresFileReview(result)) ? '报表检查完成，等待确认' : '分析完成');\n"
new_progress = """    const reportSummary = result.reportReview?.summary || null;
    const completionMessage = result.document?.type === 'image'
      ? (reportSummary?.recognitionMode === 'ocr_unavailable'
          ? '报表识别未完成，请重新上传'
          : reportSummary?.completeReview === true
            ? '报表检查完成，等待确认'
            : '报表检查未完成，等待核对')
      : (requiresFileReview(result) ? '报表检查完成，等待确认' : '分析完成');
    setFileProgress(100, completionMessage);
"""
assert old_progress in text, 'progress line not found'
text = text.replace(old_progress, new_progress, 1)

path.write_text(text)
