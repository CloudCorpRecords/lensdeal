import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, stripeWebhookSecrets } from "@workspace/db";
import { billingMode } from "./billingState";

const KEY_DERIVATION_SALT = "deallens-stripe-webhook-signing-secret-v1";
function configId(): string {
  const mode = billingMode();
  if (!mode) throw new Error("Stripe billing environment is not configured.");
  return `stripe-${mode}`;
}

type EncryptedSecret = {
  ciphertext: string;
  nonce: string;
  authTag: string;
};

export type StoredWebhookSecret = {
  endpointId: string;
  endpointUrl: string;
  secret: string;
};

function encryptionKey(): Buffer {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be configured to encrypt the Stripe webhook signing secret.");
  }
  return scryptSync(sessionSecret, KEY_DERIVATION_SALT, 32);
}

function encryptSecret(secret: string): EncryptedSecret {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    nonce: nonce.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

function decryptSecret(value: EncryptedSecret): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(value.nonce, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(value.authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function storeStripeWebhookSecret(
  endpointId: string,
  endpointUrl: string,
  secret: string,
): Promise<void> {
  if (!secret.startsWith("whsec_")) throw new Error("Stripe returned an invalid webhook signing secret.");
  const encrypted = encryptSecret(secret);
  await db.insert(stripeWebhookSecrets).values({
    id: configId(),
    endpointId,
    endpointUrl,
    ...encrypted,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: stripeWebhookSecrets.id,
    set: {
      endpointId,
      endpointUrl,
      ...encrypted,
      updatedAt: new Date(),
    },
  });
}

export async function getStripeWebhookSecret(): Promise<StoredWebhookSecret | null> {
  const [stored] = await db.select().from(stripeWebhookSecrets)
    .where(eq(stripeWebhookSecrets.id, configId()))
    .limit(1);
  if (!stored) return null;
  try {
    return {
      endpointId: stored.endpointId,
      endpointUrl: stored.endpointUrl,
      secret: decryptSecret(stored),
    };
  } catch {
    throw new Error("The encrypted Stripe webhook secret could not be decrypted; verify SESSION_SECRET and database state.");
  }
}