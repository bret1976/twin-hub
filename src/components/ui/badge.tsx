import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide",
  {
    variants: {
      variant: {
        gold: "border-gold/40 bg-gold/15 text-gold",
        teal: "border-teal/40 bg-teal/15 text-teal",
        coral: "border-coral/40 bg-coral/15 text-coral",
        mute: "border-rule bg-ink text-muted",
      },
    },
    defaultVariants: { variant: "mute" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
