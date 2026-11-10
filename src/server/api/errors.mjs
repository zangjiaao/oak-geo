export class ServiceError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export function validation(message, details = {}) {
  return new ServiceError(422, "validation_failed", message, details);
}
export function permission(message = "permission denied") {
  return new ServiceError(403, "permission_denied", message);
}
export function normalizeDatabaseError(error) {
  if (error instanceof ServiceError) return error;
  if (error.code === "23505")
    return new ServiceError(409, "state_conflict", "record already exists");
  if (
    [
      "23502",
      "23503",
      "23514",
      "22P02",
      "22007",
      "22008",
      "22003",
      "22001",
    ].includes(error.code)
  )
    return validation("database constraint rejected operation", {
      constraint: error.constraint ?? null,
    });
  return error;
}
