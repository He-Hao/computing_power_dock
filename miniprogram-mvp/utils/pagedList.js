/** 列表前端分页：首屏只渲染一页，上拉加载更多 */
var PAGE_SIZE = 20

var LOAD_MORE_MIN_MS = 320

function initialData() {
  return {
    filteredCount: 0,
    displayPage: 1,
    hasMoreDisplay: false,
    loadingMore: false,
    cloudHasMore: false,
    newItemsStartIndex: -1
  }
}

function getListLength(pageInstance, listKey) {
  var field = listKey || "items"
  return ((pageInstance.data && pageInstance.data[field]) || []).length
}

function scheduleClearEnterAnimation(pageInstance) {
  setTimeout(function() {
    if (pageInstance.data.newItemsStartIndex >= 0) {
      pageInstance.setData({ newItemsStartIndex: -1 })
    }
  }, 480)
}

function attachEnterAnimation(patch, prevCount) {
  if (prevCount >= 0 && patch.items && patch.items.length > prevCount) {
    patch.newItemsStartIndex = prevCount
  }
  return patch
}

function normalizeListPatch(patch, listKey) {
  if (listKey && listKey !== "items") {
    patch[listKey] = patch.items
    delete patch.items
  }
  return patch
}

function runLoadMore(pageInstance, options) {
  options = options || {}
  var listKey = options.listKey || "items"
  if (pageInstance.data.loadingMore) {
    return Promise.resolve()
  }
  if (!canLoadMore(pageInstance.data) && typeof options.onCloudLoad !== "function") {
    return Promise.resolve()
  }
  if (!canLoadMore(pageInstance.data) && typeof options.onCloudLoad === "function") {
    if (!canLoadCloud(pageInstance.data)) {
      return Promise.resolve()
    }
    pageInstance.setData({ loadingMore: true })
    var cloudStart = Date.now()
    return Promise.resolve(options.onCloudLoad()).then(function() {
      return waitLoadMoreMinDelay(cloudStart)
    }).finally(function() {
      pageInstance.setData({ loadingMore: false })
    })
  }

  var prevCount = getListLength(pageInstance, listKey)
  pageInstance.setData({ loadingMore: true })
  var start = Date.now()
  var patch = loadNextPage(pageInstance, options)
  attachEnterAnimation(patch, prevCount)
  normalizeListPatch(patch, listKey)
  pageInstance.setData(patch)
  scheduleClearEnterAnimation(pageInstance)
  return waitLoadMoreMinDelay(start).then(function() {
    pageInstance.setData({ loadingMore: false })
  })
}

function waitLoadMoreMinDelay(startMs) {
  var wait = Math.max(0, LOAD_MORE_MIN_MS - (Date.now() - startMs))
  if (!wait) {
    return Promise.resolve()
  }
  return new Promise(function(resolve) {
    setTimeout(resolve, wait)
  })
}

function applyPage(fullList, pageInstance, options) {
  options = options || {}
  var pageSize = options.pageSize > 0 ? options.pageSize : PAGE_SIZE
  var displayPage = 1
  if (options.reset) {
    displayPage = 1
  } else if (options.displayPage > 0) {
    displayPage = options.displayPage
  } else if (options.extendPage) {
    displayPage = (pageInstance.data.displayPage || 1) + 1
  } else {
    displayPage = pageInstance.data.displayPage || 1
  }
  pageInstance._fullList = fullList || []
  var total = pageInstance._fullList.length
  var end = displayPage * pageSize
  return {
    items: pageInstance._fullList.slice(0, end),
    filteredCount: total,
    displayPage: displayPage,
    hasMoreDisplay: total > end,
    loadingMore: false,
    newItemsStartIndex: options.reset ? -1 : (pageInstance.data.newItemsStartIndex || -1)
  }
}

function loadNextPage(pageInstance, options) {
  return applyPage(pageInstance._fullList || [], pageInstance, {
    extendPage: true,
    pageSize: options && options.pageSize
  })
}

function canLoadMore(data) {
  return !!(data.hasMoreDisplay && !data.loadingMore)
}

function canLoadCloud(data) {
  return !data.hasMoreDisplay && !!data.cloudHasMore && !data.loadingMore
}

function isAllLoaded(data) {
  return !data.hasMoreDisplay && !data.cloudHasMore && !data.loadingMore && data.filteredCount > 0
}

module.exports = {
  PAGE_SIZE: PAGE_SIZE,
  LOAD_MORE_MIN_MS: LOAD_MORE_MIN_MS,
  initialData: initialData,
  applyPage: applyPage,
  loadNextPage: loadNextPage,
  runLoadMore: runLoadMore,
  canLoadMore: canLoadMore,
  canLoadCloud: canLoadCloud,
  isAllLoaded: isAllLoaded,
  scheduleClearEnterAnimation: scheduleClearEnterAnimation,
  attachEnterAnimation: attachEnterAnimation,
  getListLength: getListLength
}
