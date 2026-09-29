import { ReplitConnectors } from "@replit/connectors-sdk";
import { expectedLiveMode } from "./billingState";

export type StripeObject = Record<string, unknown>;

export class StripeProxyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

const connectors = new ReplitConnectors();

function rejectWrongModeObjects(value: unknown, live: boolean): void {
  if (Array.isArray(value)) {
    for (const item of value) rejectWrongModeObjects(item, live);
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (typeof object.livemode === "boolean" && object.livemode !== live) {
    throw new StripeProxyError("Stripe returned an object from the wrong billing environment.");
  }
  for (const child of Object.values(object)) rejectWrongModeObjects(child, live);
}

function errorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const error = (value as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return undefined;
  const code = (error as Record<string, unknown>).code
    ?? (error as Record<string, unknown>).type;
  return typeof code === "string" ? code.slice(0, 80) : undefined;
}

export function requireTestBillingMode(): void {
  expectedLiveMode();
}

async function connectionIdForEnvironment(): Promise<string> {
  const environment = expectedLiveMode() ? "production" : "development";
  const connections = await connectors.listConnections({ connector_names: "stripe" });
  const matches = connections.filter((connection) =>
    connection.environment === environment
    && connection.status === "healthy"
    && connection.connector?.name === "stripe");
  if (matches.length !== 1 || typeof matches[0].id !== "string") {
    throw new StripeProxyError(`Exactly one healthy ${environment} Stripe connection is required.`);
  }
  return matches[0].id;
}

export async function stripeGet<T extends StripeObject = StripeObject>(path: string): Promise<T> {
  return stripeRequest<T>("GET", path);
}

export async function stripePost<T extends StripeObject = StripeObject>(
  path: string,
  body: URLSearchParams,
  idempotencyKey?: string,
): Promise<T> {
  return stripeRequest<T>("POST", path, body, idempotencyKey);
}

async function stripeRequest<T extends StripeObject>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: URLSearchParams,
  idempotencyKey?: string,
): Promise<T> {
  const live = expectedLiveMode();
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new StripeProxyError("Stripe API paths must be relative to the connected Stripe API.");
  }

  let response: Response;
  try {
    const connectionId = await connectionIdForEnvironment();
    response = await connectors.proxy("stripe", path, {
      method,
      ...(body ? { body } : {}),
      headers: {
        "Connection-Id": connectionId,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
    });
  } catch {
    throw new StripeProxyError("The authenticated Stripe connector proxy is unavailable.");
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new StripeProxyError("Stripe returned an invalid API response.", response.status);
  }
  if (!response.ok) {
    throw new StripeProxyError(
      "The Stripe API request failed.",
      response.status,
      errorCode(result),
    );
  }
  rejectWrongModeObjects(result, live);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new StripeProxyError("Stripe returned an invalid API object.", response.status);
  }
  return result as T;
}