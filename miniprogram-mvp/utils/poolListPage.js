/** 资源/需求池列表页共用：前端分页 + 云端公池续拉 */
function getPoolSide(pageInstance) {
  return pageInstance._poolSide || "resource"
}

function getCloudPoolName(pageInstance) {
  return getPoolSide(pageInstance) === "demand" ? "demand" : "resource"
}

function getAllPoolItems(data, pageInstance) {
  return getPoolSide(pageInstance) === "demand" ? data.getDemands() : data.getResources()
}

function buildPagedPoolPatch(pageInstance, fullItems, options) {
  const pagedList = require("./pagedList")
  const data = require("./data")
  options = options || {}
  var pool = getCloudPoolName(pageInstance)
  var meta = data.getPublicListingsMeta(pool)
  var prevCount = options.extendPage ? pagedList.getListLength(pageInstance, "items") : -1
  var patch = pagedList.applyPage(fullItems, pageInstance, {
    reset: options.extendPage ? false : (options.reset !== false && !options.keepDisplayPage),
    extendPage: !!options.extendPage,
    displayPage: options.displayPage
  })
  patch.cloudHasMore = !!(meta && meta.hasMore)
  if (options.extendPage && prevCount >= 0) {
    pagedList.attachEnterAnimation(patch, prevCount)
    pagedList.scheduleClearEnterAnimation(pageInstance)
  }
  return patch
}

function onPoolReachBottom(pageInstance) {
  const pagedList = require("./pagedList")
  const data = require("./data")
  return pagedList.runLoadMore(pageInstance, {
    onCloudLoad: function() {
      var pool = getCloudPoolName(pageInstance)
      var fetchOptions = {}
      if (typeof pageInstance.buildFilterOptions === "function") {
        fetchOptions.filters = pageInstance.buildFilterOptions()
      }
      return data.loadMorePublicListings(pool, fetchOptions).then(function() {
        var meta = data.getPublicListingsMeta(pool)
        pageInstance.setData({
          allItems: getAllPoolItems(data, pageInstance),
          cloudHasMore: !!(meta && meta.hasMore)
        })
        if (typeof pageInstance.rebuildFilteredPoolItems === "function") {
          pageInstance.rebuildFilteredPoolItems({ extendPage: true })
        }
      }).catch(function(error) {
        console.warn("公开展示池加载更多失败", error)
        wx.showToast({ title: "加载更多失败", icon: "none" })
      })
    }
  })
}

/** 资源/需求/收藏池：防抖 + 失败可感知（仍保留本地缓存展示） */
function refreshPoolFromCloud(pageInstance, options) {
  options = options || {}
  const data = require("./data")
  if (!data.isCloudEnabled()) {
    return Promise.resolve()
  }
  var force = !!options.force
  var now = Date.now()
  if (!force && (pageInstance._poolRefreshing || now - (pageInstance._lastPoolRefresh || 0) < 15000)) {
    return Promise.resolve()
  }
  pageInstance._poolRefreshing = true
  return data.refreshPoolPagesFromCloud().then(function() {
    pageInstance._lastPoolRefresh = Date.now()
    if (typeof options.onSynced === "function") {
      options.onSynced()
    }
    data.updateMineTabBadge()
  }).catch(function(error) {
    console.warn("公开展示池云端拉取失败，将使用本地缓存", error)
    if (options.toastOnError) {
      wx.showToast({ title: "拉取失败，显示缓存数据", icon: "none" })
    }
  }).finally(function() {
    pageInstance._poolRefreshing = false
  })
}

module.exports = {
  getPoolSide: getPoolSide,
  getCloudPoolName: getCloudPoolName,
  getAllPoolItems: getAllPoolItems,
  buildPagedPoolPatch: buildPagedPoolPatch,
  onPoolReachBottom: onPoolReachBottom,
  refreshPoolFromCloud: refreshPoolFromCloud
}
