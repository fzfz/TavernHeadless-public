import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gt, lt, or, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { userIdentityPolicy } from "@tavern/shared";
import type { AppDb, DbExecutor } from "../db/client.js";
import { accounts, accountUsers } from "../db/schema.js";
import {
  accountCredentials,
  accountLoginSessions,
  accountPreferences,
  registrationOperations,
} from "../db/user-identity-schema.js";
import { WorkspaceScopeService } from "./workspace-scope-service.js";

export const MULTI_ACCOUNT_REQUIRED_MESSAGE =
  "此站点未启用多用户账号，请联系管理员。";

export class UserIdentityError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function readUserSessionToken(
  cookie: string | undefined,
  cookieName: string,
): string | undefined {
  return cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });
}

export function getDefaultPersonaId(
  db: AppDb | DbExecutor,
  accountId: string,
): string | null {
  return (
    db
      .select()
      .from(accountPreferences)
      .where(eq(accountPreferences.accountId, accountId))
      .get()?.defaultPersonaId ?? null
  );
}

export function reconcileDefaultPersona(
  db: AppDb | DbExecutor,
  accountId: string,
  workspaceId: string,
): string | null {
  const available = and(
    eq(accountUsers.accountId, accountId),
    eq(accountUsers.status, "active"),
    or(
      eq(accountUsers.workspaceId, workspaceId),
      isNull(accountUsers.workspaceId),
    ),
  );
  const currentId = getDefaultPersonaId(db, accountId);
  if (
    currentId &&
    db
      .select({ id: accountUsers.id })
      .from(accountUsers)
      .where(and(available, eq(accountUsers.id, currentId)))
      .get()
  )
    return currentId;
  const nextId =
    db
      .select({ id: accountUsers.id })
      .from(accountUsers)
      .where(available)
      .orderBy(desc(accountUsers.updatedAt), asc(accountUsers.id))
      .get()?.id ?? null;
  db.insert(accountPreferences)
    .values({ accountId, defaultPersonaId: nextId })
    .onConflictDoUpdate({
      target: accountPreferences.accountId,
      set: { defaultPersonaId: nextId },
    })
    .run();
  return nextId;
}

export class UserIdentityService {
  constructor(private readonly db: AppDb) {}

