import { loadUserSessionCookieConfig } from "../../src/user-session-cookie-config.js";
import type { FastifyInstance } from "fastify";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../src/accounts/constants.js";
import { registerAuth } from "../../src/plugins/auth.js";

export async function registerDevelopmentTestAuth(
  app: FastifyInstance,
  db: unknown = {},
): Promise<void> {
  await registerAuth(app, { mode: "off" }, {
    userSessionCookieName: loadUserSessionCookieConfig().name,
    db: db as never,
    accountMode: "single",
    defaultAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
  });
}
