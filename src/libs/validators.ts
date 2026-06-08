import { zValidator as honoZValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

export function zValidator<T extends ZodType>(
  target: "json" | "query" | "param" | "header",
  schema: T,
) {
  return honoZValidator(target, schema, (result, c) => {
    if (!result.success) {
      throw result.error;
    }
  });
}
