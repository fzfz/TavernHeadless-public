import { readFileSync } from "node:fs";
import { z } from "zod";

export const userSessionCookieConfigSchema = z.object({
  name: z.string().regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, {
    message: "USER_SESSION_COOKIE_NAME must be a non-empty HTTP cookie token",
  }),
  secure: z.union([z.boolean(), z.literal("auto")]),
});

export type UserSessionCookieConfig = z.infer<
  typeof userSessionCookieConfigSchema
>;

export function loadUserSessionCookieConfig(
  environment: NodeJS.ProcessEnv = process.env,
): UserSessionCookieConfig {
  const defaults = userSessionCookieConfigSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../config/user-session-cookie.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const secure = environment.USER_SESSION_COOKIE_SECURE;
  if (secure !== undefined && secure !== "true" && secure !== "false") {
    throw new Error("USER_SESSION_COOKIE_SECURE must be true or false");
  }
  return userSessionCookieConfigSchema.parse({
    name: environment.USER_SESSION_COOKIE_NAME ?? defaults.name,
    secure: secure === undefined ? defaults.secure : secure === "true",
  });
}
