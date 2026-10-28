<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { FloorRecord, TimelineFloor } from "@tavern/sdk";
import {
  apiErrorMessages,
  type GenerationDetailLocation,
  type ModelCallDetail,
  generationDetailLocationSchema,
  modelCallUi,
} from "@tavern/shared";
import { apiClient } from "../lib/api.js";
import { loadGenerationDetailLocation } from "../lib/generation-detail-location.js";
import { modelCallLoadError } from "../lib/model-call-errors.js";
import {
  listGenerationDetailFloors,
  loadGenerationDetailFloor,
  toGenerationDetailFloorOption,
} from "../lib/generation-detail-snapshot.js";
import { useRoleLabels } from "../composables/useRoleLabels.js";
import RoleGenerationDetail from "../components/workspace/RoleGenerationDetail.vue";

const { labels } = useRoleLabels();
const location = ref<GenerationDetailLocation>(),
  sessionTitle = ref(""),
  initialCall = ref<ModelCallDetail>(),
  floor = ref<TimelineFloor>(),
  floorRecord = ref<FloorRecord>(),
  timelineLoaded = ref(false),
  detailLoading = ref(false),
  detailRevision = ref(0),
  failure = ref(""),
  loadFailure = ref("");
const floors = ref<TimelineFloor[]>([]);
let disposed = false;
let requestVersion = 0;

function currentRequest(version: number) {
  return !disposed && requestVersion === version;
}

function setFloorOptions(records: FloorRecord[]) {
  floors.value = records.map(toGenerationDetailFloorOption);
}

function updateLocationUrl(next: GenerationDetailLocation) {
  const url = new URL(window.location.href);
  url.searchParams.set("sessionId", next.sessionId);
  url.searchParams.set("branchId", next.branchId);
  url.searchParams.set("floorId", next.floorId);
  if (next.runId) url.searchParams.set("runId", next.runId);
  else url.searchParams.delete("runId");
  if (next.callId) url.searchParams.set("callId", next.callId);
  else url.searchParams.delete("callId");
  if (next.pageId) url.searchParams.set("pageId", next.pageId);
  else url.searchParams.delete("pageId");
  window.history.replaceState(null, "", url);
}

async function refreshDetail() {
  if (!location.value || detailLoading.value) return;
  const version = ++requestVersion;
  const selectedFloorId = floor.value?.id ?? location.value.floorId;
  detailLoading.value = true;
  failure.value = "";
  try {
    const freshFloors = await listGenerationDetailFloors(
      apiClient,
      location.value.sessionId,
      labels.pageSize,
      () => currentRequest(version),
    );
    if (!currentRequest(version)) return;
    const record = freshFloors.find((item) => item.id === selectedFloorId);
    if (!record || record.sessionId !== location.value.sessionId)
      throw Object.assign(
        new Error(apiErrorMessages.GENERATION_DETAIL_LOCATION_INVALID),
        { code: "GENERATION_DETAIL_LOCATION_INVALID" },
      );
    const refreshedLocation = await loadGenerationDetailLocation(apiClient, {
      ...Object.fromEntries(new URLSearchParams(window.location.search)),
      sessionId: location.value.sessionId,
      branchId: record.branchId,
      floorId: selectedFloorId,
    });
    const verified = refreshedLocation.floor;
    if (!currentRequest(version)) return;
    if (
      verified.id !== selectedFloorId ||
      verified.sessionId !== location.value.sessionId
    )
      throw Object.assign(
        new Error(apiErrorMessages.GENERATION_DETAIL_LOCATION_INVALID),
        { code: "GENERATION_DETAIL_LOCATION_INVALID" },
      );
    const snapshot = await loadGenerationDetailFloor(
      apiClient,
      verified,
      labels.pageSize,
      () => currentRequest(version),
    );
    if (!currentRequest(version) || !snapshot) return;
    setFloorOptions(freshFloors);
    floor.value = snapshot;
    floorRecord.value = verified;
    initialCall.value = refreshedLocation.selectedCall;
    location.value = refreshedLocation.location;
    updateLocationUrl(location.value);
    detailRevision.value += 1;
  } catch (error) {
    if (currentRequest(version)) failure.value = modelCallLoadError(error);
  } finally {
    if (currentRequest(version)) detailLoading.value = false;
  }
}

