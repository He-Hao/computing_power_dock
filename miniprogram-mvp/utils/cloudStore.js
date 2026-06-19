const config = require("./config")
const listingSanitize = require("./listingSanitize")
const poolFilters = require("./poolFilters")

const submissionKey = "compute_trade_submissions"
const userProfileKey = "compute_trade_user_profile"
const publishedResourcesKey = "compute_trade_published_resources"
const publishedDemandsKey = "compute_trade_published_demands"
const userCloudOwnListingsKey = "compute_trade_user_cloud_own_listings"
const cloudStatusKey = "compute_trade_cloud_status"
const cloudSyncWarningKey = "compute_trade_cloud_sync_warning"
const adminPendingListingsKey = "compute_trade_admin_pending_listings"
const adminPendingSubmissionsKey = "compute_trade_admin_pending_submissions"
const adminAllPendingSubmissionsKey = "compute_trade_admin_all_pending_submissions"
const adminListingReportsHistoryKey = "compute_trade_admin_listing_reports_history"
const staffGlobalConnectsKey = "compute_trade_staff_global_connects"
const favorites = require("./favorites")
const userAuth = require("./userAuth")

var lastCloudError = ""
var refreshFromCloudPromise = null
var refreshPublicListingsPromise = null
var localCacheGeneration = 0

function captureLocalCacheGeneration() {
  return localCacheGeneration
}

function isLocalCacheGenerationStale(generation) {
  return generation !== localCacheGeneration
}

function bumpLocalCacheGeneration() {
  localCacheGeneration += 1
}

function buildSessionSyncPayload(extra) {
  var profile = wx.getStorageSync(userProfileKey) || {}
  var phone = userAuth.getSessionPhone() || profile.phone || ""
  return Object.assign({}, extra || {}, {
    phone: phone,
    userId: profile.userId || ""
  })
}

function saveCloudStatus(status) {
  wx.setStorageSync(cloudStatusKey, status || "pending")
}

function isCloudEnabled() {
  if (config.useCloud === false) {
    return false
  }
  return !!wx.cloud
}

function getCloudErrorMessage(err) {
  if (!err) {
    return "云函数调用失败"
  }
  if (typeof err === "string") {
    return err
  }
  if (err.message) {
    if (err.message === "timeout" || err.message.indexOf("timeout") > -1) {
      return "云函数请求超时：请右键 cloudfunctions/tradeApi →「上传并部署：云端安装依赖」，并确认云函数超时已设为 120 秒"
    }
    return err.message
  }
  if (err.errMsg) {
    if (err.errMsg.indexOf("Cloud API isn't enabled") > -1) {
      return "请先在微信开发者工具开通云开发"
    }
    if (err.errMsg.indexOf("env") > -1 || err.errMsg.indexOf("INVALID_ENV") > -1) {
      return "请在开发者工具顶部选择云开发环境，或在 config.js 填写 cloudEnvId"
    }
    if (err.errMsg.indexOf("FunctionName") > -1 || err.errMsg.indexOf("FUNCTION_NOT_FOUND") > -1 || err.errMsg.indexOf("-501000") > -1) {
      return "请先部署 tradeApi 云函数（右键 cloudfunctions/tradeApi → 上传并部署：云端安装依赖）"
    }
    if (err.errMsg.indexOf("collection not exists") > -1 || err.errMsg.indexOf("-502005") > -1) {
      return "请先在云开发控制台创建 users、listings、submissions 三个集合"
    }
    if (err.errMsg.indexOf("timeout") > -1 || err.errMsg.indexOf("-504003") > -1 || err.errMsg.indexOf("FUNCTIONS_TIME_LIMIT_EXCEEDED") > -1) {
      return "云函数执行超时（3秒默认限制）：请在开发者工具右键 cloudfunctions/tradeApi →「上传并部署：云端安装依赖」，部署后超时将提升至 120 秒"
    }
    if (err.errMsg.indexOf("-501023") > -1 || err.errMsg.indexOf("Unauthenticated") > -1) {
      return "云环境未开放未登录访问（-501023）：请在云开发控制台 → 设置 → 权限设置 → 开启「未登录用户可访问云资源」；并在云函数 → 权限设置 → 自定义安全规则中按 cloudfunctions/cloudfunction-rules.json 允许 tradeApi 被未登录调用。朋友圈单页模式依赖此配置。若使用 prod 环境，请确认该环境已绑定当前小程序 AppID"
    }
    return err.errMsg
  }
  return "云函数调用失败"
}

function isCloudTimeoutError(err) {
  var text = ""
  if (!err) {
    return false
  }
  if (typeof err === "string") {
    text = err
  } else {
    text = (err.message || "") + " " + (err.errMsg || "")
  }
  return text.indexOf("timeout") > -1
    || text.indexOf("-504003") > -1
    || text.indexOf("FUNCTIONS_TIME_LIMIT_EXCEEDED") > -1
}

function applyStaffWorkbenchExtraData(data) {
  if (!data) {
    return
  }
  applyCloudData({
    userProfile: data.userProfile,
    submissions: data.submissions,
    staffProxyListings: data.staffProxyListings
  })
}

function withSessionPayload(extra) {
  return buildSessionSyncPayload(extra || {})
}

