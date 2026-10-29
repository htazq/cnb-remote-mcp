/** Single source of version truth (package.json is the fallback at runtime). */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let version = "0.0.0";
try {
  version = (require("../package.json") as { version?: string }).version ?? version;
} catch {
  // bundled context without package.json access
}

export const VERSION = version;
export const SERVER_NAME = "cnb-remote-mcp";
