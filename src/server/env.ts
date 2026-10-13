export interface Env {
  DB: D1Database;
  MAINTENANCE_MODE?: string;
  PERFORMANCE_SAMPLE_RATE?: string;
  PHOTOS: R2Bucket;
  IMAGES?: ImagesBinding;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  AUTH_SECRET?: string;
  BOOTSTRAP_EMAIL?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  PUSH_PUBLIC_KEY?: string;
  PUSH_PRIVATE_KEY?: string;
}
