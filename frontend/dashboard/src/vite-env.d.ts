/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STDB_URI?: string;
  readonly VITE_STDB_URI_LOCAL?: string;
  readonly VITE_STDB_DATABASE?: string;
  readonly VITE_TILE_SOURCE?: string;
  readonly VITE_CARTO_KEY?: string;
}
