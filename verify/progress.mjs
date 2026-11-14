export function formatProgress(done, total, id, level, seconds, cached = false) {
  const cachedSuffix = cached ? " (cached)" : "";
  return `[${done}/${total}] ${id} ${level} ${seconds}s${cachedSuffix}`;
}

export function formatHeartbeat(inFlight, total) {
  const items = inFlight.map(({ id, level, seconds }) => `${id} (${level}) ${seconds}s`).join(", ");
  return `still running ${inFlight.length} of ${total}: ${items}`;
}
