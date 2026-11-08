/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STDB_URI?: string;
  readonly VITE_STDB_URI_LOCAL?: string;
  readonly VITE_STDB_DATABASE?: string;
  readonly VITE_GLASSES_PAGE_URL?: string;
  readonly VITE_GLASSES_WS_URL?: string;
}
