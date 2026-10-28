import json
from pathlib import Path

OUT = Path(__file__).resolve().parent


def read(name):
    return json.loads((OUT / name).read_text())


checks = []
samples = []
current_stage = "budget"


def check(case, name, actual, expected):
    checks.append({"case": case, "stage": current_stage, "check": name, "passed": actual == expected,
                   **({} if actual == expected else {"actual": actual, "expected": expected})})


records = [json.loads(row["recordJson"]) for row in read("model-call-records.json")]
snapshots = {row["id"]: row for row in read("state-snapshots.json")}
cases = read("cases.json")
for key, case in cases.items():
    previous = case["initialView"]["current"]
    prior = []
    for round_no in range(1, case["lastBodyRound"] + 1):
        label = f"{key}-r{round_no}"
        body_file = next(f for f in OUT.glob(label + "-body*-result.json") if "-body-dry" not in f.name and read(f.name).get("finalState") == "committed")
        body_label = body_file.name.removesuffix("-result.json")
        body_request_file = next(OUT.glob(f"*-{body_label}-provider-request.json"))
        current_stage = "baseline" if int(body_request_file.name.split("-")[0]) <= read("source-stages.json")["baseline"]["requestNumbers"][1] else "corrected"
        body = read(body_file.name)
        body_dry = read(body_file.name.replace("-body", "-body-dry", 1))
        state_dry = read(label + "-state-dry-result.json")
        state = read(label + "-state-result.json") if (OUT / (label + "-state-result.json")).exists() else read(label + "-state-morph-result.json")
        inspected = read(label + "-inspect-result.json")
        samples.append({"case": label, "stage": current_stage})
        for phase, dry in [("body", body_dry), ("state", state_dry)]:
            files = list(OUT.glob(f"*-{label}-{phase}*-provider-request.json"))
            files = [f for f in files if f"-{phase}-dry-" not in f.name]
            for file in files:
                request = read(file.name)["body"]
                request_label = file.name.split("-", 1)[1].removesuffix("-provider-request.json")
                candidate_dry = request_label.replace("-" + phase, "-" + phase + "-dry", 1) + "-result.json"
                request_dry = read(candidate_dry) if (OUT / candidate_dry).exists() else dry
                check(file.name, "actual_messages_equal_formal_dry_run", request["messages"], request_dry["messages"])
                check(file.name, "authorized_model", request["model"], "deepseek/deepseek-v4.1-flash")
                check(file.name, "automatic_provider_fallback_disabled", request["provider"]["allow_fallbacks"], False)
                check(file.name, "complete_persona_in_actual_messages", any(case["persona"]["description"] in m["content"] for m in request["messages"]), True)
                if phase == "state":
                    check(file.name, "actual_output_schema", request["response_format"]["json_schema"]["schema"], dry["outputSchema"])
        check(label, "body_committed", body["finalState"], "committed")
        check(label, "before_equals_prior_commit", state_dry["before"], previous["variables"])
        check(label, "previous_snapshot_identity", state_dry["previousSnapshotId"], previous["snapshotId"])
        check(label, "state_parent_identity", state["parentSnapshotId"], previous["snapshotId"])
        check(label, "state_matches_current_view", state, inspected["view"]["current"])
        check(label, "state_floor_matches_body", state["floorId"], body["floorId"])
        check(label, "saved_before", json.loads(snapshots[state["snapshotId"]]["calculationBeforeJson"]), state_dry["before"])
        history = state_dry["variableHistory"]
        expected_history = prior[-read("configuration.json")["stateHistoryTurns"]:]
        check(label, "recent_history_floor_numbers", [h["floorNo"] for h in history], [h["floorNo"] for h in expected_history])
        for item, old in zip(history, expected_history):
            for field in ["floorId", "before", "after"]:
                check(label, "history_" + str(item["floorNo"]) + "_" + field, item[field], old[field])
            check(label, "history_snapshot_ancestry", old["snapshotId"] in item["snapshotIds"], True)
        identity = state_dry["sourceIdentity"]
        narrator = next(r for r in records if r["sessionId"] == case["sessionId"] and r["floorId"] == body["floorId"] and r["purpose"] == "narration" and r["status"] == "succeeded")
        for field, record_field in [("runId", "runId"), ("attemptNo", "attemptNo"), ("outputPageId", "outputPageId"), ("assistantMessageId", "outputMessageId")]:
            check(label, "source_" + field, identity[field], narrator[record_field])
        check(label, "generated_text_equals_saved_model_text", body["generatedText"], narrator["text"])
        provider_file = next(f for f in OUT.glob(f"*-{body_label}-provider-response.json"))
        raw = read(provider_file.name)["text"]
        chunks = [json.loads(line[6:]) for line in raw.splitlines() if line.startswith("data: {")]
        text = "".join(c.get("delta", {}).get("content", "") or "" for value in chunks for c in value.get("choices", []))
        check(label, "raw_stream_equals_saved_model_text", text, narrator["text"])
        public = [{"messageId": m["id"], "role": m["role"], "text": m["content"]} for m in inspected["messages"]]
        sources = [{k: s[k] for k in ["messageId", "role", "text"]} for s in state_dry["sources"]]
        check(label, "public_saved_text_equals_state_evidence", sources, public)
        evidence_message = next(m["content"] for m in state_dry["messages"] if '{"sources":' in m["content"])
        evidence = json.JSONDecoder().raw_decode(evidence_message[evidence_message.index('{"sources":'):])[0]
        check(label, "saved_body_worldbook_entry_records", evidence["worldbookSelection"]["entries"], body["promptSnapshot"]["worldbookActivatedEntries"])
        check(label, "saved_body_worldbook_entry_uids", evidence["worldbookSelection"]["entryUids"], body["promptSnapshot"]["worldbookActivatedEntryUids"])
        check(label, "fixed_state_preset_version", state_dry["preset"]["presetVersionId"], case["releaseInput"]["statePresetVersionId"])
        prior.append({"floorId": body["floorId"], "floorNo": body["floorNo"], "before": state_dry["before"], "after": state["variables"], "snapshotId": state["snapshotId"]})
        previous = state

current_stage = "corrected"
check("corrected", "required_complete_samples", sorted(s["case"] for s in samples if s["stage"] == "corrected"), sorted(read("source-stages.json")["corrected"]["requiredCases"]))
current_stage = "budget"
budget = read("budget.json")
check("budget", "actual_plus_unresolved_reservations_within_authorization", budget["actualUsd"] + budget["reservedUsd"] <= 1, True)
check("budget", "request_cap", len(budget["calls"]) <= read("configuration.json")["maximumRequests"], True)
historical_defects = [c for c in checks if not c["passed"] and c["stage"] == "baseline" and c["check"] == "saved_body_worldbook_entry_records"]
current_failures = [c for c in checks if not c["passed"] and c not in historical_defects]
result = {"stageSampleCounts": {stage: sum(s["stage"] == stage for s in samples) for stage in ["baseline", "corrected"]}, "stageCheckCounts": {stage: sum(c["stage"] == stage for c in checks) for stage in ["baseline", "corrected", "budget"]}, "historicalDefectCount": len(historical_defects), "currentFailureCount": len(current_failures), "scope": "deterministic structure and transport evidence; semantic conclusions require manual reading", "passed": sum(c["passed"] for c in checks), "failed": sum(not c["passed"] for c in checks), "checks": checks}
(OUT / "verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({k: result[k] for k in ["passed", "failed"]}))
for item in checks:
    if not item["passed"]:
        print(item["case"], item["check"])
raise SystemExit(bool(current_failures))
