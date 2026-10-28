import { reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import source from "../config/role-apps.json";
import translations from "../config/role-ui-english.json";
export function useRoleLabels() {
  const { locale } = useI18n();
  const labels = reactive(structuredClone(source));
  const translate = (value: unknown): unknown => {
    if (typeof value === "string")
      return (translations as Record<string, string>)[value] ?? value;
    if (Array.isArray(value)) return value.map(translate);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, translate(entry)]),
      );
    return value;
  };
  watch(
    locale,
    () =>
      Object.assign(
        labels,
        locale.value === "en" ? translate(source) : structuredClone(source),
      ),
    { immediate: true },
  );
  return { labels, locale };
}