async function selectFloor(option: TimelineFloor) {
  if (!location.value) return;
  const version = ++requestVersion;
  detailLoading.value = true;
  failure.value = "";
  try {
    const verified = await apiClient.floors.getDetail({ floorId: option.id });
    if (!currentRequest(version)) return;
    if (
      verified.id !== option.id ||
      verified.sessionId !== location.value.sessionId
    )
      throw Object.assign(
        new Error(apiErrorMessages.GENERATION_DETAIL_LOCATION_INVALID),
        { code: "GENERATION_DETAIL_LOCATION_INVALID" },
      );
    const snapshot = await loadGenerationDetailFloor(
      apiClient,
      verified,
      labels.pageSize,
      () => currentRequest(version),
    );
    if (!currentRequest(version) || !snapshot) return;
    floor.value = snapshot;
    floorRecord.value = verified;
    initialCall.value = undefined;
    location.value = {
      sessionId: verified.sessionId,
      branchId: verified.branchId,
      floorId: verified.id,
    };
    updateLocationUrl(location.value);
    detailRevision.value += 1;
  } catch (error) {
    if (currentRequest(version)) failure.value = modelCallLoadError(error);
  } finally {
    if (currentRequest(version)) detailLoading.value = false;
  }
}

onMounted(async () => {
  const version = ++requestVersion;
  try {
    const input = Object.fromEntries(
      new URLSearchParams(window.location.search),
    );
    const parsed = generationDetailLocationSchema.safeParse(input);
    if (!parsed.success) {
      await loadGenerationDetailLocation(apiClient, input);
      return;
    }
    const [result, session, records] = await Promise.all([
      loadGenerationDetailLocation(apiClient, input),
      apiClient.sessions.getDetail({ sessionId: parsed.data.sessionId }),
      listGenerationDetailFloors(
        apiClient,
        parsed.data.sessionId,
        labels.pageSize,
        () => currentRequest(version),
      ),
    ]);
    if (!currentRequest(version)) return;
    location.value = result.location;
    initialCall.value = result.selectedCall;
    sessionTitle.value = session.title ?? session.id;
    const record = records.find((item) => item.id === result.floor.id);
    if (
      !record ||
      record.sessionId !== result.location.sessionId ||
      record.branchId !== result.location.branchId
    )
      throw Object.assign(
        new Error(apiErrorMessages.GENERATION_DETAIL_LOCATION_INVALID),
        { code: "GENERATION_DETAIL_LOCATION_INVALID" },
      );
    const snapshot = await loadGenerationDetailFloor(
      apiClient,
      record,
      labels.pageSize,
      () => currentRequest(version),
    );
    if (!currentRequest(version) || !snapshot) return;
    setFloorOptions(records);
    floor.value = snapshot;
    floorRecord.value = record;
    timelineLoaded.value = true;
  } catch (error) {
    if (currentRequest(version)) loadFailure.value = modelCallLoadError(error);
  }
});

