// Adversary detections are recorded per engine because they depend on how the engine
// renders and applies interaction state. An engine without a recorded section still runs
// every check against the shared baseline, so selecting an engine never turns the suite off.
export const calibrationFor = (manifest, engine, baseline) => manifest[engine] ?? manifest[baseline];
