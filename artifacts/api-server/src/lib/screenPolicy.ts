export function screenUnits(comparisonCount: number): number {
  return Math.max(1, comparisonCount);
}

export function screenAccessError(comparisonCount: number, tier: string, providerCap: number): {
  status: 403 | 413;
  error: string;
} | null {
  if (comparisonCount > 19) {
    return { status: 413, error: "A research set can contain at most 20 domains including the target." };
  }
  if (comparisonCount > 1 && tier !== "enterprise") {
    return { status: 403, error: "Multi-domain comparisons require an active Enterprise subscription." };
  }
  if (comparisonCount > providerCap) {
    return {
      status: 413,
      error: `This request exceeds the server-side provider spend cap of ${providerCap} comparisons. Split it into smaller screens.`,
    };
  }
  return null;
}