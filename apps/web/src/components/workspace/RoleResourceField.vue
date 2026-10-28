<script setup lang="ts">
import { parseResourceField } from "../../lib/role-resource-field.js";
import config from "../../config/role-resource-fields.json";
const props = defineProps<{ field: string[]; modelValue: unknown }>();
const emit = defineEmits<{
  "update:modelValue": [value: unknown];
  validity: [valid: boolean];
}>();
const textValue = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);
const enums = config.enums as Record<string, Array<Array<string | number>>>;
function update(event: Event) {
  const input = event.target as HTMLInputElement;
  try {
    const kind = props.field[2];
    const value = parseResourceField(
      kind ?? "text",
      input.value,
      input.checked,
      props.modelValue,
    );
    emit("update:modelValue", value);
    emit("validity", true);
  } catch {
    emit("validity", false);
  }
}
</script>
<template>
  <fieldset v-if="field[2] === 'placements'" class="placement-fields">
    <legend>{{ field[1] }}</legend>
    <label v-for="option in config.placements" :key="String(option[0])"
      ><input
        type="checkbox"
        :checked="Array.isArray(modelValue) && modelValue.includes(option[0])"
        @change="
          emit(
            'update:modelValue',
            ($event.target as HTMLInputElement).checked
              ? [...(Array.isArray(modelValue) ? modelValue : []), option[0]]
              : (Array.isArray(modelValue) ? modelValue : []).filter(
                  (value) => value !== option[0],
                ),
          )
        "
      />
      {{ option[1] }}</label
    >
  </fieldset>
  <label v-else class="field"
    >{{ field[1] }}
    <textarea
      v-if="field[2] === 'area' || field[2] === 'json'"
      :rows="field[2] === 'json' ? 5 : 6"
      :value="
        field[2] === 'json'
          ? JSON.stringify(modelValue ?? null, null, 2)
          : textValue(modelValue)
      "
      @input="update"
    />
    <input
      v-else-if="field[2] === 'check'"
      type="checkbox"
      :checked="Boolean(modelValue)"
      @change="update"
    />
    <select
      v-else-if="enums[field[2] ?? '']"
      :value="textValue(modelValue)"
      @change="update"
    >
      <option
        v-for="option in enums[field[2] ?? '']"
        :key="String(option[0])"
        :value="option[0]"
      >
        {{ option[1] }}
      </option>
    </select>
    <input
      v-else
      :type="
        ['number', 'nullableNumber'].includes(field[2] ?? '')
          ? 'number'
          : field[2] === 'password'
            ? 'password'
            : 'text'
      "
      :value="textValue(modelValue)"
      @input="update"
    />
  </label>
</template>
