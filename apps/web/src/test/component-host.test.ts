import { afterEach, describe, expect, it } from "vitest";
import {
  defineComponent,
  h,
  nextTick,
  ref,
  shallowRef,
  Teleport,
  vModelText,
  withDirectives,
  type VNode,
} from "vue";
import { ComponentNode, mountComponent } from "./component-host.js";

const hosts: ReturnType<typeof mountComponent>[] = [];
function defineTestComponent(setup: () => () => VNode) {
  return defineComponent({ setup });
}
const emptyComponent = defineTestComponent(() => () => h("div"));

afterEach(() => {
  for (const host of hosts.splice(0)) host.unmount();
});

describe("in-memory component host", () => {
  it("returns the node itself for an independent node", () => {
    const node = new ComponentNode("INPUT");
    expect(node.getRootNode()).toBe(node);
  });

  it("returns the mount root through nested elements", () => {
    const host = mountComponent(
      defineTestComponent(() => () => h("div", [h("section", [h("input")])])),
      {},
    );
    hosts.push(host);
    const field = host.all((node) => node.tagName === "INPUT")[0]!;
    expect(field.getRootNode()).toBe(host.root);
    expect(host.root.getRootNode()).toBe(host.root);
    expect(host.root).not.toBeInstanceOf(Document);
    expect(host.root).not.toBeInstanceOf(ShadowRoot);
  });

  it("follows renderer moves and removals between separate roots", async () => {
    const first = mountComponent(emptyComponent, {});
    const second = mountComponent(emptyComponent, {});
    hosts.push(first, second);
    const target = shallowRef(first.root);
    const visible = ref(true);
    const host = mountComponent(
      defineTestComponent(
        () => () =>
          h(Teleport, { to: target.value }, visible.value ? [h("input")] : []),
      ),
      {},
    );
    hosts.push(host);
    const field = first.all((node) => node.tagName === "INPUT")[0]!;
    expect(field.getRootNode()).toBe(first.root);

    target.value = second.root;
    await nextTick();
    expect(first.all((node) => node.tagName === "INPUT")).toHaveLength(0);
    expect(second.all((node) => node.tagName === "INPUT")).toEqual([field]);
    expect(field.getRootNode()).toBe(second.root);

    visible.value = false;
    await nextTick();
    expect(field.parent).toBeNull();
    expect(field.getRootNode()).toBe(field);
  });

  it("detaches children when replacing element text", () => {
    const host = mountComponent(
      defineTestComponent(() => () => h("div", [h("input")])),
      {},
    );
    hosts.push(host);
    const parent = host.all((node) => node.tagName === "DIV")[0]!;
    const field = host.all((node) => node.tagName === "INPUT")[0]!;

    parent.textContent = "replacement";
    expect(parent.children).toHaveLength(0);
    expect(field.getRootNode()).toBe(field);
  });

  it.each(["input", "textarea"])(
    "updates a real vModelText %s from initial value through input to model reset",
    async (tag) => {
      const model = ref("initial");
      const component = defineTestComponent(
        () => () =>
          withDirectives(
            h(tag, {
              "onUpdate:modelValue": (value: string) => {
                model.value = value;
              },
            }),
            [[vModelText, model.value]],
          ),
      );
      const host = mountComponent(component, {});
      hosts.push(host);
      const field = host.all((node) => node.tagName === tag.toUpperCase())[0]!;

      expect(field.value).toBe("initial");
      field.value = "edited";
      field.dispatchEvent(new Event("input"));
      await nextTick();
      expect(model.value).toBe("edited");

      model.value = "";
      await nextTick();
      expect(field.value).toBe("");
    },
  );
});
