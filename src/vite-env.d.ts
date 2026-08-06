/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KAKAO_JS_KEY?: string;
  readonly VITE_ORS_API_KEY?: string;
  readonly VITE_MAPBOX_TOKEN?: string;
  readonly VITE_STRAVA_WORKER_URL?: string;
  readonly VITE_SYNC_WORKER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