function callTradeApi(action, payload, options) {
  options = options || {}
  return new Promise(function(resolve, reject) {
    if (!isCloudEnabled()) {
      reject(new Error("云开发未启用"))
      return
    }
    var callOptions = {
      name: "tradeApi",
      data: {
        action: action,
        payload: payload || {}
      },
      config: {
        timeout: 60000
      },
      success: function(res) {
        var result = res.result || {}
        var passThrough = options.passThroughFailure && !result.ok
          && (result.needSwitch || result.sessionInvalid)
        if (result.ok || passThrough) {
          if (result.ok && !options.silent) {
            lastCloudError = ""
            saveCloudStatus("connected")
          }
          resolve(result)
          return
        }
        var message = result.message || "请求失败"
        if (!options.silent) {
          lastCloudError = message
          saveCloudStatus("error")
        }
        reject(new Error(message))
      },
      fail: function(err) {
        var message = getCloudErrorMessage(err)
        if (!options.silent) {
          lastCloudError = message
          saveCloudStatus("error")
        }
        reject(new Error(message))
      }
    }
    if (config.cloudEnvId) {
      callOptions.config.env = config.cloudEnvId
    }
    wx.cloud.callFunction(callOptions)
  })
}

function isApprovedCertSubmission(item) {
  return !!(item && item.type === "certify"
    && (item.status === "已认证" || item.status === "已推荐" || item.status === "已发布"))
}

function resolveApprovedCertLevelFromSubmissions(phone) {
  if (!phone) {
    return ""
  }
  var submissions = wx.getStorageSync(submissionKey) || []
  var hasLicense = false
  var hasCard = false
  submissions.forEach(function(item) {
    if (!isApprovedCertSubmission(item)) {
      return
    }
    var itemPhone = item.ownerPhone || item.phone || ""
    if (itemPhone !== phone) {
      return
    }
    if (item.certLevel === "license") {
      hasLicense = true
    }
    if (item.certLevel === "card") {
      hasCard = true
    }
  })
  if (hasLicense) {
    return "license"
  }
  if (hasCard) {
    return "card"
  }
  return ""
}

function applyProfileFromCloud(remoteProfile) {
  if (!remoteProfile) {
    return null
  }
  var profile = Object.assign({}, remoteProfile)
  var approvedLevel = resolveApprovedCertLevelFromSubmissions(profile.phone || "")
  if (approvedLevel) {
    profile.certStatus = "verified"
    profile.certLevel = approvedLevel
  }
  return profile
}

/** 云端拉取结果直接覆盖本地缓存，不与本地合并 */
function applyCloudData(data) {
  if (!data) {
    return
  }
  if (data.resources) {
    wx.setStorageSync(publishedResourcesKey, data.resources)
  }
  if (data.demands) {
    wx.setStorageSync(publishedDemandsKey, data.demands)
  }
  if (Object.prototype.hasOwnProperty.call(data, "submissions")) {
    wx.setStorageSync(submissionKey, data.submissions || [])
  }
  if (Object.prototype.hasOwnProperty.call(data, "userProfile")) {
    if (data.userProfile === null) {
      wx.removeStorageSync(userProfileKey)
    } else if (data.userProfile) {
      wx.setStorageSync(userProfileKey, applyProfileFromCloud(data.userProfile))
    }
  }
  if (Object.prototype.hasOwnProperty.call(data, "ownListings")
    || Object.prototype.hasOwnProperty.call(data, "staffProxyListings")) {
    var ownItems = (data.ownListings || []).concat(data.staffProxyListings || []).map(function(item) {
      return normalizeListingPoolField(item)
    })
    wx.setStorageSync(userCloudOwnListingsKey, ownItems)
  }
  if (data.favorites) {
    favorites.applyStoreSnapshot(data.favorites)
  }
  if (data.pendingListings) {
    wx.setStorageSync(adminPendingListingsKey, data.pendingListings)
  }
  if (data.pendingSubmissions) {
    wx.setStorageSync(adminPendingSubmissionsKey, data.pendingSubmissions)
  }
  if (data.allPendingSubmissions) {
    wx.setStorageSync(adminAllPendingSubmissionsKey, data.allPendingSubmissions)
  }
}

function applyAdminPendingData(data) {
  if (!data) {
    return
  }
  applyCloudData({
    pendingListings: data.pendingListings,
    pendingSubmissions: data.pendingSubmissions,
    allPendingSubmissions: data.allPendingSubmissions
  })
}

var getListingPoolFromId = listingSanitize.getListingPoolFromId
var normalizeListingPoolField = listingSanitize.normalizeListingPoolField
var sanitizePublicListingFields = listingSanitize.sanitizePublicListingFields

function reconcilePublishedListingPools() {
  var resources = wx.getStorageSync(publishedResourcesKey) || []
  var demands = wx.getStorageSync(publishedDemandsKey) || []
  var nextResources = []
  var nextDemands = []
  var changed = false

  resources.forEach(function(item) {
    if (!item || !item.id) {
      return
    }
    if (getListingPoolFromId(item.id) === "demand") {
      nextDemands.push(normalizeListingPoolField(item))
      changed = true
      return
    }
    nextResources.push(normalizeListingPoolField(item))
  })

  demands.forEach(function(item) {
    if (!item || !item.id) {
      return
    }
    if (getListingPoolFromId(item.id) === "resource") {
      nextResources.push(normalizeListingPoolField(item))
      changed = true
      return
    }
    nextDemands.push(normalizeListingPoolField(item))
  })

  if (changed) {
    wx.setStorageSync(publishedResourcesKey, nextResources)
    wx.setStorageSync(publishedDemandsKey, nextDemands)
  }
  return changed
}