onBeforeUnmount(() => {
  disposed = true;
  requestVersion += 1;
});
</script>
<template>
  <div class="role-workspace generation-focused standalone-generation-detail">
    <header class="topbar generation-detail-topbar">
      <h1>{{ modelCallUi.detailHeading }}</h1>
      <a href="/">{{ modelCallUi.detailBackAdmin }}</a>
    </header>
    <main class="canvas">
      <p v-if="loadFailure" role="alert" class="generation-error">
        {{ loadFailure }}
      </p>
      <template v-else>
        <p v-if="failure" role="alert" class="generation-error">
          {{ failure }}
        </p>
        <p v-if="timelineLoaded && detailLoading" role="status">
          {{ labels.loading }}
        </p>
        <RoleGenerationDetail
          v-if="timelineLoaded && floor && location"
          :key="`${floor.id}:${detailRevision}`"
          :floor="floor"
          :floor-record="floorRecord"
          :floors="floors"
          :session-id="location.sessionId"
          :session-title="sessionTitle"
          :branch-id="location.branchId"
          :initial-call="initialCall"
          :initial-run-id="location.runId"
          :initial-page-id="location.pageId"
          :pending="detailLoading"
          presentation="accordion"
          @select="selectFloor"
          @refresh="refreshDetail"
        />
        <p v-else role="status">{{ labels.loading }}</p>
      </template>
    </main>
  </div>
</template>
<style scoped src="./role-workspace.css"></style>
<style scoped>
.role-workspace.generation-focused {
  display: block;
  height: auto;
  min-height: 100dvh;
  overflow: visible;
  background: #090b0d;
  color: #e5e9eb;
  font:
    15px/1.65 system-ui,
    sans-serif;
}

.role-workspace.generation-focused :deep(.topbar) {
  position: sticky;
  top: 0;
  z-index: 2;
  min-height: 66px;
  height: auto;
  padding: 16px 28px;
  border-bottom: 1px solid #30383e;
  background: #101619;
}

.generation-detail-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.generation-detail-topbar h1 {
  margin: 0;
  font-size: 22px;
}

.generation-detail-topbar a {
  color: #40d4c5;
  text-decoration: underline;
}

.role-workspace.generation-focused :deep(.canvas) {
  display: block;
  width: 100%;
  max-width: 1280px;
  height: auto;
  min-height: 0;
  margin: 24px auto;
  padding: 0 28px 60px;
  overflow: visible;
  border: 0;
  background: transparent;
}

.role-workspace.generation-focused :deep(.generation-detail) {
  padding: 0;
}

.role-workspace.generation-focused :deep(.generation-accordion) {
  border-top: 0;
  padding-top: 0;
}

.role-workspace.generation-focused :deep(.generation-accordion-title) {
  margin: 8px 0 20px;
  font-size: 1.5em;
}

.role-workspace.generation-focused :deep(.generation-floor-select) {
  display: block;
  max-width: 680px;
  margin-bottom: 12px;
  color: #a6b8c0;
  font-size: 15px;
}

.role-workspace.generation-focused :deep(.generation-floor-select select) {
  width: 100%;
  margin-top: 0;
  color: #e5e9eb;
  background: #152126;
  border: 1px solid #46575d;
  border-radius: 6px;
  padding: 9px 12px;
}

.role-workspace.generation-focused :deep(.generation-accordion-actions button) {
  margin: 8px 12px 16px 0;
  color: #e5e9eb;
  background: #152126;
  border: 1px solid #46575d;
  border-radius: 6px;
  padding: 9px 12px;
}

.role-workspace.generation-focused
  :deep(.generation-accordion-actions button:hover) {
  border-color: #40d4c5;
}

.role-workspace.generation-focused :deep(.generation-meta) {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr);
  gap: 8px;
  margin: 20px 0;
  padding: 20px;
  border-radius: 8px;
  background: #121b20;
}

.role-workspace.generation-focused :deep(.generation-meta dt) {
  color: #a6b8c0;
}

.role-workspace.generation-focused :deep(.generation-meta dd) {
  margin: 0;
  overflow-wrap: anywhere;
}

.role-workspace.generation-focused
  :deep(.generation-detail .generation-section) {
  margin: 14px 0;
  border-color: #34434b;
  border-radius: 8px;
  background: #10171b;
}

.role-workspace.generation-focused
  :deep(.generation-detail .generation-section > summary) {
  padding: 16px;
  font-size: 15px;
}

.role-workspace.generation-focused
  :deep(.generation-detail .generation-section > summary::after) {
  content: none;
  color: #a6b8c0;
}

