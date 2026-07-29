import type { RetrievalReason } from "./schemas";

export const RRF_K = 60 as const;

export type RankedChunk = Readonly<{
  evidenceItemId: string;
  chunkId: string;
  chunkIndex: number;
  chunkHash: string;
  snippet: string;
  rank: number;
  score?: number;
}>;

export type FusedEvidenceRank = Readonly<{
  evidenceItemId: string;
  lexicalRank: number | null;
  semanticRank: number | null;
  hybridScore: number;
  hybridRank: number;
  reasons: readonly RetrievalReason[];
  bestChunk: RankedChunk;
}>;

function compareStableText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBestChunk(left: RankedChunk, right: RankedChunk) {
  if (left.rank !== right.rank) return left.rank - right.rank;
  if (left.chunkIndex !== right.chunkIndex) return left.chunkIndex - right.chunkIndex;
  return compareStableText(left.chunkId, right.chunkId);
}

export function bestChunkForEvidence(chunks: readonly RankedChunk[]) {
  if (chunks.length === 0) throw new Error("At least one chunk is required.");
  return [...chunks].sort(compareBestChunk)[0]!;
}

function evidenceRanks(chunks: readonly RankedChunk[]) {
  const byEvidence = new Map<string, RankedChunk[]>();
  for (const chunk of chunks) {
    const existing = byEvidence.get(chunk.evidenceItemId) ?? [];
    existing.push(chunk);
    byEvidence.set(chunk.evidenceItemId, existing);
  }
  const ordered = [...byEvidence.entries()]
    .map(([evidenceItemId, candidates]) => ({
      evidenceItemId,
      bestChunk: bestChunkForEvidence(candidates),
      sourceRank: Math.min(...candidates.map((candidate) => candidate.rank)),
    }))
    .sort(
      (left, right) =>
        left.sourceRank - right.sourceRank ||
        compareStableText(left.evidenceItemId, right.evidenceItemId),
    );
  return new Map(
    ordered.map((item, index) => [
      item.evidenceItemId,
      { rank: index + 1, bestChunk: item.bestChunk },
    ]),
  );
}

export function reciprocalRankFusion(
  lexicalChunks: readonly RankedChunk[],
  semanticChunks: readonly RankedChunk[],
): readonly FusedEvidenceRank[] {
  const lexical = evidenceRanks(lexicalChunks);
  const semantic = evidenceRanks(semanticChunks);
  const evidenceIds = [...new Set([...lexical.keys(), ...semantic.keys()])];

  const fused = evidenceIds.map((evidenceItemId) => {
    const lexicalEntry = lexical.get(evidenceItemId);
    const semanticEntry = semantic.get(evidenceItemId);
    const hybridScore =
      (lexicalEntry ? 1 / (RRF_K + lexicalEntry.rank) : 0) +
      (semanticEntry ? 1 / (RRF_K + semanticEntry.rank) : 0);
    const bestChunk =
      lexicalEntry && semanticEntry
        ? compareBestChunk(lexicalEntry.bestChunk, semanticEntry.bestChunk) <= 0
          ? lexicalEntry.bestChunk
          : semanticEntry.bestChunk
        : (lexicalEntry?.bestChunk ?? semanticEntry!.bestChunk);
    const reasons: RetrievalReason[] =
      lexicalEntry && semanticEntry
        ? ["HYBRID", "LEXICAL", "SEMANTIC"]
        : lexicalEntry
          ? ["LEXICAL"]
          : ["SEMANTIC"];
    return {
      evidenceItemId,
      lexicalRank: lexicalEntry?.rank ?? null,
      semanticRank: semanticEntry?.rank ?? null,
      hybridScore,
      reasons,
      bestChunk,
    };
  });

  return fused
    .sort(
      (left, right) =>
        right.hybridScore - left.hybridScore ||
        (left.lexicalRank ?? Number.MAX_SAFE_INTEGER) -
          (right.lexicalRank ?? Number.MAX_SAFE_INTEGER) ||
        (left.semanticRank ?? Number.MAX_SAFE_INTEGER) -
          (right.semanticRank ?? Number.MAX_SAFE_INTEGER) ||
        compareStableText(left.evidenceItemId, right.evidenceItemId),
    )
    .map((item, index) => ({ ...item, hybridRank: index + 1 }));
}
