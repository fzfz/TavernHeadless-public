import { stat } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  apiErrorMessages,
  createRoleAssetsSchema,
  roleAssetPathSchema,
  roleRuntimeValidators,
  roleStateBundleSchema,
  rolePromptControllerConfigSchema,
  type CreateRoleAssets,
  type RoleRuntimeManifest,
} from "@tavern/shared";
import type { AppDb } from "../../db/client.js";
import {
  characters,
  characterVersions,
  roleAssetBundles,
  roleAssets,
} from "../../db/schema.js";
import {
  executeWithSqliteBusyRetry,
  DEFAULT_RESOURCE_WRITE_RETRY_POLICY,
  type RetryPolicy,
} from "../../lib/retry.js";
import type { RoleFileStore } from "../storage/role-file-store.js";
import type { NativeCardService, NativeCardRevisionSnapshot } from "../native-card/native-card-service.js";

import { getRoleAssetAccountId } from "../public-role-session-binding.js";
type AssetErrorCode =
  | "ROLE_ASSET_NOT_FOUND"
  | "ROLE_ASSETS_ALREADY_SAVED"
  | "ROLE_ASSET_PACKAGE_INVALID"
  | "ROLE_ASSET_SERVER_ONLY"
  | "ROLE_ASSET_FILE_MISSING";
export class RoleAssetError extends Error {
  constructor(
    readonly code: AssetErrorCode,
    readonly details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(apiErrorMessages[code], { cause });
  }
}

export class RoleAssetService {
  constructor(
    private readonly db: AppDb,
    private readonly store: RoleFileStore,
    private readonly nativeCards?: NativeCardService,
    private readonly retry: RetryPolicy = DEFAULT_RESOURCE_WRITE_RETRY_POLICY,
  ) {}

