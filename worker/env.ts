import type { EffectiveAccess } from "./repositories/access.ts";
import type { AuthUser } from "../shared/auth.ts";

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  REALTIME_MODE: string;
  ACCESS_MODE?: string;
  REALTIME_HUB: DurableObjectNamespace;
  LOGIN_RATE_LIMITER: RateLimit;
  ASSETS: Fetcher;
  RETENTION_BUCKET?: R2Bucket;
  RETENTION_ROW_LIMIT_WARNING?: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    authUser?: AuthUser;
    sessionExpiresAt?: number;
    sessionVersion?: number;
    effectiveAccess?: EffectiveAccess;
  };
}
