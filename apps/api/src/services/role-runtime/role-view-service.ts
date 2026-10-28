import {
  roleRuntimeValidators,
  roleViewSchema,
  roleSessionCharacterSchema,
  roleSessionPersonaSchema,
  roleSessionMetadataSchema,
  type RoleDelivery,
  type RoleRuntimeManifest,
  type NativeCardFrontendManifest,
} from "@tavern/shared";
import type { DisplaySnapshotService } from "./display-snapshot-service.js";
import type { StateUpdateService } from "./state-update-service.js";
import type { RoleAssetService } from "./role-asset-service.js";
import { RoleRuntimeError } from "./runtime-error.js";
import { previewPromptMacroText } from "../prompt-assembler.js";
import type { StMacroJsonValue } from "../st-macros/types.js";
import { prepareRoleDocumentUrls } from "./role-document-urls.js";

export class RoleViewService {
  constructor(
    private readonly snapshots: DisplaySnapshotService,
    private readonly updates: StateUpdateService,
    private readonly assets: RoleAssetService,
  ) {}

  async get(accountId: string, sessionId: string, branchId = "main") {
    const session = this.snapshots.session(accountId, sessionId);
    const initial = branchId === "main" ? this.snapshots.first(accountId, sessionId, branchId) : this.snapshots.ensureBranch(accountId, sessionId, branchId);
    if (!initial) throw new RoleRuntimeError("ROLE_STATE_UNINITIALIZED");
    const current = this.snapshots.latest(accountId, sessionId, branchId) ?? initial;
    if (!session.characterVersionId)
      throw new RoleRuntimeError("ROLE_SESSION_VERSION_MISSING");
    const versionId = session.characterVersionId;
    const native = await this.assets.nativeRevision(accountId, versionId);
    const frontendManifest = native?.package.frontendManifest;
    let manifest: RoleRuntimeManifest | NativeCardFrontendManifest | undefined;
    if (native && frontendManifest) {
      manifest = frontendManifest;
    } else if (!native) {
      const manifestValue: unknown = JSON.parse(
        (
          await this.assets.read(accountId, versionId, "manifest.json")
        ).content.toString("utf8"),
      );
      if (!roleRuntimeValidators.packageSchema(manifestValue))
        throw new RoleRuntimeError("ROLE_VIEW_CONFIG_INVALID");
      manifest = manifestValue as RoleRuntimeManifest;
    }
    const url = (path: string) =>
      `/role-assets/${encodeURIComponent(versionId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const data = native && frontendManifest
      ? await readNativeFrontendData(frontendManifest, (path) =>
          this.assets.readData(accountId, versionId, path),
        )
      : native
        ? {}
        : structuredClone(manifest!.data);
    const dataUrls = native && frontendManifest
      ? Object.fromEntries(
          Object.entries(frontendManifest.data).map(
            ([key, path]) => [key, url(path)],
          ),
        )
      : undefined;
    const text = async (path: string) =>
      (await this.assets.read(accountId, versionId, path)).content.toString(
        "utf8",
      );
    const delivery: RoleDelivery =
      native && !frontendManifest
        ? {
            mode: "system_chat",
            html: "",
            css: "",
            scriptUrl: null,
            floorHtml: null,
            data,
            assets: {},
          }
        : {
            mode: "custom",
            html: await text(manifest!.html),
            css: await text(manifest!.css),
            scriptUrl: url(manifest!.script),
            floorHtml: manifest!.floorHtml
              ? await text(manifest!.floorHtml)
              : null,
            data,
            ...(native
              ? {
                  htmlUrl: url(manifest!.html),
                  cssUrl: url(manifest!.css),
                  ...(manifest!.floorHtml
                    ? { floorHtmlUrl: url(manifest!.floorHtml) }
                    : {}),
                  dataUrls,
                }
              : {}),
            assets: Object.fromEntries(
              Object.entries(manifest!.assets).map(([id, { file, ...asset }]) => [
                id,
                { ...asset, url: url(file) },
              ]),
            ),
          };
    if (native && frontendManifest) {
      const page = prepareRoleDocumentUrls(delivery.html, delivery.htmlUrl!);
      delivery.html = page.html;
      delivery.htmlAssetOriginOffsets = page.assetOriginOffsets;
      if (delivery.floorHtml !== null) {
        const floor = prepareRoleDocumentUrls(delivery.floorHtml, delivery.floorHtmlUrl!);
        delivery.floorHtml = floor.html;
        delivery.floorHtmlAssetOriginOffsets = floor.assetOriginOffsets;
      }
    }
    const character = roleSessionCharacterSchema.parse(
      JSON.parse(session.characterSnapshotJson ?? "{}"),
    );
    const metadata = roleSessionMetadataSchema.parse(
      JSON.parse(session.metadataJson ?? "{}"),
    );
    const opening = character.extensions.tavern_headless.openings.items.find(
      (item) => item.id === metadata.opening_id,
    );
    if (!opening) throw new RoleRuntimeError("ROLE_OPENING_NOT_FOUND");
    const persona = roleSessionPersonaSchema.parse(
      JSON.parse(session.userSnapshotJson ?? "{}"),
    );
    delivery.data.opening = previewPromptMacroText({
      session,
      text: opening.displayText,
      chatHistory: [],
      ordinaryVariables: { stat_data: initial.variables },
      localValues: { stat_data: initial.variables as StMacroJsonValue },
      globalValues: {},
    }).text;
    if (persona.name) delivery.data.performerName = persona.name;
    if (persona.avatar && typeof delivery.data.performerAvatar === "string") {
      delivery.assets[delivery.data.performerAvatar] = {
        kind: "image",
        url: persona.avatar,
        label: persona.name ?? "",
        tags: ["avatar"],
      };
    }
    const pending = this.updates.pending(sessionId, branchId);
    return roleViewSchema.parse({
      character_id: session.characterId,
      character_version_id: versionId,
      name: session.title,
      delivery,
      initial,
      current,
      processing: {
        pendingMain: null,
        pendingFollowups: false,
        pendingStateFloorId: pending?.id ?? null,
      },
      capabilities: {
        send: !pending && !this.updates.isRunning(sessionId),
        history: true,
        customFloors: delivery.floorHtml !== null,
      },
    });
  }
}

async function readNativeFrontendData(
  manifest: NonNullable<NativeCardFrontendManifest>,
  readData: (path: string) => Promise<string>,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(manifest.data)) {
    let content: string;
    try {
      content = await readData(path);
    } catch (cause) {
      throw new RoleRuntimeError("ROLE_VIEW_CONFIG_INVALID", 409, { path }, cause);
    }
    try {
      result[key] = JSON.parse(content) as unknown;
    } catch (cause) {
      throw new RoleRuntimeError("ROLE_VIEW_CONFIG_INVALID", 409, { path }, cause);
    }
  }
  return result;
}
