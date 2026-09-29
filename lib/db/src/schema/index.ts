import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const accounts = pgTable("deallens_accounts", {
  id: text("id").primaryKey(),
  tier: text("tier").notNull().default("free"),
  subscriptionStatus: text("subscription_status").notNull().default("inactive"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Existing rows were created by sandbox billing. Never treat them as live entitlements.
  stripeBillingMode: text("stripe_billing_mode").notNull().default("test"),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usageCounters = pgTable(
  "deallens_usage_counters",
  {
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    kind: text("kind").notNull(),
    used: integer("used").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.periodStart, table.kind] })],
);

export const savedScreens = pgTable(
  "deallens_screens",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    requestId: text("request_id"),
    targetDomain: text("target_domain").notNull(),
    comparisonDomains: jsonb("comparison_domains").$type<string[]>().notNull(),
    report: jsonb("report").$type<Record<string, unknown>>().notNull(),
    units: integer("units").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("deallens_screens_account_created_idx").on(table.accountId, table.createdAt),
    uniqueIndex("deallens_screens_account_request_idx").on(table.accountId, table.requestId),
  ],
);

export const compilations = pgTable(
  "deallens_compilations",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    screenIds: jsonb("screen_ids").$type<string[]>().notNull(),
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("deallens_compilations_account_created_idx").on(table.accountId, table.createdAt)],
);

export const explanations = pgTable(
  "deallens_explanations",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    screenId: text("screen_id").notNull().references(() => savedScreens.id, { onDelete: "cascade" }),
    requestId: text("request_id"),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    citations: jsonb("citations").$type<Array<{ label: string; url: string; period: string; retrievedAt: string }>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("deallens_explanations_account_screen_idx").on(table.accountId, table.screenId),
    uniqueIndex("deallens_explanations_request_idx").on(table.accountId, table.requestId),
  ],
);

export const copilotAnswers = pgTable(
  "deallens_copilot_answers",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    compilationId: text("compilation_id").notNull().references(() => compilations.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    freshLookup: boolean("fresh_lookup").notNull(),
    citations: jsonb("citations").$type<Array<{ reportId: string | null; domain: string; period: string; retrievedAt: string; sourceUrl: string; label: string }>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("deallens_copilot_compilation_idx").on(table.accountId, table.compilationId, table.createdAt),
    uniqueIndex("deallens_copilot_request_idx").on(table.accountId, table.requestId),
  ],
);

export const requestIdempotency = pgTable(
  "deallens_request_idempotency",
  {
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    requestType: text("request_type").notNull(),
    status: text("status").notNull().default("pending"),
    resourceId: text("resource_id"),
    response: jsonb("response").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.requestId, table.requestType] })],
);

export const processedStripeEvents = pgTable("deallens_stripe_events", {
  id: text("id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  success: boolean("success").notNull().default(true),
});

export const stripeWebhookSecrets = pgTable("deallens_stripe_webhook_secrets", {
  id: text("id").primaryKey(),
  endpointId: text("endpoint_id").notNull(),
  endpointUrl: text("endpoint_url").notNull(),
  ciphertext: text("ciphertext").notNull(),
  nonce: text("nonce").notNull(),
  authTag: text("auth_tag").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});