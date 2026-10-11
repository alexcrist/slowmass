export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  IMAGES?: ImagesBinding;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  AUTH_SECRET?: string;
  BOOTSTRAP_EMAIL?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
}
