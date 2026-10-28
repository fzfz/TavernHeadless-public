export type PendingRegistration = {
  operationId: string;
  name: string;
  email: string;
};
const registrationKey = "user-web:registration-pending";
export function readPendingRegistration(): PendingRegistration | null {
  try {
    const raw: unknown = JSON.parse(
      sessionStorage.getItem(registrationKey) || "null",
    );
    if (
      raw &&
      typeof raw === "object" &&
      "operationId" in raw &&
      typeof raw.operationId === "string" &&
      "name" in raw &&
      typeof raw.name === "string" &&
      "email" in raw &&
      typeof raw.email === "string"
    )
      return { operationId: raw.operationId, name: raw.name, email: raw.email };
  } catch {
    /* An unavailable draft does not contain a recoverable operation. */
  }
  return null;
}
export function savePendingRegistration(pending: PendingRegistration): void {
  sessionStorage.setItem(registrationKey, JSON.stringify(pending));
}
export function clearPendingRegistration(operationId: string): void {
  if (readPendingRegistration()?.operationId === operationId)
    sessionStorage.removeItem(registrationKey);
}
