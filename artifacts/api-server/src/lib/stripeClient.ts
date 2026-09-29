import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

export type StripeCredentials = { secretKey: string };

async function getStripeCredentials(): Promise<StripeCredentials> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;
  if (!hostname || !xReplitToken) throw new Error("Stripe connection is not available in this environment.");
  let response: Response;
  try {
    response = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
      { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken }, signal: AbortSignal.timeout(10000) },
    );
  } catch {
    throw new Error("Could not reach the connected Stripe account.");
  }
  if (!response.ok) throw new Error("Could not retrieve Stripe connection settings.");
  const data = await response.json() as {
    items?: Array<{ settings?: { secret_key?: unknown } }>;
  };
  const settings = data.items?.[0]?.settings;
  if (typeof settings?.secret_key !== "string") {
    throw new Error("Stripe connection is missing its server-side key.");
  }
  return { secretKey: settings.secret_key };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  if (!secretKey.startsWith("sk_test_")) {
    throw new Error("Only Stripe test mode is enabled until pricing and usage rights are approved.");
  }
  return new Stripe(secretKey);
}

export async function getStripeClient(): Promise<Stripe> {
  return getUncachableStripeClient();
}

export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe synchronization.");
  const { secretKey } = await getStripeCredentials();
  if (!secretKey.startsWith("sk_test_")) {
    throw new Error("Live-mode Stripe synchronization is disabled until pricing and Similarweb usage rights are approved.");
  }
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: "",
  });
}