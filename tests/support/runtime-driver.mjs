import { startRuntimeEnvironment } from "./runtime-environment.mjs";
import { createFixtureRegistry } from "./fixture-registry.mjs";
export async function createDriver() {
  const environment = await startRuntimeEnvironment();
  const application = environment.application;
  const registry = createFixtureRegistry(application, {
    clock: environment.clock,
  });
  return Object.freeze({
    layer: "server/api",
    fixture: (name, options) => registry.fixture(name, options),
    call: (id, request) => application.call(id, request),
    registeredOperations: () => application.registeredOperations(),
    prepareAuthorizedRequest: (id) => registry.prepareAuthorizedRequest(id),
    close: () => environment.close(),
  });
}
