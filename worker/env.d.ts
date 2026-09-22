import type { Env } from "./types";

declare module "cloudflare:workers" {
  interface CloudflareBindings extends Env {}
}
