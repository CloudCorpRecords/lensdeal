import type { RequestHandler } from "express";

function validHost(value: string): boolean {
  return /^[a-z0-9.-]+$/i.test(value) && !value.startsWith(".") && !value.endsWith(".");
}

function artifactOrigins(): Set<string> {
  const origins = new Set<string>();
  const configuredHosts = [
    ...(process.env.REPLIT_DOMAINS || "").split(","),
    process.env.REPLIT_DEV_DOMAIN || "",
  ];
  for (const entry of configuredHosts) {
    const host = entry.trim().toLowerCase();
    if (host && validHost(host)) origins.add(`https://${host}`);
  }
  if (process.env.NODE_ENV === "development") {
    const port = process.env.PORT;
    if (port && /^\d+$/.test(port)) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }
  return origins;
}

function approvedRequestHost(req: Parameters<RequestHandler>[0]): boolean {
  const host = req.get("host")?.toLowerCase();
  if (!host) return false;
  return [...artifactOrigins()].some((origin) => {
    try {
      return new URL(origin).host.toLowerCase() === host;
    } catch {
      return false;
    }
  });
}

function sameOriginRequest(req: Parameters<RequestHandler>[0], origin: string): boolean {
  if (origin === "null") return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const canonical = parsed.origin.toLowerCase();
  const host = req.get("host")?.toLowerCase();
  return origin === parsed.origin
    && artifactOrigins().has(canonical)
    && !!host
    && parsed.host.toLowerCase() === host;
}

export const sameOriginSecurity: RequestHandler = (req, res, next) => {
  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    res.status(403).json({ error: "Cross-origin API requests are not allowed." });
    return;
  }
  if (!origin && fetchSite && !approvedRequestHost(req)) {
    res.status(403).json({ error: "Request host is not an approved artifact host." });
    return;
  }
  if (origin && !sameOriginRequest(req, origin)) {
    res.status(403).json({ error: "Origin is not an approved same-origin artifact host." });
    return;
  }
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase());
  if (mutating && !origin && !approvedRequestHost(req)) {
    res.status(403).json({ error: "Origin-less mutations are limited to approved artifact hosts." });
    return;
  }

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
    res.status(204).end();
    return;
  }
  next();
};