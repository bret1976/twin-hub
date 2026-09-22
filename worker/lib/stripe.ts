import type { OrgRecord } from "../types";

export async function createCheckoutSession(input: {
  secretKey: string;
  org: OrgRecord;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string } | { error: string }> {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);
  params.set("client_reference_id", input.org.id);
  params.set("metadata[orgId]", input.org.id);
  if (input.org.stripeCustomerId) params.set("customer", input.org.stripeCustomerId);
  else params.set("customer_email", `billing+${input.org.id}@twinmeet.local`);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", "2900");
  params.set("line_items[0][price_data][recurring][interval]", "month");
  params.set("line_items[0][price_data][product_data][name]", "TwinMeet Pro");
  params.set("line_items[0][price_data][product_data][description]", "Unlimited twins, rooms, memory, and federation.");
  params.set("integration_identifier", `twinmeet_${crypto.randomUUID().slice(0, 8)}`);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const data = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !data.url) return { error: data.error?.message || "Stripe checkout failed" };
  return { url: data.url };
}

export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const timestamp = parts.t;
  const sig = parts.v1;
  if (!timestamp || !sig) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`));
  const digest = [...new Uint8Array(signed)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return digest === sig;
}