/** 公开展示池：云端分页结果直接写入本地，首页覆盖、翻页追加 */
function applyListingsPage(pool, page, items, hasMore, total, truncated, metaExtra) {
  metaExtra = metaExtra || {}
  items = (items || []).map(sanitizePublicListingFields).map(normalizeListingPoolField)
  var key = pool === "demand" ? publishedDemandsKey : publishedResourcesKey
  if (page <= 1) {
    wx.setStorageSync(key, items)
  } else {
    var existing = wx.getStorageSync(key) || []
    var pageMap = {}
    existing.forEach(function(item) {
      if (item && item.id) {
        pageMap[item.id] = item
      }
    })
    items.forEach(function(item) {
      if (item && item.id) {
        pageMap[item.id] = item
      }
    })
    wx.setStorageSync(key, Object.keys(pageMap).map(function(id) {
      return pageMap[id]
    }))
  }
  reconcilePublishedListingPools()
  wx.setStorageSync(key + "_meta", {
    page: page,
    hasMore: !!hasMore,
    total: total || 0,
    truncated: !!truncated,
    filterKey: metaExtra.filterKey || "",
    serverFiltered: !!metaExtra.serverFiltered,
    updatedAt: Date.now()
  })
}

function pullUserDataFromCloud(options) {
  options = options || {}
  if (!isCloudEnabled()) {
    saveCloudStatus("local")
    return Promise.resolve({ ok: true, local: true })
  }
  var payload = buildSessionSyncPayload(options.lite ? { lite: true } : {})
  return callTradeApi("sync", payload, {
    silent: options.silent === true
  }).then(function(result) {
    if (options.cacheGeneration != null && isLocalCacheGenerationStale(options.cacheGeneration)) {
      return result
    }
    if (result && result.data) {
      applyCloudData(result.data)
      if (result.data.syncTruncated) {
        wx.setStorageSync(cloudSyncWarningKey, "对接记录较多，云端仅同步了最近部分记录，更早记录可能不可见，请联系平台运营")
      } else {
        wx.removeStorageSync(cloudSyncWarningKey)
      }
    }
    if (!options.silent) {
      lastCloudError = ""
      saveCloudStatus("connected")
    }
    return result
  }).catch(function(err) {
    if (!options.silent) {
      lastCloudError = getCloudErrorMessage(err)
      saveCloudStatus("error")
    }
    return Promise.reject(err)
  })
}

function fetchPublicListing(listingId, options) {
  options = options || {}
  if (!isCloudEnabled() || !listingId) {
    return Promise.resolve({ ok: true, local: true })
  }
  return callTradeApi("getPublicListing", {
    listingId: listingId
  }, {
    silent: options.silent === true
  })
}

function fetchPublicListings(pool, page, pageSize, options) {
  options = options || {}
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: true, local: true })
  }
  var filters = poolFilters.normalizePoolFilters(options.filters)
  var filterKey = poolFilters.buildPoolFilterKey(filters)
  return callTradeApi("listListings", {
    pool: pool,
    page: page || 1,
    pageSize: pageSize || 50,
    filters: filters
  }, {
    silent: options.silent === true
  }).then(function(result) {
    if (options.cacheGeneration != null && isLocalCacheGenerationStale(options.cacheGeneration)) {
      return result
    }
    var data = result.data || {}
    var storedMeta = wx.getStorageSync((pool === "demand" ? publishedDemandsKey : publishedResourcesKey) + "_meta") || {}
    if ((page || 1) > 1 && storedMeta.filterKey && storedMeta.filterKey !== filterKey) {
      return result
    }
    applyListingsPage(
      pool,
      data.page || 1,
      data.items || [],
      data.hasMore,
      data.total,
      data.truncated,
      {
        filterKey: filterKey,
        serverFiltered: !!data.serverFiltered || poolFilters.hasServerPoolFilters(filters)
      }
    )
    return result
  })
}

function fetchBothPublicListings(options) {
  options = options || {}
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: true, local: true })
  }
  if (refreshPublicListingsPromise) {
    return refreshPublicListingsPromise
  }
  var cacheGeneration = captureLocalCacheGeneration()
  var fetchOptions = Object.assign({}, options, { cacheGeneration: cacheGeneration })
  refreshPublicListingsPromise = Promise.all([
    fetchPublicListings("resource", 1, 50, fetchOptions),
    fetchPublicListings("demand", 1, 50, fetchOptions)
  ]).then(function(results) {
    return { ok: true, resource: results[0], demand: results[1] }
  }).finally(function() {
    refreshPublicListingsPromise = null
  })
  return refreshPublicListingsPromise
}

function fetchBothPublicListingsSilent() {
  return fetchBothPublicListings({ silent: true }).catch(function(error) {
    console.warn("后台公池拉取失败", error)
    return { ok: false, silentFailed: true }
  })
}

function refreshAdminQueue(options) {
  options = options || {}
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: true, local: true })
  }
  return callTradeApi("adminSync", {}, {
    silent: options.silent === true
  }).then(function(result) {
    applyAdminPendingData(result.data)
    return result
  })
}

