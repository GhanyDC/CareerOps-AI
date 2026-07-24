export function JobScoreBadge({ score, coverage }: { score: number; coverage: number }) {
  return (
    <span className="score-badge" aria-label={`Preliminary score ${score}, coverage ${coverage}%`}>
      <strong>{score}</strong>
      <span>/100 · {coverage}% coverage</span>
    </span>
  );
}
