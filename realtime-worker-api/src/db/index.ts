import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export interface Env {
  DEEPGRAM_API_KEY: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  GEMINI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  APP_ORIGINS?: string;
  /** Sign-in / sign-up attempts allowed per IP per hour (0 = off). */
  LOGIN_ATTEMPTS_PER_HOUR?: string;
  SIGNUPS_PER_HOUR?: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ADMIN_EMAILS?: string;
  CF_ACCOUNT_ID?: string;
  CF_GATEWAY_ID?: string;
  CF_API_TOKEN?: string;
  DB: D1Database;
}

export const getDb = (env: { DB: D1Database }) => {
  return drizzle(env.DB, { schema });
};
