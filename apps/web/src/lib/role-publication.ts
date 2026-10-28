import {
  roleStatePolicy,
  type CreateRoleReleaseBody,
  type RoleReleasePublic,
} from "@tavern/shared";

function equalParameter(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equalParameter(value, right[index]))
    );
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(
      ([key, value]) => Object.hasOwn(b, key) && equalParameter(value, b[key]),
    )
  );
}

export function roleConfigurationIsPublished(
  config: CreateRoleReleaseBody,
  release: RoleReleasePublic | undefined,
): boolean {
  if (!release) return false;
  return Object.entries(config).every(([key, value]) => {
    if (Object.hasOwn(roleStatePolicy.releaseFieldNames, key)) {
      const releaseKey =
        roleStatePolicy.releaseFieldNames[
          key as keyof typeof roleStatePolicy.releaseFieldNames
        ];
      return value === undefined || value === release[releaseKey];
    }
    if (key !== "model_slots")
      return value === release[key as keyof RoleReleasePublic];
    if (config.model_slots.length !== release.model_slots.length) return false;
    return config.model_slots.every((binding) => {
      const saved = release.model_slots.find(
        (slot) => slot.slot === binding.slot,
      );
      if (!saved || saved.profile_id !== binding.profile_id) return false;
      const params = binding.params ?? {},
        savedParams = saved.params ?? {};
      return (
        Object.keys(params).length === Object.keys(savedParams).length &&
        Object.entries(params).every(([name, setting]) =>
          equalParameter(
            setting,
            savedParams[name as keyof typeof savedParams],
          ),
        )
      );
    });
  });
}