  async import(accountId: string, versionId: string, input: CreateRoleAssets) {
    const parsed = createRoleAssetsSchema.safeParse(input);
    if (!parsed.success)
      throw new RoleAssetError(
        "ROLE_ASSET_PACKAGE_INVALID",
        undefined,
        parsed.error,
      );
    const version = this.db
      .select({ id: characterVersions.id })
      .from(characterVersions)
      .innerJoin(characters, eq(characters.id, characterVersions.characterId))
      .where(
        and(
          eq(characterVersions.id, versionId),
          eq(characters.id, parsed.data.character_id),
          eq(characters.accountId, accountId),
        ),
      )
      .get();
    if (!version) throw new RoleAssetError("ROLE_ASSET_NOT_FOUND");
    if (
      this.db
        .select()
        .from(roleAssetBundles)
        .where(eq(roleAssetBundles.versionId, versionId))
        .get()
    ) {
      throw new RoleAssetError("ROLE_ASSETS_ALREADY_SAVED");
    }
    const files = parsed.data.files.map((file) => ({
      ...file,
      content: Buffer.from(file.base64, "base64"),
    }));
    const manifestFile = files.find(
      (file) => file.name === "manifest.json" && file.purpose === "manifest",
    );
    if (
      !manifestFile ||
      files.filter((file) => file.purpose === "manifest").length !== 1
    ) {
      throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", {
        path: "manifest.json",
      });
    }
    let manifest: RoleRuntimeManifest;
    try {
      const value: unknown = JSON.parse(manifestFile.content.toString("utf8"));
      if (!roleRuntimeValidators.packageSchema(value))
        throw new Error(
          "manifest.json does not satisfy the role runtime schema. Correct its fields using packages/shared/src/schemas/role-runtime.schema.json before importing again.",
        );
      manifest = value as RoleRuntimeManifest;
    } catch (cause) {
      throw new RoleAssetError(
        "ROLE_ASSET_PACKAGE_INVALID",
        { path: "manifest.json" },
        cause,
      );
    }
    const requireFile = (
      path: string,
      purpose: CreateRoleAssets["files"][number]["purpose"],
    ) => {
      if (
        !roleAssetPathSchema.safeParse(path).success ||
        !files.some((file) => file.name === path && file.purpose === purpose)
      ) {
        throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", {
          path,
          purpose,
        });
      }
    };
    requireFile(manifest.html, "template");
    requireFile(manifest.css, "template");
    requireFile(manifest.script, "browser_script");
    if (manifest.floorHtml) requireFile(manifest.floorHtml, "template");
    for (const asset of Object.values(manifest.assets))
      requireFile(asset.file, "media");

    const importId = nanoid();
    await this.store.stage(
      importId,
      files.map((file) => ({ path: file.name, content: file.content })),
    );
    let moved = false;
    try {
      await this.store.commit(importId, accountId, versionId);
      moved = true;
      await executeWithSqliteBusyRetry(
        () =>
          this.db.transaction((tx) => {
            tx.insert(roleAssetBundles)
              .values({
                versionId,
                accountId,
                characterId: parsed.data.character_id,
                storageKey: `${accountId}/${versionId}`,
                importId,
                createdAt: Date.now(),
              })
              .run();
            for (const file of files)
              tx.insert(roleAssets)
                .values({
                  versionId,
                  name: file.name,
                  mime: file.mime,
                  byteSize: file.content.byteLength,
                  purpose: file.purpose,
                })
                .run();
          }),
        this.retry,
      );
      return { version_id: versionId, count: files.length };
    } catch (cause) {
      try {
        if (moved) await this.store.removeVersion(accountId, versionId);
        else await this.store.removeStaging(importId);
      } catch (cleanupError) {
        throw new AggregateError(
          [cause, cleanupError],
          `Role import ${importId} failed and its uncommitted files could not be removed. Ask an administrator to check role_asset_bundle.import_id and storage_key for this import and remove ${this.store.importPath(importId, moved ? { accountId, versionId } : undefined)} only after confirming no bundle references it.`,
          { cause },
        );
      }
      throw cause;
    }
  }

  requireBundle(accountId: string, versionId: string) {
    const bundle = this.db
      .select()
      .from(roleAssetBundles)
      .where(
        and(
          eq(roleAssetBundles.accountId, accountId),
          eq(roleAssetBundles.versionId, versionId),
        ),
      )
      .get();
    if (!bundle)
      throw new RoleAssetError("ROLE_ASSET_NOT_FOUND", { versionId });
    return bundle;
  }

  async requireCompleteBundle(
    accountId: string,
    versionId: string,
  ): Promise<void> {
    accountId = getRoleAssetAccountId(this.db, accountId, versionId);
    const native = await this.loadNativeRevision(accountId, versionId);
    if (native) {
      if (native.package.frontendManifest) {
        const frontend = native.package.frontendManifest;
        for (const path of [frontend.html, frontend.css, frontend.script, ...(frontend.floorHtml ? [frontend.floorHtml] : []), ...Object.values(frontend.assets).map((asset) => asset.file)]) {
          if (!native.files.has(path)) throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", { versionId, path });
        }
      }
      if (native.package.controllerConfig && !native.files.has(native.package.controllerConfig.modulePath)) {
        throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", { versionId, path: native.package.controllerConfig.modulePath });
      }
      if (native.package.stateUpdateProfile) {
        const profile = native.package.stateUpdateProfile;
        for (const path of [profile.stateSchemaFile, ...(profile.ruleFiles ?? []), ...profile.moduleFiles ?? [], profile.deriveScript, profile.validateScript].filter((path): path is string => !!path)) {
          if (!native.files.has(path)) throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", { versionId, path });
        }
      }
      return;
    }
    this.requireBundle(accountId, versionId);
    const files = this.db
      .select()
      .from(roleAssets)
      .where(eq(roleAssets.versionId, versionId))
      .all();
    const requireFile = (name: string, purpose: string) => {
      if (!files.some((file) => file.name === name && file.purpose === purpose))
        throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", {
          versionId,
          path: name,
          purpose,
        });
    };
    requireFile("manifest.json", "manifest");
    const manifestFile = await this.read(accountId, versionId, "manifest.json");
    let value: unknown;
    try {
      value = JSON.parse(manifestFile.content.toString("utf8"));
    } catch (cause) {
      throw new RoleAssetError(
        "ROLE_ASSET_PACKAGE_INVALID",
        { versionId, path: "manifest.json" },
        cause,
      );
    }
    if (!roleRuntimeValidators.packageSchema(value))
      throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", {
        versionId,
        path: "manifest.json",
      });
    const manifest = value as RoleRuntimeManifest;
    requireFile(manifest.html, "template");
    requireFile(manifest.css, "template");
    requireFile(manifest.script, "browser_script");
    if (manifest.floorHtml) requireFile(manifest.floorHtml, "template");
    for (const asset of Object.values(manifest.assets))
      requireFile(asset.file, "media");
    const version = this.db
      .select()
      .from(characterVersions)
      .where(eq(characterVersions.id, versionId))
      .get();
    const snapshot = JSON.parse(version!.dataJson);
    if (snapshot.extensions?.tavern_headless?.promptController) {
      const controller = rolePromptControllerConfigSchema.parse(snapshot.extensions.tavern_headless.promptController);
      requireFile(controller.modulePath, 'server_script');
    }
    if (snapshot.extensions?.tavern_headless?.stateUpdate) {
      const { profile } = roleStateBundleSchema.parse(
        snapshot.extensions.tavern_headless.stateUpdate,
      );
      for (const path of [
        profile.stateSchemaFile,
        ...(profile.ruleFiles ?? []),
      ].filter((path): path is string => path !== undefined))
        requireFile(path, "data");
      for (const path of [profile.deriveScript, profile.validateScript].filter(
        (path): path is string => path !== undefined,
      ))
        requireFile(path, "server_script");
      for (const path of profile.moduleFiles ?? []) {
        if (
          !files.some(
            (file) =>
              file.name === path &&
              (file.purpose === "data" || file.purpose === "server_script"),
          )
        )
          throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", {
            versionId,
            path,
          });
      }
    }
    for (const file of files) {
      try {
        const metadata = await stat(
          await this.store.resolveFile(accountId, versionId, file.name),
        );
        if (!metadata.isFile() || metadata.size !== file.byteSize)
          throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", {
            versionId,
            path: file.name,
          });
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT")
          throw new RoleAssetError(
            "ROLE_ASSET_FILE_MISSING",
            { versionId, path: file.name },
            cause,
          );
        throw cause;
      }
    }
  }

  async read(accountId: string, versionId: string, path: string) {
    accountId = getRoleAssetAccountId(this.db, accountId, versionId);
    const native = await this.loadNativeRevision(accountId, versionId);
    if (native) {
      if (!roleAssetPathSchema.safeParse(path).success)
        throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", { versionId, path });
      const record = native.fileRecords.find((item) => item.path === path);
      if (!record) throw new RoleAssetError("ROLE_ASSET_NOT_FOUND", { versionId, path });
      if (record.purpose === "server_script")
        throw new RoleAssetError("ROLE_ASSET_SERVER_ONLY", { versionId, path });
      const content = native.files.get(path);
      if (!content) throw new RoleAssetError("ROLE_ASSET_FILE_MISSING", { versionId, path });
      return { content: Buffer.from(content), mime: record.mediaType };
    }
    this.requireBundle(accountId, versionId);
    if (!roleAssetPathSchema.safeParse(path).success)
      throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", {
        versionId,
        path,
      });
    const file = this.db
      .select()
      .from(roleAssets)
      .where(
        and(eq(roleAssets.versionId, versionId), eq(roleAssets.name, path)),
      )
      .get();
    if (!file)
      throw new RoleAssetError("ROLE_ASSET_NOT_FOUND", { versionId, path });
    if (file.purpose === "server_script")
      throw new RoleAssetError("ROLE_ASSET_SERVER_ONLY", { versionId, path });
    try {
      return {
        content: await this.store.read(accountId, versionId, path),
        mime: file.mime,
      };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT")
        throw new RoleAssetError(
          "ROLE_ASSET_FILE_MISSING",
          { versionId, path },
          cause,
        );
      throw cause;
    }
  }

  async readData(
    accountId: string,
    versionId: string,
    path: string,
  ): Promise<string> {
    accountId = getRoleAssetAccountId(this.db, accountId, versionId);
    const native = await this.loadNativeRevision(accountId, versionId);
    if (native) {
      const record = native.fileRecords.find((item) => item.path === path);
      if (!record || record.purpose !== "data")
        throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", { versionId, path, purpose: "data" });
      return Buffer.from(native.files.get(path)!).toString("utf8");
    }
    this.requireBundle(accountId, versionId);
    const file = this.db
      .select()
      .from(roleAssets)
      .where(
        and(
          eq(roleAssets.versionId, versionId),
          eq(roleAssets.name, path),
          eq(roleAssets.purpose, "data"),
        ),
      )
      .get();
    if (!file)
      throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", {
        versionId,
        path,
        purpose: "data",
      });
    return (await this.read(accountId, versionId, path)).content.toString(
      "utf8",
    );
  }

  async resolveServerModule(
    accountId: string,
    versionId: string,
    path: string,
  ): Promise<string> {
    accountId = getRoleAssetAccountId(this.db, accountId, versionId);
    const native = await this.loadNativeRevision(accountId, versionId);
    if (native) {
      const record = native.fileRecords.find((item) => item.path === path);
      if (!record || record.purpose !== "server_script")
        throw new RoleAssetError("ROLE_ASSET_NOT_FOUND", { versionId, path });
      if (!this.nativeCards) throw new RoleAssetError("ROLE_ASSET_FILE_MISSING", { versionId, path });
      try {
        return await this.nativeCards.resolveFilePath(accountId, native.cardId, native.revision, path);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT")
          throw new RoleAssetError("ROLE_ASSET_FILE_MISSING", { versionId, path }, cause);
        throw cause;
      }
    }
    this.requireBundle(accountId, versionId);
    const file = this.db
      .select()
      .from(roleAssets)
      .where(
        and(
          eq(roleAssets.versionId, versionId),
          eq(roleAssets.name, path),
          eq(roleAssets.purpose, "server_script"),
        ),
      )
      .get();
    if (!file)
      throw new RoleAssetError("ROLE_ASSET_NOT_FOUND", { versionId, path });
    try {
      return await this.store.resolveFile(accountId, versionId, path);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT")
        throw new RoleAssetError(
          "ROLE_ASSET_FILE_MISSING",
          { versionId, path },
          cause,
        );
      throw cause;
    }
  }

  async nativeRevision(accountId: string, versionId: string): Promise<NativeCardRevisionSnapshot | undefined> {
    return this.loadNativeRevision(getRoleAssetAccountId(this.db, accountId, versionId), versionId);
  }

  private async loadNativeRevision(accountId: string, versionId: string): Promise<NativeCardRevisionSnapshot | undefined> {
    const row = this.db.select({ json: characterVersions.dataJson })
      .from(characterVersions)
      .innerJoin(characters, eq(characters.id, characterVersions.characterId))
      .where(and(eq(characterVersions.id, versionId), eq(characters.accountId, accountId)))
      .get();
    if (!row) throw new RoleAssetError("ROLE_ASSET_NOT_FOUND", { versionId });
    let snapshot: Record<string, unknown>;
    try { snapshot = JSON.parse(row.json) as Record<string, unknown>; }
    catch (cause) { throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", { versionId }, cause); }
    const extensions = snapshot.extensions && typeof snapshot.extensions === "object" ? snapshot.extensions as Record<string, unknown> : undefined;
    const tavernHeadless = extensions?.tavern_headless && typeof extensions.tavern_headless === "object" ? extensions.tavern_headless as Record<string, unknown> : undefined;
    if (!tavernHeadless?.nativePackage) return undefined;
    if (!this.nativeCards) throw new RoleAssetError("ROLE_ASSET_FILE_MISSING", { versionId });
    try { return await this.nativeCards.findRevisionByCharacterVersion(accountId, versionId); }
    catch (cause) { throw new RoleAssetError("ROLE_ASSET_PACKAGE_INVALID", { versionId }, cause); }
  }
}
