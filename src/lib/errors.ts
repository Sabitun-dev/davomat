// An error the user can be told about. `code` is translated by the app; `params` fill the text.

export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public params: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

export function forbidden(): AppError {
  return new AppError("forbidden", 403);
}

export function notFound(): AppError {
  return new AppError("not_found", 404);
}

export function badRequest(code = "bad_request", params: Record<string, string | number> = {}): AppError {
  return new AppError(code, 400, params);
}
