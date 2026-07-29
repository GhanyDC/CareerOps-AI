export type RetrievalEvaluationCase = Readonly<{
  expectedEvidenceIds: readonly string[];
  returnedEvidenceIds: readonly string[];
  explicitExpectedEvidenceIds?: readonly string[];
  explicitReturnedEvidenceIds?: readonly string[];
  tenantLeakageIds?: readonly string[];
  staleReturnedIds?: readonly string[];
  citations?: readonly Readonly<{
    evidenceItemId: string;
    citedEvidenceItemId: string;
    evidenceVersion: number;
    citedEvidenceVersion: number;
  }>[];
}>;

export type RetrievalEvaluationMetrics = Readonly<{
  recallAtK: number;
  meanReciprocalRank: number;
  explicitLinkInclusion: number;
  tenantIsolationFailures: number;
  staleIndexFailures: number;
  citationCorrectness: number;
}>;

export function recallAtK(expected: readonly string[], returned: readonly string[]) {
  if (expected.length === 0) return 1;
  const returnedSet = new Set(returned);
  return expected.filter((id) => returnedSet.has(id)).length / expected.length;
}

export function reciprocalRank(expected: readonly string[], returned: readonly string[]) {
  const expectedSet = new Set(expected);
  const index = returned.findIndex((id) => expectedSet.has(id));
  return index === -1 ? 0 : 1 / (index + 1);
}

export function evaluateRetrievalCases(
  cases: readonly RetrievalEvaluationCase[],
): RetrievalEvaluationMetrics {
  if (cases.length === 0) {
    return {
      recallAtK: 0,
      meanReciprocalRank: 0,
      explicitLinkInclusion: 0,
      tenantIsolationFailures: 0,
      staleIndexFailures: 0,
      citationCorrectness: 0,
    };
  }
  const recall = cases.reduce(
    (sum, item) => sum + recallAtK(item.expectedEvidenceIds, item.returnedEvidenceIds),
    0,
  );
  const mrr = cases.reduce(
    (sum, item) => sum + reciprocalRank(item.expectedEvidenceIds, item.returnedEvidenceIds),
    0,
  );
  const expectedExplicit = cases.flatMap((item) => item.explicitExpectedEvidenceIds ?? []);
  const returnedExplicit = new Set(cases.flatMap((item) => item.explicitReturnedEvidenceIds ?? []));
  const citations = cases.flatMap((item) => item.citations ?? []);
  return {
    recallAtK: recall / cases.length,
    meanReciprocalRank: mrr / cases.length,
    explicitLinkInclusion:
      expectedExplicit.length === 0
        ? 1
        : expectedExplicit.filter((id) => returnedExplicit.has(id)).length /
          expectedExplicit.length,
    tenantIsolationFailures: cases.reduce(
      (sum, item) => sum + (item.tenantLeakageIds?.length ?? 0),
      0,
    ),
    staleIndexFailures: cases.reduce((sum, item) => sum + (item.staleReturnedIds?.length ?? 0), 0),
    citationCorrectness:
      citations.length === 0
        ? 1
        : citations.filter(
            (citation) =>
              citation.evidenceItemId === citation.citedEvidenceItemId &&
              citation.evidenceVersion === citation.citedEvidenceVersion,
          ).length / citations.length,
  };
}
