import type { Context } from "hono";
import { ZodError, z } from "zod";
import { HTTPException } from "hono/http-exception";

export function handleError(c: Context, err: unknown): Response {
  if (err instanceof ZodError) {
    const details = z.flattenError(err);

    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request data",
          details: details.fieldErrors,
        },
      },
      400,
    );
  }

  if (err instanceof HTTPException) {
    return c.json(
      {
        status: err.status,
        code: getErrorCode(err.status),
        message: err.message,
        timestamp: new Date().toISOString(),
        path: c.req.path,
      },
      err.status,
    );
  }

  const isProduction = process.env.NODE_ENV === "production";
  const error = err as Error;

  return c.json(
    {
      status: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: isProduction ? "An unexpected error occurred" : error.message,
      timestamp: new Date().toISOString(),
      path: c.req.path,
      ...(isProduction ? {} : { stack: error.stack }),
    },
    500,
  );
}

function getErrorCode(status: number): string {
  const codes: Record<number, string> = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "UNPROCESSABLE_ENTITY",
    429: "TOO_MANY_REQUESTS",
    500: "INTERNAL_SERVER_ERROR",
  };
  return codes[status] || "INTERNAL_SERVER_ERROR";
}
