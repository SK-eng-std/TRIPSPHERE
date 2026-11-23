export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  JWT_SECRET?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  APP_ORIGIN?: string;
  /** Optional: enables Google Places API (New) for ratings, prices, hours and photos. */
  GOOGLE_PLACES_API_KEY?: string;
  /** Identifies this deployment to Nominatim (usage policy requires a real contact). */
  GEO_USER_AGENT?: string;
  OVERPASS_URL?: string;
}

export type AppEnv = { Bindings: Env };

export interface SessionUser {
  id: number;
  name: string;
  email: string;
}
