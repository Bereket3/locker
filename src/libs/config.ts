import z from "zod";
import { createLogger } from "./logger.js";
import "dotenv/config";

const config = z.object({
  DATABASE_URL: z.string(),
  POSTGRES_USER: z.string(),
  POSTGRES_PASSWORD: z.string(),
  POSTGRES_DB: z.string(),
  POSTGRES_PORT: z.coerce.number().default(5432),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string(),
  REFRESH_TOKEN_EXPIRES_IN: z.string(),
});

export type Env = z.infer<typeof config>;

function validateEnv(): Env {
  const result = config.safeParse(process.env);

  if (!result.success) {
    const flattened = z.flattenError(result.error);
    const entry = {
      timestamp: new Date().toISOString(),
      level: "error",
      message: "Invalid environment variables",
      fieldErrors: flattened.fieldErrors,
      formErrors: flattened.formErrors,
    };
    const logger = createLogger("ENV");
    logger.error(JSON.stringify(entry));
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
