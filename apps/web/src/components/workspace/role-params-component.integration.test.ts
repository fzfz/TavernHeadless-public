import { describe, expect, it } from "vitest";
import { ref, defineComponent, h, nextTick } from "vue";
import RoleGenerationParams from "./RoleGenerationParams.vue";
import { mountComponent } from "../../test/component-host.js";
import type { RuntimeParamsResponse } from "@tavern/shared";

describe("generation parameter form events", () => {
  it("retains invalid JSON input, blocks saving and accepts correction", async () => {
    const params = ref<RuntimeParamsResponse>({ temperature: 0.7 });
    let valid = true;
    const wrapper = defineComponent(
      () => () =>
        h(RoleGenerationParams, {
          modelValue: params.value,
          "onUpdate:modelValue": (value) => {
            params.value = value;
          },
          onValidity: (value) => {
            valid = value;
          },
        }),
    );
    const host = mountComponent(wrapper, {});
    const field = host.all(
      (n) => n.tagName === "LABEL" && n.textContent.startsWith("停止序列"),
    )[0]!;
    const input = field.children.find((n) => n.tagName === "TEXTAREA")!;
    input.value = "[";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    expect(valid).toBe(false);
    expect(params.value.stop_sequences).toBeUndefined();
    expect(input.value).toBe("[");
    input.value = '["END"]';
    input.dispatchEvent(new Event("input"));
    await nextTick();
    expect(valid).toBe(true);
    expect(params.value).toEqual({ temperature: 0.7, stop_sequences: ["END"] });
    host.unmount();
  });
  it("validates numeric bounds and supports explicit false and inherited null", async () => {
    const params = ref<RuntimeParamsResponse>({ temperature: 0.7 });
    let valid = true;
    const host = mountComponent(
      defineComponent(
        () => () =>
          h(RoleGenerationParams, {
            modelValue: params.value,
            "onUpdate:modelValue": (value) => {
              params.value = value;
            },
            onValidity: (value) => {
              valid = value;
            },
          }),
      ),
      {},
    );
    const temperature = host
      .all(
        (n) => n.tagName === "LABEL" && n.textContent.startsWith("Temperature"),
      )[0]!
      .children.find((n) => n.tagName === "INPUT")!;
    temperature.value = "9";
    temperature.dispatchEvent(new Event("input"));
    await nextTick();
    expect(valid).toBe(false);
    expect(params.value.temperature).toBe(0.7);
    temperature.value = "";
    temperature.dispatchEvent(new Event("input"));
    await nextTick();
    expect(valid).toBe(true);
    expect(params.value.temperature).toBeNull();
    const stream = host
      .all(
        (n) => n.tagName === "LABEL" && n.textContent.startsWith("流式生成"),
      )[0]!
      .children.find((n) => n.tagName === "SELECT")!;
    stream.value = "false";
    stream.dispatchEvent(new Event("change"));
    await nextTick();
    expect(params.value.stream).toBe(false);
    host.unmount();
  });
  it("restores an invalid draft after leaving and reopening the parameter panel", async () => {
    const draft = ref<Record<string, string>>({});
    const visible = ref(true);
    const wrapper = defineComponent(
      () => () =>
        visible.value
          ? h(RoleGenerationParams, {
              modelValue: {},
              draft: draft.value,
              onDraft: (value) => {
                draft.value = value;
              },
            })
          : h("div"),
    );
    const host = mountComponent(wrapper, {});
    const input = () =>
      host
        .all(
          (n) => n.tagName === "LABEL" && n.textContent.startsWith("停止序列"),
        )[0]!
        .children.find((n) => n.tagName === "TEXTAREA")!;
    input().value = "[";
    input().dispatchEvent(new Event("input"));
    await nextTick();
    visible.value = false;
    await nextTick();
    visible.value = true;
    await nextTick();
    expect(input().value).toBe("[");
    expect(host.all((n) => n.props.role === "alert")).toHaveLength(1);
    host.unmount();
  });
});
