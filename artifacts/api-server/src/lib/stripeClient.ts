import { ReplitConnectors } from "@replit/connectors-sdk";

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

function rejectLiveObjects(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) rejectLiveObjects(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (object.livemode === true) {
    throw new StripeProxyError("Live-mode Stripe objects are disabled.");
  }
  for (const child of Object.values(object)) rejectLiveObjects(child);
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
  if (process.env.STRIPE_BILLING_MODE !== "test") {
    throw new StripeProxyError("Stripe calls are disabled unless STRIPE_BILLING_MODE=test.");
  }
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
  requireTestBillingMode();
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new StripeProxyError("Stripe API paths must be relative to the connected Stripe API.");
  }

  let response: Response;
  try {
    response = await connectors.proxy("stripe", path, {
      method,
      ...(body ? {
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      } : {}),
      ...(idempotencyKey ? { headers: {
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        "Idempotency-Key": idempotencyKey,
      } } : {}),
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
      "The Stripe test API request failed.",
      response.status,
      errorCode(result),
    );
  }
  rejectLiveObjects(result);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new StripeProxyError("Stripe returned an invalid API object.", response.status);
  }
  return result as T;
}