function refreshStaffWorkbench(options) {
  options = options || {}
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: true, local: true })
  }
  var callOptions = { silent: options.silent === true }

  function markConnected(result) {
    if (!options.silent) {
      lastCloudError = ""
      saveCloudStatus("connected")
    }
    return result
  }

  function applyStaffWorkbenchResult(result) {
    if (result && result.data) {
      applyStaffWorkbenchExtraData(result.data)
      applyAdminPendingData({
        pendingListings: result.data.pendingListings,
        pendingSubmissions: result.data.pendingSubmissions,
        allPendingSubmissions: result.data.allPendingSubmissions
      })
    }
    return markConnected(result)
  }

  var syncPayload = buildSessionSyncPayload({})
  if (options.lite) {
    return callTradeApi("staffWorkbenchSync", syncPayload, callOptions).then(applyStaffWorkbenchResult)
  }

  return callTradeApi("adminSync", syncPayload, callOptions).then(function(result) {
    applyAdminPendingData(result.data)
    return markConnected(result)
  }).catch(function(error) {
    if (!isCloudTimeoutError(error)) {
      throw error
    }
    return callTradeApi("staffWorkbenchSync", syncPayload, callOptions).then(function(result) {
      if (result && result.data) {
        applyStaffWorkbenchExtraData(result.data)
        applyAdminPendingData({
          pendingListings: result.data.pendingListings,
          pendingSubmissions: result.data.pendingSubmissions,
          allPendingSubmissions: result.data.allPendingSubmissions
        })
      }
      return markConnected(result)
    })
  })
}

function applyStaffGlobalConnectData(data) {
  if (!data) {
    return
  }
  wx.setStorageSync(staffGlobalConnectsKey, {
    fetchedAt: Date.now(),
    connects: data.connects || [],
    items: data.items || [],
    listings: data.listings || [],
    publishSubmissions: data.publishSubmissions || [],
    total: data.total || (data.items ? data.items.length : 0)
  })
}

function listStaffGlobalConnectsRemote(options) {
  options = options || {}
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: true, local: true, data: { connects: [], items: [], total: 0 } })
  }
  return callTradeApi("listStaffGlobalConnects", {
    skipRepair: options.skipRepair === true
  }, {
    silent: options.silent === true
  })
}

function refreshUserLiteFromCloud(options) {
  options = options || {}
  return pullUserDataFromCloud({
    silent: options.silent === true,
    lite: true,
    cacheGeneration: options.cacheGeneration
  })
}

function refreshFromCloud(options) {
  options = options || {}
  if (!isCloudEnabled()) {
    saveCloudStatus("local")
    return Promise.resolve({ ok: true, local: true })
  }
  if (refreshFromCloudPromise) {
    return refreshFromCloudPromise
  }
  refreshFromCloudPromise = pullUserDataFromCloud({
    silent: options.silent === true,
    cacheGeneration: options.cacheGeneration
  }).then(function(result) {
    if (!options.silent) {
      saveCloudStatus("connected")
    }
    return result
  }).finally(function() {
    refreshFromCloudPromise = null
  })
  return refreshFromCloudPromise
}

function refreshFromCloudSilent() {
  return refreshFromCloud({ silent: true }).catch(function(error) {
    console.warn("后台云端拉取失败", error)
    return { ok: false, silentFailed: true }
  })
}

function refreshUserDataAfterWrite() {
  return pullUserDataFromCloud({ silent: true, lite: true }).catch(function(error) {
    console.warn("提交后云端拉取失败", error)
    return { ok: false, silentFailed: true }
  })
}

function listStaffListingReportsRemote(options) {
  options = options || {}
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: true, local: true, data: { items: [] } })
  }
  return callTradeApi("listStaffListingReports", {
    scope: options.scope || "history",
    limit: options.limit || 80
  }, {
    silent: options.silent === true
  })
}

function clearCloudLocalCache() {
  bumpLocalCacheGeneration()
  wx.removeStorageSync(userProfileKey)
  wx.removeStorageSync(submissionKey)
  wx.removeStorageSync(publishedResourcesKey)
  wx.removeStorageSync(publishedDemandsKey)
  wx.removeStorageSync(publishedResourcesKey + "_meta")
  wx.removeStorageSync(publishedDemandsKey + "_meta")
  wx.removeStorageSync(userCloudOwnListingsKey)
  wx.removeStorageSync(cloudStatusKey)
  wx.removeStorageSync(adminPendingListingsKey)
  wx.removeStorageSync(adminPendingSubmissionsKey)
  wx.removeStorageSync(adminAllPendingSubmissionsKey)
  wx.removeStorageSync(adminListingReportsHistoryKey)
  wx.removeStorageSync(staffGlobalConnectsKey)
  saveCloudStatus("pending")
}

function registerUserRemote(form) {
  return callTradeApi("registerUser", form, { passThroughFailure: true }).then(function(result) {
    if (!result.ok) {
      if (result.alreadyBound) {
        return Promise.reject({
          alreadyBound: true,
          message: result.message || "当前微信已绑定手机号，请使用绑定号码登录"
        })
      }
      return Promise.reject(new Error(result.message || "注册失败"))
    }
    applyCloudData({ userProfile: result.data.userProfile })
    return result
  })
}

function loginUserRemote(form) {
  return callTradeApi("loginUser", form, { passThroughFailure: true }).then(function(result) {
    if (!result.ok) {
      if (result.needSwitch) {
        return Promise.reject({
          needSwitch: true,
          message: result.message,
          data: result.data || {}
        })
      }
      return Promise.reject(new Error(result.message || "登录失败"))
    }
    applyCloudData({ userProfile: result.data.userProfile })
    return result
  })
}

