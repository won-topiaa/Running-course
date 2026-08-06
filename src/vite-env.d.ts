/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KAKAO_JS_KEY?: string;
  readonly VITE_ORS_API_KEY?: string;
  readonly VITE_MAPBOX_TOKEN?: string;
  readonly VITE_STRAVA_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
