function defaultShouldReview(finding) {
  return finding?.priority === 'P0' || finding?.status === 'confirmed' || (typeof finding?.confidence === 'number' && finding.confidence < 0.65);
}

function downgradePriority(priority) {
  if (priority === 'P0') return 'P1';
  return priority || 'P2';
}

export async function crossReviewDiagnosis(primary, { reviewer, shouldReview = defaultShouldReview } = {}) {
  if (!primary || !Array.isArray(primary.findings)) throw new TypeError('primary findings are required');
  if (typeof reviewer !== 'function') throw new TypeError('reviewer is required');

  const findings = primary.findings.map((finding) => ({ ...finding }));
  const candidates = findings.filter((finding) => !finding.deterministic && shouldReview(finding));

  for (const finding of findings) {
    if (finding.deterministic) {
      finding.crossModelStatus = 'program_fact';
    } else if (!shouldReview(finding)) {
      finding.crossModelStatus = 'single_model';
    }
  }

  if (candidates.length === 0) return { ...primary, findings };

  const reviewResult = await reviewer({ findings: candidates });
  const reviews = Array.isArray(reviewResult?.reviews) ? reviewResult.reviews : [];

  for (const finding of findings) {
    if (finding.deterministic || !shouldReview(finding)) continue;
    const review = reviews.find((item) => item?.title === finding.title);
    if (!review) {
      finding.crossModelStatus = 'review_missing';
      continue;
    }

    finding.review = review;
    if (review.verdict === 'agree') {
      finding.crossModelStatus = 'consistent';
      continue;
    }

    if (review.verdict === 'disagree') {
      finding.crossModelStatus = 'disputed';
      finding.missingEvidence = Array.isArray(review.missingEvidence) ? review.missingEvidence : [];
      finding.status = 'hypothesis';
      finding.priority = downgradePriority(finding.priority);
      finding.confidence = Math.min(typeof finding.confidence === 'number' ? finding.confidence : 0.5, 0.49);
      continue;
    }

    finding.crossModelStatus = 'uncertain_review';
  }

  return { ...primary, findings };
}