/** 校验本机 openid 会话：须已绑定手机号 */
function validateDeviceSessionRemote(options) {
  options = options || {}
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: true, local: true })
  }
  return callTradeApi("validateDeviceSession", {}, {
    silent: options.silent !== false,
    passThroughFailure: true
  }).then(function(result) {
    if (!result.ok) {
      return Promise.reject({
        message: result.message || "会话无效",
        sessionInvalid: !!result.sessionInvalid,
        needRelogin: !!result.needRelogin,
        needBindPhone: !!result.needBindPhone,
        data: result.data || {}
      })
    }
    if (result && result.data && result.data.userProfile) {
      if (options.applySession !== false) {
        applyCloudData({ userProfile: result.data.userProfile })
        var profile = result.data.userProfile
        if (profile && profile.phone) {
          userAuth.saveSession(profile.phone)
        }
      }
    }
    return result
  })
}

function ensureOpenidBoundRemote(options) {
  return validateDeviceSessionRemote(options)
}

function updateProfileRemote(profile) {
  var current = wx.getStorageSync(userProfileKey) || {}
  var payload = buildSessionSyncPayload(Object.assign({}, profile || {}, {
    _baseUpdatedAt: current.updatedAt || ""
  }))

  function applyProfileResult(result) {
    if (result && result.data && result.data.userProfile) {
      applyCloudData({ userProfile: result.data.userProfile })
    }
    return result || { ok: true, data: {} }
  }

  return callTradeApi("updateProfile", payload).then(function(result) {
    if (result && result.stale) {
      applyProfileResult(result)
      var fresh = wx.getStorageSync(userProfileKey) || {}
      var retryPayload = Object.assign({}, profile || {}, {
        _baseUpdatedAt: fresh.updatedAt || ""
      })
      return callTradeApi("updateProfile", retryPayload).then(applyProfileResult)
    }
    return applyProfileResult(result)
  })
}

function changePasswordRemote(form) {
  return callTradeApi("changePassword", buildSessionSyncPayload(form || {}))
}

function toggleFavoriteRemote(listingId, favorited) {
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: true, local: true })
  }
  return callTradeApi("toggleFavorite", withSessionPayload({
    listingId: listingId,
    favorited: !!favorited
  }), { silent: true }).then(function(result) {
    if (result && result.data && result.data.favorites) {
      favorites.applyStoreSnapshot(result.data.favorites)
    }
    return result
  })
}

function fetchStaffListingPublisherInfoRemote(listingId) {
  return callTradeApi("getStaffListingPublisherInfo", {
    listingId: listingId
  })
}

function resolveListingPoolName(listing) {
  if (!listing || !listing.id) {
    return ""
  }
  if (listing.pool === "demand" || listing.pool === "resource") {
    return listing.pool
  }
  return listing.id.indexOf("UDEM-") === 0 || listing.id.indexOf("DEM-") === 0 ? "demand" : "resource"
}

function refreshAfterUserWrite(result) {
  var serverListing = result && result.data && result.data.listing ? result.data.listing : null
  var tasks = [refreshUserDataAfterWrite()]
  var pool = resolveListingPoolName(serverListing)
  if (pool) {
    tasks.push(fetchPublicListings(pool, 1, 50, { silent: true }).catch(function() {
      return { ok: true }
    }))
  }
  return Promise.all(tasks)
}

function createProxySubmissionRemote(submission, listing, options) {
  options = options || {}
  return callTradeApi("adminProxyPublish", {
    submission: submission,
    listing: listing || null,
    autoApproveListing: options.autoApproveListing === true,
    clientPhone: options.clientPhone || submission.phone,
    staffPhone: options.staffPhone || submission.proxyStaffPhone || ""
  }).then(function(result) {
    var serverListing = result.data && result.data.listing ? result.data.listing : null
    var serverSubmission = result.data && result.data.submission ? result.data.submission : submission
    return refreshAfterUserWrite(result).then(function() {
      return {
        submission: serverSubmission,
        listing: serverListing
      }
    })
  })
}

function createProxyConnectRemote(submission, options) {
  options = options || {}
  return callTradeApi("adminProxyConnect", {
    submission: submission,
    clientPhone: options.clientPhone || submission.phone,
    staffPhone: options.staffPhone || submission.proxyStaffPhone || ""
  }).then(function(result) {
    var saved = result.data && result.data.submission ? result.data.submission : submission
    return refreshUserDataAfterWrite().then(function() {
      return { submission: saved }
    })
  })
}

function createSubmissionRemote(submission, listing, options) {
  options = options || {}
  return callTradeApi("createSubmission", withSessionPayload({
    submission: submission,
    listing: listing || null,
    autoApproveListing: options.autoApproveListing === true
  })).then(function(result) {
    var serverListing = result.data && result.data.listing ? result.data.listing : null
    var serverSubmission = result.data && result.data.submission ? result.data.submission : submission
    return refreshAfterUserWrite(result).then(function() {
      return {
        submission: serverSubmission,
        listing: serverListing
      }
    })
  })
}

function patchSubmissionRemote(submissionId, patch) {
  var list = wx.getStorageSync(submissionKey) || []
  var local = null
  for (var i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].id === submissionId) {
      local = list[i]
      break
    }
  }
  var baseUpdatedAt = local ? (local.updatedAt || local.createdAt || "") : ""
  return callTradeApi("patchSubmission", withSessionPayload({
    submissionId: submissionId,
    patch: patch,
    _baseUpdatedAt: baseUpdatedAt
  })).then(function(result) {
    if (result && result.stale) {
      return refreshUserDataAfterWrite().then(function() {
        return Promise.reject(new Error(result.message || "记录已在其他设备更新，请刷新后重试"))
      })
    }
    return refreshUserDataAfterWrite().then(function() {
      return result.data
    })
  })
}

