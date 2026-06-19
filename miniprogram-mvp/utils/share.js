var DEFAULT_FRIEND_TITLE = "算力码头 — 算力产业链商机撮合"
var DEFAULT_TIMELINE_TITLE = "算力码头 · 真实算力资源与需求对接"

function getLaunchContext() {
  var launch = {}
  var enter = {}
  try {
    if (wx.getLaunchOptionsSync) {
      launch = wx.getLaunchOptionsSync() || {}
    }
  } catch (error) {
    launch = {}
  }
  try {
    if (wx.getEnterOptionsSync) {
      enter = wx.getEnterOptionsSync() || {}
    }
  } catch (error) {
    enter = {}
  }
  return {
    launch: launch,
    enter: enter,
    query: Object.assign({}, launch.query || {}, enter.query || {}),
    mode: enter.mode || launch.mode || "",
    scene: enter.scene || launch.scene || 0
  }
}

function isSinglePageLaunch() {
  var ctx = getLaunchContext()
  return ctx.mode === "singlePage"
}

function isShareLaunchQuery(query) {
  query = query || {}
  return query.from === "share" || !!query.id
}

function isGuestCloudLaunch() {
  if (isSinglePageLaunch()) {
    return true
  }
  var ctx = getLaunchContext()
  return isShareLaunchQuery(ctx.query)
}

function decodeQueryValue(value) {
  if (!value) {
    return ""
  }
  try {
    return decodeURIComponent(String(value))
  } catch (error) {
    return String(value)
  }
}

/** 朋友圈单页模式等场景下 onLoad(options) 可能缺参，须合并启动/进入参数 */
function mergePageLaunchOptions(pageOptions) {
  pageOptions = pageOptions || {}
  var ctx = getLaunchContext()
  var merged = Object.assign({}, ctx.query || {}, pageOptions)
  if (merged.id) {
    merged.id = decodeQueryValue(merged.id)
  }
  return merged
}

function enableShareMenus() {
  if (!wx.showShareMenu) {
    return
  }
  wx.showShareMenu({
    withShareTicket: true,
    menus: ["shareAppMessage", "shareTimeline"]
  })
}

function buildHomeShareAppMessage() {
  return {
    title: DEFAULT_FRIEND_TITLE,
    path: "/pages/home/home?from=share"
  }
}

function buildHomeShareTimeline() {
  return {
    title: DEFAULT_TIMELINE_TITLE,
    query: "from=share"
  }
}

function buildPoolShareAppMessage(pool) {
  var isDemand = pool === "demand"
  return {
    title: isDemand ? "算力码头 — 最新算力需求池" : "算力码头 — 精选算力资源池",
    path: isDemand ? "/pages/demands/demands?from=share" : "/pages/resources/resources?from=share"
  }
}

function buildPoolShareTimeline(pool) {
  var isDemand = pool === "demand"
  return {
    title: isDemand ? "算力码头 · 找算力需求，一键对接" : "算力码头 · 供算力资源，真实可对接",
    query: "from=share&pool=" + (isDemand ? "demand" : "resource")
  }
}

function buildListingShareAppMessage(item, id) {
  if (!item || !id) {
    return buildHomeShareAppMessage()
  }
  var title = item.title || "算力码头商机"
  if (item.type) {
    title = "【" + item.type + "】" + title
  }
  if (item.region) {
    title += " · " + item.region
  }
  return {
    title: title,
    path: "/pages/detail/detail?id=" + encodeURIComponent(id) + "&from=share"
  }
}

function buildListingConnectShareAppMessage(item, id, options) {
  options = options || {}
  var base = buildListingShareAppMessage(item, id)
  var prefix = options.isResource ? "邀请对接" : "邀请匹配"
  base.title = prefix + " · " + base.title
  return base
}

function buildListingShareTimeline(item, id) {
  if (!item || !id) {
    return buildHomeShareTimeline()
  }
  var parts = []
  if (item.type) {
    parts.push(item.type)
  }
  if (item.title) {
    parts.push(item.title)
  }
  if (item.region) {
    parts.push(item.region)
  }
  if (item.scale) {
    parts.push(item.scale)
  }
  return {
    title: parts.join(" · ") || DEFAULT_TIMELINE_TITLE,
    query: "id=" + encodeURIComponent(id) + "&from=share"
  }
}

function promptShareTimeline(options) {
  options = options || {}
  wx.showModal({
    title: options.title || "分享到朋友圈",
    content: options.content || "请点击右上角「···」，选择「分享到朋友圈」即可分享当前商机。",
    showCancel: false,
    confirmText: "知道了"
  })
}

module.exports = {
  getLaunchContext: getLaunchContext,
  isSinglePageLaunch: isSinglePageLaunch,
  isShareLaunchQuery: isShareLaunchQuery,
  isGuestCloudLaunch: isGuestCloudLaunch,
  decodeQueryValue: decodeQueryValue,
  mergePageLaunchOptions: mergePageLaunchOptions,
  enableShareMenus: enableShareMenus,
  buildHomeShareAppMessage: buildHomeShareAppMessage,
  buildHomeShareTimeline: buildHomeShareTimeline,
  buildPoolShareAppMessage: buildPoolShareAppMessage,
  buildPoolShareTimeline: buildPoolShareTimeline,
  buildListingShareAppMessage: buildListingShareAppMessage,
  buildListingConnectShareAppMessage: buildListingConnectShareAppMessage,
  buildListingShareTimeline: buildListingShareTimeline,
  promptShareTimeline: promptShareTimeline
}
