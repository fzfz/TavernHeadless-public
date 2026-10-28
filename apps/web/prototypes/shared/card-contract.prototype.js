// The same contract implementation is used by the browser and the isolated server.
(function (global) {
  function check(value, schema, root = schema, path = "$") {
    if (schema.$ref)
      return check(
        value,
        root.definitions[schema.$ref.split("/").at(-1)],
        root,
        path,
      );
    if (schema.oneOf) {
      const count = schema.oneOf.filter(
        (x) => !check(value, x, root, path),
      ).length;
      if (count !== 1) return path + ": oneOf";
    }
    if (schema.const !== undefined && value !== schema.const)
      return path + ": const";
    if (schema.enum && !schema.enum.includes(value)) return path + ": enum";
    const type = Array.isArray(value)
      ? "array"
      : value === null
        ? "null"
        : typeof value;
    if (
      schema.type &&
      !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(
        (t) => t === type || (t === "integer" && Number.isInteger(value)),
      )
    )
      return path + ": type " + JSON.stringify(schema.type);
    if (schema.type === "object") {
      for (const k of schema.required || [])
        if (!(k in value)) return path + "." + k + ": required";
      for (const [k, v] of Object.entries(value)) {
        const def = schema.properties?.[k] ?? schema.additionalProperties;
        if (def === false) return path + "." + k + ": unknown";
        if (def && typeof def === "object") {
          const e = check(v, def, root, path + "." + k);
          if (e) return e;
        }
      }
    }
    if (schema.type === "array") {
      if (schema.minItems && value.length < schema.minItems)
        return path + ": minItems";
      for (let i = 0; schema.items && i < value.length; i++) {
        const e = check(value[i], schema.items, root, path + "[" + i + "]");
        if (e) return e;
      }
    }
    if (schema.minLength && value.length < schema.minLength)
      return path + ": minLength";
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      return path + ": pattern";
    if (schema.minimum !== undefined && value < schema.minimum)
      return path + ": minimum";
    if (schema.maximum !== undefined && value > schema.maximum)
      return path + ": maximum";
    return "";
  }
  function value(x, ctx) {
    return x.source === "literal"
      ? x.value
      : x.source === "item" && !x.key
        ? ctx.item
        : ctx[x.source]?.[x.key];
  }
  function condition(c, ctx) {
    if (!c) return true;
    if (c.op === "and") return c.args.every((x) => condition(x, ctx));
    if (c.op === "or") return c.args.some((x) => condition(x, ctx));
    if (c.op === "not") return !condition(c.arg, ctx);
    const a = value(c.left, ctx),
      b = value(c.right, ctx);
    if (
      ["gt", "gte", "lt", "lte"].includes(c.op) &&
      (typeof a !== "number" || typeof b !== "number")
    )
      return false;
    return {
      eq: () => a === b,
      ne: () => a !== b,
      gt: () => a > b,
      gte: () => a >= b,
      lt: () => a < b,
      lte: () => a <= b,
    }[c.op]();
  }
  function variables(pkg, vars) {
    if (!vars || typeof vars !== "object") return 'variables: type "object"';
    for (const k of Object.keys(vars))
      if (!pkg.variables[k]) return "variables." + k + ": unknown";
    for (const [k, def] of Object.entries(pkg.variables)) {
      const e = check(vars[k], def, def, "variables." + k);
      if (e) return e;
    }
    let resourceIssue = "";
    function resources(n, item) {
      const ctx = {
        view: vars,
        current: vars,
        ui: pkg.ui,
        read: { text: "", index: 0, count: 0, auto: false, music: false },
        item,
      };
      if (n.value && value(n.value, ctx) === undefined)
        resourceIssue = n.id + ": required binding";
      if (
        n.type === "image" &&
        pkg.assets[value(n.value, ctx)]?.kind !== "image"
      )
        resourceIssue = n.id + ": image asset";
      if (n.type === "repeat") {
        const items = value(n.value, ctx);
        if (!Array.isArray(items)) {
          resourceIssue = n.id + ": array required";
          return;
        }
        items.forEach((member) =>
          (n.children || []).forEach((c) => resources(c, member)),
        );
      } else (n.children || []).forEach((c) => resources(c, item));
    }
    resources(pkg.tree);
    return resourceIssue;
  }
  function validate(pkg, schema) {
    const structural = check(pkg, schema);
    if (structural) return structural;
    if (pkg.assets[pkg.avatar]?.kind !== "image") return "avatar: image asset";
    const initial = variables(pkg, pkg.initial);
    if (initial) return initial;
    const ids = new Set(),
      slots = [];
    let error = "";
    const expression = (x, allowed) => {
      if (!x) {
        error = "value: required";
        return;
      }
      if (allowed && !allowed.includes(x.source))
        error = "value.source: unsupported for chat";
      if (x.source === "literal") {
        if (!("value" in x)) error = "literal.value: required";
        return;
      }
      if (x.source === "item") return;
      if (!x.key) error = "value.key: required";
      const keys =
        x.source === "ui"
          ? pkg.ui
          : x.source === "read"
            ? { text: 1, index: 1, count: 1, auto: 1, music: 1 }
            : pkg.variables;
      if (!(x.key in keys)) error = "value.key: " + x.key;
    };
    const predicate = (c, allowed) => {
      if (!c) return;
      if (c.args) c.args.forEach((x) => predicate(x, allowed));
      else if (c.arg) predicate(c.arg, allowed);
      else {
        expression(c.left, allowed);
        expression(c.right, allowed);
      }
    };
    for (const [id, a] of Object.entries(pkg.actions)) {
      predicate(
        a.when,
        a.type.startsWith("chat.") ? ["current", "literal"] : undefined,
      );
      if (a.type === "ui.toggle" && typeof pkg.ui[a.target] !== "boolean")
        error = id + ": ui target";
      if (a.type.startsWith("chat."))
        expression(a.text, ["literal", "current"]);
      if (a.type === "reading.auto" && !a.intervalMs)
        error = id + ": intervalMs";
      if (a.type === "audio.toggle" && pkg.assets[a.asset]?.kind !== "audio")
        error = id + ": audio asset";
    }
    function visit(n) {
      if (ids.has(n.id)) error = n.id + ": duplicate id";
      ids.add(n.id);
      predicate(n.when);
      Object.values(n.classWhen || {}).forEach((c) => predicate(c));
      if (["text", "image", "meter", "button", "repeat"].includes(n.type))
        expression(n.value);
      if (
        n.type === "image" &&
        n.value?.source === "literal" &&
        !pkg.assets[n.value.value]
      )
        error = n.id + ": image asset";
      if (n.type === "meter" && !(n.max > n.min))
        error = n.id + ": meter range";
      if (n.type === "button" && !pkg.actions[n.action])
        error = n.id + ": action";
      if (n.type === "slot") slots.push(n.name);
      (n.children || []).forEach(visit);
    }
    visit(pkg.tree);
    if (
      slots.length !== 2 ||
      !slots.includes("composer") ||
      !slots.includes("history")
    )
      error = "slots: history/composer";
    return error;
  }
  function explain(issue) {
    const [path, ...parts] = issue.split(": ");
    let detail = parts.join(": ");
    const code = detail.split(" ")[0];
    if (code === "type") {
      const expected = JSON.parse(detail.slice(5));
      detail = (Array.isArray(expected) ? expected : [expected])
        .map((t) => global.CardErrors.types[t])
        .join("或");
    }
    const template =
      global.CardErrors[code] || global.CardErrors.CONFIG_INVALID;
    return template.replace("{path}", path).replace("{detail}", detail);
  }
  global.CardContract = {
    check,
    value,
    condition,
    variables,
    validate,
    explain,
  };
})(globalThis);
