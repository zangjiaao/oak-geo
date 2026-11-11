import { catalogHandlers } from "./catalog-handlers.mjs";
import { samplingHandlers } from "./sampling-handlers.mjs";
import { archiveHandlers } from "./archive-handlers.mjs";
import { contentHandlers } from "./content-handlers.mjs";
import { seedHandlers } from "./seed-handlers.mjs";
export function createDomainHandlers() {
  const registry = {};
  for (const group of [
    catalogHandlers(),
    samplingHandlers(),
    contentHandlers(),
    archiveHandlers(),
    seedHandlers(),
  ])
    for (const [id, handler] of Object.entries(group)) {
      if (Object.hasOwn(registry, id))
        throw new Error("duplicate operation registration: " + id);
      registry[id] = handler;
    }
  return Object.freeze(registry);
}
