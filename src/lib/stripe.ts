// Stripe client — server-only.
//
// The secret key + webhook secret are read from env vars. While Stripe keys
// are not yet provisioned, the placeholder `sk_test_placeholder` /
// `whsec_placeholder` values let the code typecheck + import safely — no API
// requests are made until a real key is set. Routes that need to actually call
// Stripe (checkout, portal) detect the placeholder + return a mock URL so the
// UI flow is testable end-to-end before going live.
//
// `apiVersion` is pinned to a known-good string. The installed Stripe SDK
// (v22+) types `apiVersion` as the latest pinned version, so we cast to satisfy
// the type without binding the runtime to a version we haven't tested against.
// Pinning matters: Stripe's API versioning guarantees the response shapes we
// read in the webhook handler (e.g. `subscription.current_period_end`) stay
// stable regardless of dashboard-side upgrades.
import Stripe from "stripe";

export const STRIPE_API_VERSION = "2024-06-20" as Stripe.LatestApiVersion;

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder", {
  apiVersion: STRIPE_API_VERSION,
});

// True when a real Stripe secret key is configured (i.e. not the placeholder).
// Routes use this to decide whether to call Stripe live or return a mock URL.
export function hasStripeKey(): boolean {
  const key = process.env.STRIPE_SECRET_KEY;
  return !!key && !key.startsWith("sk_test_placeholder") && key.startsWith("sk_");
}

// True when a real Stripe webhook secret is configured.
export function hasStripeWebhookSecret(): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  return !!secret && !secret.startsWith("whsec_placeholder") && secret.startsWith("whsec_");
}
