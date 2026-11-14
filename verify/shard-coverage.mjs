import { shardSlice } from "../corpus/sharding.mjs";

export function expectedShardDocuments({ manifest = [], selection = [], tier = "smoke", shard, costs = {}, filter, upstream = true }) {
  const filteredManifest = manifest.filter((entry) => tier === "full" || entry.tier === tier);
  const handWritten = shardSlice(filteredManifest, shard, costs);
  const filteredSelection = upstream
    ? selection
        .filter((entry) => tier === "full" || entry.tier === tier)
        .map((entry) => ({ ...entry, browser: true, expect: { outcome: "accepts" } }))
    : [];
  const upstreamDocs = shardSlice(filteredSelection, shard, costs);
  const combined = [...handWritten, ...upstreamDocs];
  if (!filter) return combined;
  const regex = filter instanceof RegExp ? filter : new RegExp(filter);
  return combined.filter((doc) => regex.test(doc.id));
}

export function checkShardCoverage({ expected = [], results = [], shard, browser = false }) {
  const position = shard?.position ?? (shard?.index != null ? shard.index + 1 : 1);
  const count = shard?.count ?? 1;
  const expectedMap = new Map(expected.map((doc) => [doc.id, doc]));
  const seen = new Set(results.map((r) => r.id));
  const browserSeen = new Set(results.filter((r) => r.browser).map((r) => r.id));

  const missing = [...expectedMap.keys()].filter((id) => !seen.has(id)).sort();
  const extra = [...seen].filter((id) => !expectedMap.has(id)).sort();
  const missingBrowser = browser
    ? [...expectedMap.values()]
        .filter((doc) => doc.browser !== false && !browserSeen.has(doc.id))
        .map((doc) => doc.id)
        .sort()
    : [];

  const verified = expected.filter((doc) => seen.has(doc.id) && (!browser || doc.browser === false || browserSeen.has(doc.id)));
  const verifiedCount = verified.length;
  const expectedCount = expected.length;

  const problems = [];
  if (missing.length > 0) {
    problems.push(`missing ${missing.length} assigned documents: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    problems.push(`extra ${extra.length} unassigned documents: ${extra.join(", ")}`);
  }
  if (missingBrowser.length > 0) {
    problems.push(`missing browser comparison for ${missingBrowser.length} assigned documents: ${missingBrowser.join(", ")}`);
  }

  const ok = problems.length === 0;
  const message = `Shard ${position}/${count}: ${verifiedCount} of ${expectedCount} assigned documents verified`;

  return {
    ok,
    missing,
    extra,
    missingBrowser,
    verifiedCount,
    expectedCount,
    message,
    problems,
  };
}
