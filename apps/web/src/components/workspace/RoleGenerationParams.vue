<script setup lang="ts">
import { computed, ref } from "vue";
import {
  generationParamsJsonSchemaProperties,
  roleReleaseModelParamsSchema,
  type RuntimeParamsResponse,
} from "@tavern/shared";
import copy from "../../config/role-generation-params.json";
const props = defineProps<{
  modelValue: RuntimeParamsResponse | null | undefined;
  draft?: Record<string, string>;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: RuntimeParamsResponse];
  validity: [valid: boolean];
  draft: [value: Record<string, string>];
}>();
const invalid = ref(new Set(Object.keys(props.draft ?? {})));
const invalidInput = ref<Record<string, string>>({ ...props.draft });
const fields = computed(() =>
  Object.entries(generationParamsJsonSchemaProperties).map(([key, schema]) => {
    const type = "type" in schema ? schema.type[0] : "object";
    return {
      key,
      type,
      schema,
      label: copy.fields[key as keyof typeof copy.fields],
      options: "enum" in schema ? schema.enum : [],
    };
  }),
);
function text(key: string) {
  if (key in invalidInput.value) return invalidInput.value[key];
  const value = props.modelValue?.[key as keyof RuntimeParamsResponse];
  return value == null
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value, null, 2)
      : String(value);
}
function update(key: string, type: string, event: Event) {
  const input = (event.target as HTMLInputElement).value;
  try {
    const value =
      input === ""
        ? null
        : ["object", "array"].includes(type)
          ? JSON.parse(input)
          : type === "boolean"
            ? input === "true"
            : ["integer", "number"].includes(type)
              ? Number(input)
              : input;
    const parsed = roleReleaseModelParamsSchema.parse({
      ...props.modelValue,
      [key]: value,
    });
    invalid.value.delete(key);
    delete invalidInput.value[key];
    emit("update:modelValue", parsed);
  } catch {
    invalid.value.add(key);
    invalidInput.value[key] = input;
  }
  emit("draft", { ...invalidInput.value });
  emit("validity", invalid.value.size === 0);
}
</script>
<template>
  <div class="editor-fields">
    <label v-for="field in fields" :key="field.key" class="field"
      >{{ field.label }}
      <textarea
        v-if="['object', 'array'].includes(field.type)"
        :value="text(field.key)"
        :aria-invalid="invalid.has(field.key)"
        @input="update(field.key, field.type, $event)"
      />
      <select
        v-else-if="field.type === 'boolean' || field.options.length"
        :value="text(field.key)"
        @change="update(field.key, field.type, $event)"
      >
        <option value="">{{ copy.inherit }}</option>
        <template v-if="field.type === 'boolean'"
          ><option value="true">{{ copy.enabled }}</option>
          <option value="false">{{ copy.disabled }}</option></template
        >
        <option
          v-for="option in field.options.filter((item) => item !== null)"
          v-else
          :key="String(option)"
          :value="option"
        >
          {{ option }}
        </option>
      </select>
      <input
        v-else
        type="number"
        :value="text(field.key)"
        :step="field.type === 'integer' ? 1 : 'any'"
        :aria-invalid="invalid.has(field.key)"
        @input="update(field.key, field.type, $event)"
      />
      <span v-if="invalid.has(field.key)" role="alert">{{ copy.invalid }}</span>
    </label>
  </div>
</template>
