import type { FreshTrafficEstimate } from "./screener";

type Profile = {
  domain: string;
  averageVisits: number;
  trafficChangePercent: number | null;
};

function profile(value: unknown): Profile | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.domain !== "string" || typeof row.averageVisits !== "number"
    || !Number.isFinite(row.averageVisits) || row.averageVisits < 0) return null;
  return {
    domain: row.domain,
    averageVisits: row.averageVisits,
    trafficChangePercent: typeof row.trafficChangePercent === "number"
      && Number.isFinite(row.trafficChangePercent) ? row.trafficChangePercent : null,
  };
}

export function comparisonGuide(report: Record<string, unknown>, fresh: FreshTrafficEstimate) {
  const profiles = [report.target, report.comparison, ...(Array.isArray(report.additionalProfiles) ? report.additionalProfiles : [])]
    .map(profile).filter((item): item is Profile => item !== null);
  const [target, peer] = profiles;
  const ratio = target && peer && target.averageVisits > 0 && peer.averageVisits > 0
    ? { higherReachDomain: target.averageVisits >= peer.averageVisits ? target.domain : peer.domain,
        multiple: Number((Math.max(target.averageVisits, peer.averageVisits)
          / Math.min(target.averageVisits, peer.averageVisits)).toFixed(1)) }
    : null;
  const trend = target && peer && target.trafficChangePercent !== null && peer.trafficChangePercent !== null
    ? { fasterGrowthDomain: target.trafficChangePercent >= peer.trafficChangePercent ? target.domain : peer.domain,
        gapPercentagePoints: Number(Math.abs(target.trafficChangePercent - peer.trafficChangePercent).toFixed(1)) }
    : null;
  return {
    savedPeriod: report.period,
    savedProfiles: profiles.map((item) => ({
      domain: item.domain,
      averageEstimatedMonthlyVisits: Math.round(item.averageVisits),
      estimatedTrafficChangePercent: item.trafficChangePercent,
    })),
    reachComparison: ratio,
    momentumComparison: trend,
    freshTargetOnly: {
      domain: fresh.domain,
      month: fresh.period,
      estimatedVisits: fresh.visits,
      note: peer
        ? "One separate, newer modeled estimate for the target only; do not compare it with the peer's old period as if concurrent."
        : "One separate, newer modeled estimate for the target; compare periods cautiously, not as concurrent measurements.",
    },
  };
}