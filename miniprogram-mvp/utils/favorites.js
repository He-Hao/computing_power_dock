// 本机收藏缓存；云端权威数据在 users.favoriteResources / favoriteDemands（经 tradeApi 同步）
const FAVORITES_KEY = "compute_trade_favorites"
const MAX_FAVORITES = 200

function readStore() {
  var raw = wx.getStorageSync(FAVORITES_KEY)
  if (!raw || typeof raw !== "object") {
    return { resources: [], demands: [] }
  }
  return {
    resources: Array.isArray(raw.resources) ? raw.resources : [],
    demands: Array.isArray(raw.demands) ? raw.demands : []
  }
}

function writeStore(store) {
  wx.setStorageSync(FAVORITES_KEY, {
    resources: store.resources || [],
    demands: store.demands || []
  })
}

function isResourceId(listingId) {
  var id = String(listingId || "")
  return id.indexOf("RES-") === 0 || id.indexOf("URES-") === 0
}

function getPoolKey(listingId) {
  return isResourceId(listingId) ? "resources" : "demands"
}

function normalizeIds(list) {
  var seen = {}
  var result = []
  ;(list || []).forEach(function(id) {
    if (!id || seen[id]) {
      return
    }
    seen[id] = true
    result.push(id)
  })
  return result
}

function getFavoriteIds(pool) {
  var store = readStore()
  if (pool === "resource" || pool === "resources") {
    return store.resources.slice()
  }
  if (pool === "demand" || pool === "demands") {
    return store.demands.slice()
  }
  return store.resources.concat(store.demands)
}

function isFavorite(listingId) {
  if (!listingId) {
    return false
  }
  var store = readStore()
  var poolKey = getPoolKey(listingId)
  return store[poolKey].indexOf(listingId) > -1
}

function toggleFavorite(listingId) {
  if (!listingId) {
    return { ok: false, favorited: false }
  }
  var store = readStore()
  var poolKey = getPoolKey(listingId)
  var list = store[poolKey].slice()
  var index = list.indexOf(listingId)
  var favorited = false
  if (index > -1) {
    list.splice(index, 1)
  } else {
    list.unshift(listingId)
    favorited = true
  }
  store[poolKey] = normalizeIds(list).slice(0, MAX_FAVORITES)
  writeStore(store)
  return { ok: true, favorited: favorited }
}

function getFavoriteCount() {
  var store = readStore()
  return store.resources.length + store.demands.length
}

function getStoreSnapshot() {
  return readStore()
}

function applyStoreSnapshot(store) {
  writeStore(store || { resources: [], demands: [] })
}

function clearFavorites() {
  wx.removeStorageSync(FAVORITES_KEY)
}

module.exports = {
  FAVORITES_KEY,
  getFavoriteIds,
  isFavorite,
  toggleFavorite,
  getFavoriteCount,
  clearFavorites,
  getPoolKey,
  getStoreSnapshot,
  applyStoreSnapshot
}