  async register(input: {
    name: string;
    email: string;
    password: string;
    operationId?: string;
  }) {
    const email = input.email.trim().toLowerCase();
    const operationId = input.operationId;
    if (operationId) {
      const savedAccountId = this.db.transaction((tx) => {
        const existing = tx
          .select()
          .from(registrationOperations)
          .where(eq(registrationOperations.id, operationId))
          .get();
        if (existing) {
          if (existing.status === "not_created")
            throw new UserIdentityError(
              409,
              "auth_registration_closed",
              "此注册请求已结束，请重新提交注册。",
            );
          if (existing.name !== input.name || existing.email !== email)
            throw new UserIdentityError(
              409,
              "operation_conflict",
              "此请求与已提交的注册资料不一致，请核对注册结果。",
            );
          if (existing.status === "created") return existing.accountId;
          throw new UserIdentityError(
            409,
            "auth_registration_pending",
            "注册结果尚未确认，请先核对注册结果。",
          );
        }
        const now = Date.now();
        tx.insert(registrationOperations)
          .values({
            id: operationId,
            status: "pending",
            name: input.name,
            email,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        return null;
      });
      if (savedAccountId) return this.getAccount(savedAccountId);
    }
    const salt = randomBytes(16).toString("hex");
    const accountId = nanoid();
    try {
      const passwordHash = (
        await derivePassword(input.password, salt)
      ).toString("hex");
      const now = Date.now();
      this.db.transaction((tx) => {
        if (operationId) {
          const operation = tx
            .select()
            .from(registrationOperations)
            .where(eq(registrationOperations.id, operationId))
            .get();
          if (operation?.status !== "pending")
            throw new UserIdentityError(
              409,
              "auth_registration_closed",
              "此注册请求已结束，请重新提交注册。",
            );
        }
        tx.insert(accounts)
          .values({
            id: accountId,
            name: input.name,
            role: "user",
            status: "active",
            isDefault: false,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        new WorkspaceScopeService(tx).ensureDefaultWorkspace(accountId, now);
        tx.insert(accountCredentials)
          .values({ accountId, email, passwordSalt: salt, passwordHash })
          .run();
        tx.insert(accountPreferences)
          .values({ accountId, defaultPersonaId: null })
          .run();
        if (operationId)
          tx.update(registrationOperations)
            .set({ accountId, status: "created", updatedAt: now })
            .where(eq(registrationOperations.id, operationId))
            .run();
      });
    } catch (error) {
      if (operationId)
        this.db
          .update(registrationOperations)
          .set({ status: "not_created", updatedAt: Date.now() })
          .where(
            and(
              eq(registrationOperations.id, operationId),
              eq(registrationOperations.status, "pending"),
            ),
          )
          .run();
      if (
        error instanceof Error &&
        error.message.includes("account_credential.email")
      )
        throw new UserIdentityError(
          409,
          "auth_email_registered",
          "此邮箱已注册，请登录。",
        );
      throw error;
    }
    return this.getAccount(accountId);
  }

  resolveRegistrationOperation(operationId: string) {
    return this.db.transaction((tx) => {
      const operation = tx
        .select()
        .from(registrationOperations)
        .where(eq(registrationOperations.id, operationId))
        .get();
      if (operation?.status === "created")
        return { operation_id: operationId, status: "created" as const };
      const now = Date.now();
      tx.insert(registrationOperations)
        .values({
          id: operationId,
          status: "not_created",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: registrationOperations.id,
          set: { status: "not_created", updatedAt: now },
        })
        .run();
      return { operation_id: operationId, status: "not_created" as const };
    });
  }

  getAccount(accountId: string) {
    const account = this.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get();
    if (!account)
      throw new UserIdentityError(
        401,
        "auth_account_not_found",
        "账号不存在，请重新登录。",
      );
    if (account.status !== "active")
      throw new UserIdentityError(
        403,
        "auth_account_disabled",
        "账号已停用，请联系管理员。",
      );
    const credential = this.db
      .select({ email: accountCredentials.email })
      .from(accountCredentials)
      .where(eq(accountCredentials.accountId, accountId))
      .get();
    return {
      id: account.id,
      name: account.name,
      email: credential?.email ?? null,
      role: account.role,
      status: account.status,
      default_persona_id: getDefaultPersonaId(this.db, accountId),
      created_at: account.createdAt,
      updated_at: account.updatedAt,
    };
  }

  async login(
    input: { email: string; password: string },
    previousToken?: string,
  ) {
    const credential = this.db
      .select()
      .from(accountCredentials)
      .where(eq(accountCredentials.email, input.email.trim().toLowerCase()))
      .get();
    const actual = await derivePassword(
      input.password,
      credential?.passwordSalt ?? "unregistered-identity",
    );
    const expected = credential
      ? Buffer.from(credential.passwordHash, "hex")
      : Buffer.alloc(64);
    if (
      !credential ||
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    )
      throw new UserIdentityError(
        401,
        "auth_invalid_credentials",
        "邮箱或密码不正确，请核对后重新登录。",
      );
    const account = this.getAccount(credential.accountId);
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    this.db.transaction((tx) => {
      if (previousToken)
        tx.delete(accountLoginSessions)
          .where(eq(accountLoginSessions.tokenHash, tokenHash(previousToken)))
          .run();
      tx.delete(accountLoginSessions)
        .where(lt(accountLoginSessions.expiresAt, now))
        .run();
      tx.insert(accountLoginSessions)
        .values({
          tokenHash: tokenHash(token),
          accountId: account.id,
          createdAt: now,
          expiresAt: now + userIdentityPolicy.sessionMaxAgeSeconds * 1000,
        })
        .run();
    });
    return { account, token };
  }

  resolveSession(token: string): string | null {
    return (
      this.db
        .select({ accountId: accountLoginSessions.accountId })
        .from(accountLoginSessions)
        .where(
          and(
            eq(accountLoginSessions.tokenHash, tokenHash(token)),
            gt(accountLoginSessions.expiresAt, Date.now()),
          ),
        )
        .get()?.accountId ?? null
    );
  }

  logout(token: string | undefined): void {
    if (token)
      this.db
        .delete(accountLoginSessions)
        .where(eq(accountLoginSessions.tokenHash, tokenHash(token)))
        .run();
  }

  updateName(accountId: string, name: string) {
    this.getAccount(accountId);
    this.db
      .update(accounts)
      .set({ name, updatedAt: Date.now() })
      .where(eq(accounts.id, accountId))
      .run();
    return this.getAccount(accountId);
  }

  updateDefaultPersona(accountId: string, personaId: string | null) {
    const workspaceId = new WorkspaceScopeService(this.db).getDefaultWorkspace(
      accountId,
    ).id;
    return this.db.transaction((tx) => {
      if (
        personaId &&
        !tx
          .select({ id: accountUsers.id })
          .from(accountUsers)
          .where(
            and(
              eq(accountUsers.id, personaId),
              eq(accountUsers.accountId, accountId),
              eq(accountUsers.status, "active"),
              or(
                eq(accountUsers.workspaceId, workspaceId),
                isNull(accountUsers.workspaceId),
              ),
            ),
          )
          .get()
      )
        throw new UserIdentityError(
          404,
          "persona_not_found",
          "演绎人格不可用，请刷新列表后重新选择。",
        );
      tx.insert(accountPreferences)
        .values({ accountId, defaultPersonaId: personaId })
        .onConflictDoUpdate({
          target: accountPreferences.accountId,
          set: { defaultPersonaId: personaId },
        })
        .run();
      return { default_persona_id: personaId };
    });
  }
}
