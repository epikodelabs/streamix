/**
 * Streamix tracing entrypoint.
 *
 * Exports the side-effect free core APIs, and (for backwards compatibility)
 * auto-installs the Streamix runtime hooks on import.
 */
import { installTracingHooks } from "./runtime";

// Auto-install hooks when module is imported
installTracingHooks();