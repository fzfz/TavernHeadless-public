export function errorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    if ('status' in error && typeof error.status === 'number') return error.status;
    if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode;
  }
  return undefined;
}

export function isUncertainWrite(error: unknown): boolean {
  const status = errorStatus(error);
  return status === undefined || status === 408 || status >= 500;
}
