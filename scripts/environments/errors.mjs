export class EnvironmentError extends Error {
  constructor(message, exitCode = 2, details = {}) {
    super(message);
    this.name = "EnvironmentError";
    this.exitCode = exitCode;
    this.details = details;
  }
}