function agreeConnectExchangeRemote(submissionId, agree) {
  return callTradeApi("agreeConnectExchange", withSessionPayload({
    submissionId: submissionId,
    agree: agree !== false
  })).then(function(result) {
    return refreshUserDataAfterWrite().then(function() {
      return result
    })
  })
}

function confirmConnectByRecipientRemote(submissionId) {
  return callTradeApi("confirmConnectByRecipient", withSessionPayload({
    submissionId: submissionId
  })).then(function(result) {
    return refreshUserDataAfterWrite().then(function() {
      return result
    })
  })
}

function rejectConnectByRecipientRemote(submissionId, reason) {
  return callTradeApi("rejectConnectByRecipient", withSessionPayload({
    submissionId: submissionId,
    reason: reason || ""
  })).then(function(result) {
    return refreshUserDataAfterWrite().then(function() {
      return result
    })
  })
}

function seedDemoDataRemote(payload) {
  return callTradeApi("seedDemoData", payload || {})
}

function clearDemoDataRemote(payload) {
  return callTradeApi("clearDemoData", payload || {})
}

function adminTakeDownListingRemote(listingId, reason) {
  return callTradeApi("adminTakeDownListing", {
    listingId: listingId,
    reason: reason || ""
  }).then(function(result) {
    var pool = listingId && listingId.indexOf("UDEM-") === 0 ? "demand" : "resource"
    return fetchPublicListings(pool, 1, 50, { silent: true }).then(function() {
      return result
    }).catch(function() {
      return result
    })
  })
}

function adminDisableAccountRemote(phone, reason) {
  return callTradeApi("adminDisableAccount", {
    phone: phone,
    reason: reason || ""
  })
}

function adminEnableAccountRemote(phone) {
  return callTradeApi("adminEnableAccount", {
    phone: phone
  })
}

function adminSearchPublishedListingsRemote(options) {
  options = options || {}
  return callTradeApi("adminSearchPublishedListings", {
    keyword: options.keyword || "",
    pool: options.pool || "all",
    status: options.status || "published",
    includeClosed: !!options.includeClosed,
    page: options.page || 1,
    pageSize: options.pageSize || 20
  })
}

function adminLookupUserRemote(phone) {
  return callTradeApi("adminLookupUser", {
    phone: phone
  })
}

function adminListUsersRemote(options) {
  options = options || {}
  return callTradeApi("adminListUsers", {
    keyword: options.keyword || "",
    filter: options.filter || "all",
    page: options.page || 1,
    pageSize: options.pageSize || 20
  })
}

function adminReviewRemote(payload) {
  var adminPayload = payload || {}
  return callTradeApi("adminReview", adminPayload).then(function(result) {
    return refreshStaffWorkbench({ lite: true, silent: true }).catch(function() {
      return { ok: true }
    }).then(function() {
      return refreshAdminQueue().catch(function() {
        return { ok: true }
      })
    }).then(function() {
      var pool = payload.reviewType === "listing" && payload.id
        ? (payload.id.indexOf("UDEM-") === 0 ? "demand" : "resource")
        : ""
      if (pool) {
        return fetchPublicListings(pool, 1).catch(function() {
          return { ok: true }
        })
      }
      return { ok: true }
    }).then(function() {
      return result
    })
  })
}

function isCloudFileId(url) {
  return !!url && String(url).indexOf("cloud://") === 0
}

function isHttpsMediaUrl(url) {
  return !!url && String(url).indexOf("https://") === 0
}

function isLocalMediaPath(url) {
  if (!url) {
    return true
  }
  var str = String(url)
  if (isCloudFileId(str)) {
    return false
  }
  if (isHttpsMediaUrl(str)) {
    return false
  }
  if (str.indexOf("wxfile://") === 0) {
    return true
  }
  if (str.indexOf("http://tmp/") === 0 || str.indexOf("http://usr/") === 0) {
    return true
  }
  if (str.indexOf("http://") === 0 || str.indexOf("https://") === 0) {
    return false
  }
  return str.indexOf("/") === 0 || str.indexOf("cert_") > -1
}

function markUnavailableImage(item) {
  return Object.assign({}, item, {
    displayUrl: "",
    unavailable: true,
    unavailableHint: "图片未上传至云端，仅保存在申请人手机。请通知用户重新上传认证材料后再审。"
  })
}

function mapResolvedCloudImages(images, urlMap, entryMap) {
  entryMap = entryMap || {}
  return images.map(function(item) {
    if (isLocalMediaPath(item.url)) {
      return markUnavailableImage(item)
    }
    var entry = entryMap[item.url] || null
    if (entry && entry.previewDataUrl) {
      return Object.assign({}, item, {
        displayUrl: entry.previewDataUrl,
        unavailable: false,
        resolveHint: ""
      })
    }
    if (urlMap[item.url]) {
      return Object.assign({}, item, {
        url: urlMap[item.url],
        displayUrl: urlMap[item.url],
        unavailable: false
      })
    }
    if (entry && entry.errMsg) {
      return Object.assign({}, item, {
        displayUrl: "",
        unavailable: true,
        unavailableHint: "云端图片读取失败：" + entry.errMsg
      })
    }
    if (isHttpsMediaUrl(item.url)) {
      return Object.assign({}, item, {
        displayUrl: item.url,
        unavailable: false
      })
    }
    if (isCloudFileId(item.url)) {
      return Object.assign({}, item, {
        displayUrl: "",
        unavailable: true,
        unavailableHint: "云端图片暂时无法读取，请确认云开发环境一致后重试。"
      })
    }
    return Object.assign({}, item, {
      displayUrl: item.url,
      unavailable: false
    })
  })
}