.role-workspace.generation-focused
  :deep(.generation-detail .generation-section[open] > summary::after) {
  transform: rotate(180deg);
}

.role-workspace.generation-focused
  :deep(.generation-detail .generation-section .generation-section) {
  background: #0a1013;
}

.role-workspace.generation-focused
  :deep(.generation-accordion summary:focus-visible) {
  outline: 2px solid #40d4c5;
  outline-offset: 3px;
}

.role-workspace.generation-focused
  :deep(.generation-accordion .generation-text) {
  font:
    13px/1.7 ui-monospace,
    monospace;
  max-height: 540px;
  overflow: auto;
}

.role-workspace.generation-focused :deep(.generation-detail > p.small) {
  font-size: 15px;
  line-height: 1.65;
  color: #a6b8c0;
  overflow-wrap: anywhere;
}
.role-workspace.generation-focused :deep(.generation-floor-select) {
  color: inherit;
}
.role-workspace.generation-focused :deep(.generation-accordion-actions) {
  display: block;
  margin: 0;
  font: 15px/1.65 system-ui, sans-serif;
}
.role-workspace.generation-focused :deep(button),
.role-workspace.generation-focused :deep(select),
.role-workspace.generation-focused :deep(textarea) {
  font: inherit;
  color: inherit;
  background: #152126;
  border: 1px solid #46575d;
  border-radius: 6px;
  padding: 9px 12px;
}
.role-workspace.generation-focused :deep(select),
.role-workspace.generation-focused :deep(textarea) {
  width: 100%;
}
.role-workspace.generation-focused :deep(button) {
  margin: 8px 12px 16px 0;
}
.role-workspace.generation-focused :deep(button:hover) {
  border-color: #40d4c5;
}
.role-workspace.generation-focused
  :deep(.generation-detail .generation-section) {
  padding: 16px;
  overflow: visible;
}
.role-workspace.generation-focused
  :deep(.generation-detail .generation-section > summary) {
  display: list-item;
  list-style: disclosure-closed inside;
  padding: 0;
  border: 0;
}
.role-workspace.generation-focused
  :deep(.generation-detail .generation-section[open] > summary) {
  list-style-type: disclosure-open;
}
.role-workspace.generation-focused
  :deep(
    .generation-detail .generation-section > summary::-webkit-details-marker
  ) {
  display: inline;
}
.role-workspace.generation-focused :deep(.generation-section-body) {
  padding: 0;
}
.role-workspace.generation-focused :deep(.generation-disclosure) {
  display: none;
}
.role-workspace.generation-focused :deep(pre.generation-text) {
  font:
    13px/1.7 ui-monospace,
    monospace;
  max-height: 540px;
  overflow: auto;
  padding: 16px;
  margin: 1em 0;
  background: #080d10;
}
.role-workspace.generation-focused :deep(.generation-accordion p.generation-text) {
  font: 15px/1.65 system-ui, sans-serif;
  max-height: none;
  overflow: visible;
  margin: 1em 0;
}

:global(body:has(.standalone-generation-detail)::-webkit-scrollbar),
:global(body:has(.standalone-generation-detail)::-webkit-scrollbar-track),
:global(body:has(.standalone-generation-detail)::-webkit-scrollbar-thumb),
:global(html:has(.standalone-generation-detail)::-webkit-scrollbar),
:global(html:has(.standalone-generation-detail)::-webkit-scrollbar-track),
:global(html:has(.standalone-generation-detail)::-webkit-scrollbar-thumb) {
  all: revert;
}

@media (max-width: 600px) {
  .role-workspace.generation-focused :deep(.topbar) {
    padding: 12px;
  }

  .role-workspace.generation-focused :deep(.canvas) {
    margin: 24px auto;
    padding: 0 12px 60px;
  }

  .role-workspace.generation-focused :deep(.generation-meta) {
    grid-template-columns: 100px minmax(0, 1fr);
  }
}
</style>
