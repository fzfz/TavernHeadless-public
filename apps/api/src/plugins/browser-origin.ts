import type { FastifyRequest } from "fastify";

export function validateBrowserRequestOrigin(
  request: FastifyRequest,
  allowedOrigins: readonly string[] = [],
): boolean {
  const origin = request.headers.origin;
  if (!origin) return request.headers["sec-fetch-site"] !== "cross-site";
  try {
    return (
      new URL(origin).host === request.headers.host ||
      allowedOrigins.includes(origin)
    );
  } catch {
    return false;
  }
}