function downloadHttpsImageToLocal(url) {
  return new Promise(function(resolve) {
    if (!url || !isHttpsMediaUrl(url)) {
      resolve(url || "")
      return
    }
    wx.downloadFile({
      url: url,
      success: function(res) {
        if (res.statusCode === 200 && res.tempFilePath) {
          resolve(res.tempFilePath)
          return
        }
        resolve(url)
      },
      fail: function() {
        resolve(url)
      }
    })
  })
}

function materializeResolvedImages(images) {
  if (!images || !images.length) {
    return Promise.resolve(images || [])
  }
  return Promise.all(images.map(function(item) {
    if (item.unavailable) {
      return item
    }
    var displayUrl = item.displayUrl || item.url
    if (!displayUrl) {
      return item
    }
    if (displayUrl.indexOf("data:image") === 0 || displayUrl.indexOf("wxfile://") === 0) {
      return item
    }
    if (!isHttpsMediaUrl(displayUrl)) {
      return item
    }
    return downloadHttpsImageToLocal(displayUrl).then(function(localPath) {
      if (!localPath || localPath === displayUrl) {
        return item
      }
      return Object.assign({}, item, {
        displayUrl: localPath,
        url: localPath
      })
    })
  }))
}

function resolveCloudImageUrlsViaApi(images, fileIds) {
  if (!fileIds.length) {
    return Promise.resolve(mapResolvedCloudImages(images, {}))
  }
  return callTradeApi("resolveCloudFileUrls", {
    fileList: fileIds,
    includePreview: true
  }).then(function(result) {
    var urlMap = {}
    var entryMap = {}
    ;((result.data && result.data.fileList) || []).forEach(function(entry) {
      if (!entry || !entry.fileID) {
        return
      }
      entryMap[entry.fileID] = entry
      if (entry.tempFileURL && (entry.status === 0 || entry.previewDataUrl)) {
        urlMap[entry.fileID] = entry.tempFileURL
      }
    })
    return mapResolvedCloudImages(images, urlMap, entryMap)
  }).then(function(resolved) {
    return materializeResolvedImages(resolved)
  }).catch(function(error) {
    console.warn("运营端云端图片解析失败", error)
    return images.map(function(item) {
      if (isCloudFileId(item.url)) {
        return Object.assign({}, item, {
          displayUrl: "",
          unavailable: true,
          unavailableHint: error && error.message
            ? error.message
            : "云端图片链接获取失败，请检查云函数 tradeApi 是否已部署。"
        })
      }
      if (isLocalMediaPath(item.url)) {
        return markUnavailableImage(item)
      }
      return Object.assign({}, item, {
        displayUrl: item.url,
        unavailable: false
      })
    })
  })
}

function resolveCloudImageUrls(images, options) {
  options = options || {}
  if (!images || images.length === 0) {
    return Promise.resolve(images || [])
  }
  if (!isCloudEnabled()) {
    return Promise.resolve(images.map(function(item) {
      if (isLocalMediaPath(item.url)) {
        return markUnavailableImage(item)
      }
      return Object.assign({}, item, {
        displayUrl: item.url,
        unavailable: false
      })
    }))
  }
  var fileIds = []
  images.forEach(function(item) {
    if (isCloudFileId(item.url)) {
      fileIds.push(item.url)
    }
  })
  if (fileIds.length === 0) {
    return Promise.resolve(images.map(function(item) {
      if (isLocalMediaPath(item.url)) {
        return markUnavailableImage(item)
      }
      return Object.assign({}, item, {
        displayUrl: item.url,
        unavailable: false
      })
    }))
  }
  if (options.adminResolve) {
    return resolveCloudImageUrlsViaApi(images, fileIds)
  }
  return new Promise(function(resolve) {
    wx.cloud.getTempFileURL({
      fileList: fileIds,
      success: function(res) {
        var urlMap = {}
        ;(res.fileList || []).forEach(function(entry) {
          if (entry.fileID && entry.tempFileURL && entry.status === 0) {
            urlMap[entry.fileID] = entry.tempFileURL
          }
        })
        resolve(mapResolvedCloudImages(images, urlMap))
      },
      fail: function() {
        resolve(images.map(function(item) {
          if (isCloudFileId(item.url)) {
            return Object.assign({}, item, {
              displayUrl: "",
              unavailable: true,
              unavailableHint: "云端图片链接获取失败，请检查云开发配置后刷新。"
            })
          }
          if (isLocalMediaPath(item.url)) {
            return markUnavailableImage(item)
          }
          return Object.assign({}, item, {
            displayUrl: item.url,
            unavailable: false
          })
        }))
      }
    })
  })
}

function uploadCertImage(tempFilePath, certType) {
  if (!isCloudEnabled() || !tempFilePath) {
    return Promise.resolve(tempFilePath)
  }
  var ext = tempFilePath.indexOf(".png") > -1 ? "png" : "jpg"
  var cloudPath = "cert/" + certType + "_" + Date.now() + "." + ext
  return wx.cloud.uploadFile({
    cloudPath: cloudPath,
    filePath: tempFilePath
  }).then(function(res) {
    if (!res || !res.fileID) {
      return Promise.reject(new Error("认证图片上传云端失败，请检查云开发存储权限后重试"))
    }
    return res.fileID
  })
}

