import { costOf } from "./costs.mjs";

export function assign(ids, costs = {}, count = 1) {
  if (!count || count <= 1) return [ids.slice()];
  const shards = Array.from({ length: count }, () => ({ cost: 0, items: [] }));
  const sorted = [...ids].sort((a, b) => {
    const costA = costOf(a, costs);
    const costB = costOf(b, costs);
    if (costB !== costA) return costB - costA;
    const idA = typeof a === "string" ? a : (a?.id ?? "");
    const idB = typeof b === "string" ? b : (b?.id ?? "");
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });
  for (const item of sorted) {
    let lightest = shards[0];
    for (let i = 1; i < shards.length; i++) {
      if (shards[i].cost < lightest.cost) lightest = shards[i];
    }
    lightest.items.push(item);
    lightest.cost += costOf(item, costs);
  }
  return shards.map((shard) => shard.items);
}

export function shardSlice(items, shard, costs = {}) {
  if (!shard || !shard.count || shard.count <= 1) return items;
  const shards = assign(items, costs, shard.count);
  return shards[shard.index] ?? [];
}

export function assignShards(items, count, costs = {}) {
  return assign(items, costs, count);
}
