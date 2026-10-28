import { createRenderer, nextTick, ssrContextKey, type Component } from "vue";
import "./component-test-environment.js";

/** In-memory Vue host for component events; native layout and focus are verified in a browser. */
export class ComponentNode extends EventTarget {
  ownerDocument = { activeElement: null };
  tabIndex = -1;
  getClientRects() {
    return [];
  }
  focus() {}
  parent: ComponentNode | null = null;
  children: ComponentNode[] = [];
  props: Record<string, unknown> = {};
  style: Record<string, unknown> = {};
  text = "";
  value: unknown = "";
  selected = false;
  checked = false;
  open = false;
  files?: File[];
  constructor(readonly tagName: string) {
    super();
  }
  getRootNode(): ComponentNode {
    let root: ComponentNode = this.parent ?? this;
    while (root.parent) root = root.parent;
    return root;
  }
  get options() {
    return this.children.filter((node) => node.tagName === "OPTION");
  }
  get textContent(): string {
    return this.text + this.children.map((node) => node.textContent).join("");
  }
  set textContent(value: string) {
    this.text = value;
    for (const child of this.children) child.parent = null;
    this.children = [];
  }
  querySelectorAll(tag: string): ComponentNode[] {
    return this.children.flatMap((node) => [
      ...(node.tagName === tag.toUpperCase() ? [node] : []),
      ...node.querySelectorAll(tag),
    ]);
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  click() {
    if (!this.props.disabled) this.dispatchEvent(new Event("click"));
  }
  removeAttribute(key: string) {
    delete this.props[key];
  }
  setAttribute(key: string, value: string) {
    this.props[key] = value;
  }
}

const renderer = createRenderer<ComponentNode, ComponentNode>({
  createElement: (tag) => new ComponentNode(tag.toUpperCase()),
  createText: (text) => Object.assign(new ComponentNode("#text"), { text }),
  createComment: (text) =>
    Object.assign(new ComponentNode("#comment"), { text }),
  setText: (node, text) => {
    node.text = text;
  },
  setElementText: (node, text) => {
    node.textContent = text;
  },
  parentNode: (node) => node.parent,
  nextSibling: (node) =>
    node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  insert: (node, parent, anchor) => {
    if (node.parent)
      node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(node);
    else parent.children.splice(index, 0, node);
  },
  remove: (node) => {
    if (node.parent)
      node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = null;
  },
  patchProp: (node, key, previous, value) => {
    node.props[key] = value;
    if (key === "value") node.value = value;
    if (key === "open") node.open = Boolean(value);
    if (/^on[A-Z]/.test(key)) {
      const event = key.slice(2).toLowerCase();
      if (previous) node.removeEventListener(event, previous);
      if (typeof value === "function") node.addEventListener(event, value);
    }
  },
});
export function mountComponent(
  component: Component,
  props: Record<string, unknown>,
) {
  const root = new ComponentNode("ROOT");
  const app = renderer.createApp(component, props);
  app.provide(ssrContextKey, { modules: new Set<string>() });
  const instance = app.mount(root);
  const all = (
    predicate: (node: ComponentNode) => boolean,
  ): ComponentNode[] => {
    const visit = (node: ComponentNode): ComponentNode[] => [
      ...(predicate(node) ? [node] : []),
      ...node.children.flatMap(visit),
    ];
    return visit(root);
  };
  return { root, all, instance, unmount: () => app.unmount() };
}
export async function settleComponent() {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await nextTick();
}
