import {
  evaluateRetrievalCases,
  type RetrievalEvaluationCase,
} from "../src/modules/retrieval/evaluation";

// Synthetic coordinates only. Add cases here with invented Evidence identifiers;
// never copy a user's query, Evidence narrative, or provider response into fixtures.
const cases: readonly RetrievalEvaluationCase[] = [
  {
    expectedEvidenceIds: ["synthetic-evidence-odoo"],
    returnedEvidenceIds: ["synthetic-evidence-odoo", "synthetic-evidence-erp"],
    explicitExpectedEvidenceIds: ["synthetic-evidence-linked"],
    explicitReturnedEvidenceIds: ["synthetic-evidence-linked"],
    tenantLeakageIds: [],
    staleReturnedIds: [],
    citations: [
      {
        evidenceItemId: "synthetic-evidence-odoo",
        citedEvidenceItemId: "synthetic-evidence-odoo",
        evidenceVersion: 2,
        citedEvidenceVersion: 2,
      },
    ],
  },
  {
    expectedEvidenceIds: ["synthetic-evidence-postgres"],
    returnedEvidenceIds: ["synthetic-evidence-other", "synthetic-evidence-postgres"],
    tenantLeakageIds: [],
    staleReturnedIds: [],
    citations: [
      {
        evidenceItemId: "synthetic-evidence-postgres",
        citedEvidenceItemId: "synthetic-evidence-postgres",
        evidenceVersion: 1,
        citedEvidenceVersion: 1,
      },
    ],
  },
];

const report = {
  fixtureKind: "synthetic-algorithm-correctness",
  caseCount: cases.length,
  warning:
    "Deterministic fixtures validate retrieval plumbing and metrics; they do not measure production semantic quality.",
  metrics: evaluateRetrievalCases(cases),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
