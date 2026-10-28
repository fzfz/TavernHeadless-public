import { z } from "zod";
import labels from "../config/model-call-ui.json" with { type: "json" };

export const modelCallUiSchema = z
  .object({
    detailHeading: z.string().min(1),
    detailBackAdmin: z.string().min(1),
    openPage: z.string().min(1),
    returnAdmin: z.string().min(1),
    returnChat: z.string().min(1),
    returningChat: z.string().min(1),
    openDetails: z.string().min(1),
    session: z.string().min(1),
    branch: z.string().min(1),
    floor: z.string().min(1),
    detailPath: z.literal("/generation-detail"),
    step: z.string().min(1),
    requestAttempt: z.string().min(1),
    title: z.string().min(1),
    modelCalls: z.string().min(1),
    close: z.string().min(1),
    run: z.string().min(1),
    attempt: z.string().min(1),
    allRuns: z.string().min(1),
    allAttempts: z.string().min(1),
    filter: z.string().min(1),
    reload: z.string().min(1),
    more: z.string().min(1),
    loading: z.string().min(1),
    empty: z.string().min(1),
    select: z.string().min(1),
    request: z.string().min(1),
    response: z.string().min(1),
    result: z.string().min(1),
    identity: z.string().min(1),
    timing: z.string().min(1),
    noResponse: z.string().min(1),
    evidenceMissing: z.string().min(1),
    callStatus: z.string().min(1),
    turnStatus: z.string().min(1),
    status: z
      .object({
        prepared: z.string().min(1),
        in_flight: z.string().min(1),
        succeeded: z.string().min(1),
        failed: z.string().min(1),
        interrupted: z.string().min(1),
      })
      .strict(),
    commit: z
      .object({
        pending: z.string().min(1),
        committed: z.string().min(1),
        failed: z.string().min(1),
        unknown: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export const modelCallUi = modelCallUiSchema.parse(labels);