function sanitizeCloudFileName(fileName) {
  return String(fileName || "attachment")
    .replace(/[^\w.\-()\u4e00-\u9fa5]/g, "_")
    .slice(0, 80) || "attachment"
}

function uploadSubmissionAttachment(tempFilePath, fileName) {
  if (!isCloudEnabled() || !tempFilePath) {
    return Promise.resolve(tempFilePath)
  }
  var safeName = sanitizeCloudFileName(fileName)
  var cloudPath = "attachments/" + Date.now() + "_" + safeName
  return wx.cloud.uploadFile({
    cloudPath: cloudPath,
    filePath: tempFilePath
  }).then(function(res) {
    if (!res || !res.fileID) {
      return Promise.reject(new Error("附件上传云端失败，请检查云开发存储权限后重试"))
    }
    return res.fileID
  })
}

function getCloudStatus() {
  if (!isCloudEnabled()) {
    return {
      mode: "local",
      connected: false,
      title: "本地模式",
      hint: "数据仅保存在本机，其他账号/手机看不到。请在 utils/config.js 开启 useCloud 并配置云开发。",
      error: ""
    }
  }
  var status = wx.getStorageSync(cloudStatusKey) || "pending"
  if (status === "connected") {
    return {
      mode: "cloud",
      connected: true,
      title: "云端已连接",
      hint: "已从云端拉取最新数据；本机仅为缓存。资源/需求池按页加载。",
      error: "",
      syncWarning: wx.getStorageSync(cloudSyncWarningKey) || ""
    }
  }
  if (status === "error") {
    return {
      mode: "cloud",
      connected: false,
      title: "云端未就绪",
      hint: "请开通云开发、创建数据库集合并部署 tradeApi 云函数。",
      error: lastCloudError || "拉取失败"
    }
  }
  return {
    mode: "cloud",
    connected: false,
    title: "正在连接云端",
    hint: "首次使用需部署云函数，详见 09_云开发部署指南.md",
    error: lastCloudError
  }
}

module.exports = {
  isCloudEnabled: isCloudEnabled,
  callTradeApi: callTradeApi,
  refreshFromCloud: refreshFromCloud,
  refreshUserLiteFromCloud: refreshUserLiteFromCloud,
  refreshFromCloudSilent: refreshFromCloudSilent,
  fetchPublicListing: fetchPublicListing,
  fetchPublicListings: fetchPublicListings,
  fetchBothPublicListings: fetchBothPublicListings,
  fetchBothPublicListingsSilent: fetchBothPublicListingsSilent,
  clearCloudLocalCache: clearCloudLocalCache,
  captureLocalCacheGeneration: captureLocalCacheGeneration,
  bumpLocalCacheGeneration: bumpLocalCacheGeneration,
  refreshAdminQueue: refreshAdminQueue,
  refreshStaffWorkbench: refreshStaffWorkbench,
  applyStaffGlobalConnectData: applyStaffGlobalConnectData,
  listStaffGlobalConnectsRemote: listStaffGlobalConnectsRemote,
  listStaffListingReportsRemote: listStaffListingReportsRemote,
  pullUserDataFromCloud: pullUserDataFromCloud,
  refreshUserDataAfterWrite: refreshUserDataAfterWrite,
  registerUserRemote: registerUserRemote,
  loginUserRemote: loginUserRemote,
  ensureOpenidBoundRemote: ensureOpenidBoundRemote,
  validateDeviceSessionRemote: validateDeviceSessionRemote,
  updateProfileRemote: updateProfileRemote,
  changePasswordRemote: changePasswordRemote,
  toggleFavoriteRemote: toggleFavoriteRemote,
  fetchStaffListingPublisherInfoRemote: fetchStaffListingPublisherInfoRemote,
  createSubmissionRemote: createSubmissionRemote,
  createProxySubmissionRemote: createProxySubmissionRemote,
  createProxyConnectRemote: createProxyConnectRemote,
  patchSubmissionRemote: patchSubmissionRemote,
  confirmConnectByRecipientRemote: confirmConnectByRecipientRemote,
  agreeConnectExchangeRemote: agreeConnectExchangeRemote,
  rejectConnectByRecipientRemote: rejectConnectByRecipientRemote,
  seedDemoDataRemote: seedDemoDataRemote,
  clearDemoDataRemote: clearDemoDataRemote,
  adminReviewRemote: adminReviewRemote,
  adminTakeDownListingRemote: adminTakeDownListingRemote,
  adminDisableAccountRemote: adminDisableAccountRemote,
  adminEnableAccountRemote: adminEnableAccountRemote,
  adminSearchPublishedListingsRemote: adminSearchPublishedListingsRemote,
  adminLookupUserRemote: adminLookupUserRemote,
  adminListUsersRemote: adminListUsersRemote,
  isCloudFileId: isCloudFileId,
  isLocalMediaPath: isLocalMediaPath,
  resolveCloudImageUrls: resolveCloudImageUrls,
  uploadCertImage: uploadCertImage,
  uploadSubmissionAttachment: uploadSubmissionAttachment,
  applyCloudData: applyCloudData,
  getCloudStatus: getCloudStatus,
  reconcilePublishedListingPools: reconcilePublishedListingPools
}
