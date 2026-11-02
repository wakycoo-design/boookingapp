/**
 * An address in this app as people reach it. Behind a host's proxy (Catalyst AppSail) the request's own URL is the
 * container's internal one, e.g. http://0.0.0.0:9000, so redirects built from it lead nowhere; AUTH_URL is the public one.
 */
export function publicUrl(path: string, request: Request, env: Record<string, string | undefined> = process.env): string {
  const base = (env.AUTH_URL || new URL(request.url).origin).replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
