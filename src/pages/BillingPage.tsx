import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { SessionOrg } from "@/lib/session";

export function BillingPage({ org, onOrg }: { org: SessionOrg | null; onOrg: (org: SessionOrg) => void }) {
  const [plan, setPlan] = useState<"free" | "pro">(org?.plan ?? "free");
  const [stripe, setStripe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .billing()
      .then((b) => {
        setPlan(b.plan);
        setStripe(b.stripeConfigured);
        if (b.org) onOrg(b.org);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Billing load failed"));
  }, [onOrg]);

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.checkout();
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      setError(res.message || "Stripe Checkout is not configured on this host.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  async function grantDev() {
    setBusy(true);
    setError(null);
    try {
      const activated = await api.activatePro();
      setPlan("pro");
      onOrg(activated.org);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grant failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Billing</h1>
        <p className="mt-1 text-sm text-muted">
          TwinMeet Pro is $29/month via Stripe Checkout. This host {stripe ? "has a Stripe key." : "does not have STRIPE_SECRET_KEY, so Checkout cannot charge a card."}
        </p>
      </div>
      {error && <p className="text-sm text-coral">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Free</CardTitle>
            <CardDescription>Platform twins, up to 8 org-owned twins, 3 open rooms.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant={plan === "free" ? "gold" : "mute"}>{plan === "free" ? "Current" : "Included"}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>TwinMeet Pro</CardTitle>
            <CardDescription>$29 / month — unlimited twins, rooms, memory, and federation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge variant={plan === "pro" ? "teal" : "mute"}>{plan === "pro" ? "Current" : stripe ? "Stripe" : "No Stripe key"}</Badge>
            {plan !== "pro" && stripe && (
              <Button disabled={busy} onClick={() => void checkout()}>
                Checkout with Stripe
              </Button>
            )}
            {plan !== "pro" && !stripe && (
              <Button variant="outline" disabled={busy} onClick={() => void grantDev()}>
                Development Pro grant
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
