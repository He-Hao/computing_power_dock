/** 公开展示池筛选参数：客户端 ↔ 云函数 listListings 共用结构 */

function normalizePoolFilters(raw) {
  raw = raw || {}
  return {
    keyword: String(raw.keyword || "").trim(),
    activeType: raw.activeType || "全部",
    activeRegion: raw.activeRegion || "全部",
    activeCert: raw.activeCert || "all",
    activeTime: raw.activeTime || "all",
    activeDeliveryKind: raw.activeDeliveryKind || "all",
    sortBy: raw.sortBy === "latest" ? "latest" : "match"
  }
}

function buildPoolFilterKey(filters) {
  return JSON.stringify(normalizePoolFilters(filters))
}

function hasServerPoolFilters(filters) {
  var normalized = normalizePoolFilters(filters)
  return !!(
    normalized.keyword
    || normalized.activeType !== "全部"
    || normalized.activeRegion !== "全部"
    || normalized.activeCert !== "all"
    || normalized.activeTime !== "all"
    || normalized.activeDeliveryKind !== "all"
    || normalized.sortBy === "latest"
  )
}

module.exports = {
  normalizePoolFilters: normalizePoolFilters,
  buildPoolFilterKey: buildPoolFilterKey,
  hasServerPoolFilters: hasServerPoolFilters
}
