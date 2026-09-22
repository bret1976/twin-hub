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
      const activated = await api.activatePro();
      setPlan("pro");
      onOrg(activated.org);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Billing</h1>
        <p className="mt-1 text-sm text-muted">
          TwinMeet Pro is $29/month. Stripe Checkout is used when STRIPE_SECRET_KEY is set; otherwise
          this workspace can activate Pro locally so rooms, memory, and federation stay unblocked.
        </p>
      </div>
      {error && <p className="text-sm text-coral">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Free</CardTitle>
            <CardDescription>Seeded twins, two-party rooms, audit.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant={plan === "free" ? "gold" : "mute"}>{plan === "free" ? "Current" : "Included"}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>TwinMeet Pro</CardTitle>
            <CardDescription>$29 / month — extra twins, org memory, federation, voting rooms.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge variant={plan === "pro" ? "teal" : "mute"}>{plan === "pro" ? "Current" : stripe ? "Stripe" : "Local activate"}</Badge>
            {plan !== "pro" && (
              <Button disabled={busy} onClick={() => void checkout()}>
                {stripe ? "Checkout with Stripe" : "Activate Pro"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
