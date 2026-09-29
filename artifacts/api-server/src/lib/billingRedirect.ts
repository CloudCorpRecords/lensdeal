import type { Request } from "express";

export function approvedBillingOrigin(req: Request): string | null {
  const host = req.get("host")?.trim();
  if (!host) return null;
  const allowedHosts = (process.env.REPLIT_DOMAINS || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedHosts.includes(host.toLowerCase())) return null;
  try {
    const parsed = new URL(`https://${host}`);
    if (parsed.host.toLowerCase() !== host.toLowerCase() || parsed.pathname !== "/") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}