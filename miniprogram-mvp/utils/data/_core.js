const config = require("../config")
const fmt = require("../format")
const matching = require("../matching")
const adminModule = require("../admin")
const subscribeMessage = require("../subscribeMessage")
const favorites = require("../favorites")
const permissions = require("../permissions")
const idFactory = require("../idFactory")
const connectStage = require("../connectStage")
const certGate = require("../certGate")
const listingSanitize = require("../listingSanitize")
const C = require("../constants")

const resources = C.resources
const demands = C.demands
const bulletins = C.bulletins
const processSteps = C.processSteps
const categories = C.categories
const enterpriseRegionOptions = C.enterpriseRegionOptions
const regionFilterOptions = C.regionFilterOptions
const legacyRegionAliasMap = C.legacyRegionAliasMap
const enterpriseRoleOptions = C.enterpriseRoleOptions
const legacyRoleAliasMap = C.legacyRoleAliasMap
const enterpriseRoleDefaults = C.enterpriseRoleDefaults
const sortOptions = C.sortOptions
const resourceTypeMap = C.resourceTypeMap
const demandTypeMap = C.demandTypeMap
const statusHints = C.statusHints
const submissionKey = C.submissionKey
const userProfileKey = C.userProfileKey
const publishedResourcesKey = C.publishedResourcesKey
const publishedDemandsKey = C.publishedDemandsKey
const userCloudOwnListingsKey = C.userCloudOwnListingsKey
const adminPendingListingsKey = C.adminPendingListingsKey
const adminPendingSubmissionsKey = C.adminPendingSubmissionsKey
const adminAllPendingSubmissionsKey = C.adminAllPendingSubmissionsKey
const staffGlobalConnectsKey = C.staffGlobalConnectsKey
const platformInitKey = C.platformInitKey
const shareIntentKey = C.shareIntentKey
const homeGuideDismissKey = C.homeGuideDismissKey
const rejectionNoticeSeenKey = C.rejectionNoticeSeenKey
const listingReportsKey = C.listingReportsKey
const viewedResourcesKey = C.viewedResourcesKey
const viewedDemandsKey = C.viewedDemandsKey
const platformBlankVersion = C.platformBlankVersion
const resourceTypeOptions = C.resourceTypeOptions
const demandTypeOptions = C.demandTypeOptions
const resourceTypeFilterLabels = C.resourceTypeFilterLabels
const demandTypeFilterLabels = C.demandTypeFilterLabels
const MAX_SUBMISSION_ATTACHMENTS = C.MAX_SUBMISSION_ATTACHMENTS

var cloudStore = null
var userAuth = require("../userAuth")
try {
  cloudStore = require("../cloudStore")
} catch (error) {
  cloudStore = null
}

function isCloudEnabled() {
  return !!(cloudStore && cloudStore.isCloudEnabled())
}

function getMyOpenid() {
  var profile = getUserProfile()
  return profile && profile.openid ? profile.openid : ""
}

function getCloudStatus() {
  if (!cloudStore || !cloudStore.getCloudStatus) {
    return {
      mode: "local",
      connected: false,
      title: "本地模式",
      hint: "数据仅保存在本机。",
      error: ""
    }
  }
  return cloudStore.getCloudStatus()
}

function refreshFromCloud() {
  if (!isCloudEnabled()) {
    return Promise.resolve(repairUnfinishedConnectsForClosedListings()).then(function() {
      return repairStaffProxyToProxyConnects()
    }).then(function(result) {
      return Object.assign({ ok: true, local: true }, result || {})
    })
  }
  return cloudStore.refreshFromCloud().then(function(result) {
    adminModule.syncStaffSessionOnLogin()
    repairUnfinishedConnectsForClosedListings().catch(function(error) {
      console.warn("repairUnfinishedConnectsForClosedListings failed", error)
    })
    repairStaffProxyToProxyConnects().catch(function(error) {
      console.warn("repairStaffProxyToProxyConnects failed", error)
    })
    return repairProfileCertStatus().then(function() {
      return result
    }).catch(function() {
      return result
    })
  })
}

function refreshPublicListings(pool, page, options) {
  options = options || {}
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: true, local: true })
  }
  return cloudStore.fetchPublicListings(pool, page || 1, options.pageSize || 50, options)
}

function isPublicListingsServerFiltered(pool) {
  var meta = getPublicListingsMeta(pool)
  return !!meta.serverFiltered
}

function refreshAllPublicListings() {
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: true, local: true })
  }
  return cloudStore.fetchBothPublicListings()
}

function markPoolNeedsForceRefresh() {
  try {
    var app = getApp()
    if (app && app.globalData) {
      app.globalData.poolNeedsForceRefresh = true
    }
  } catch (error) {
    // 非页面上下文
  }
}

/** 已登录用户启动时校验本机 openid 会话（须已绑定手机号） */
function validateDeviceSessionOnLaunch() {
  if (!isCloudEnabled() || !isUserRegistered()) {
    return Promise.resolve({ ok: true, skipped: true })
  }
  return cloudStore.validateDeviceSessionRemote({ silent: true }).catch(function(error) {
    if (error && (error.sessionInvalid || error.needRelogin || error.needBindPhone)) {
      logoutUser({ skipCloudRefresh: true })
    }
    console.warn("本机会话校验失败", error)
    return { ok: false, message: error && error.message ? error.message : "" }
  })
}

function ensureOpenidBoundOnLaunch() {
  return validateDeviceSessionOnLaunch()
}

/** 登录/注册成功后从云端拉取最新数据覆盖本地缓存 */
function schedulePostAuthCloudSync() {
  if (!isCloudEnabled()) {
    adminModule.syncStaffSessionOnLogin()
    updateMineTabBadge()
    return
  }
  markPoolNeedsForceRefresh()
  refreshAllPublicListings().then(function() {
    return cloudStore.refreshFromCloud({ silent: true })
  }).then(function() {
    adminModule.syncStaffSessionOnLogin()
    if (!isStaffUser()) {
      return { ok: true }
    }
    return cloudStore.refreshStaffWorkbench({ silent: true, lite: true })
  }).then(function() {
    updateMineTabBadge()
  }).catch(function(error) {
    console.warn("登录/注册后云端拉取失败", error)
    adminModule.syncStaffSessionOnLogin()
    updateMineTabBadge()
  })
}

/** 资源/需求池、首页：从云端拉取公开展示池与用户数据 */
function refreshPoolPagesFromCloud() {
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: true, local: true })
  }
  if (!isUserRegistered()) {
    return refreshAllPublicListings()
  }
  return refreshAllPublicListings().then(function(poolResult) {
    return refreshFromCloudForMine({ silent: true }).then(function() {
      return poolResult
    }).catch(function(error) {
      console.warn("用户数据云端拉取失败", error)
      return poolResult
    })
  })
}

function getPublicListingsMeta(pool) {
  var key = pool === "demand" ? publishedDemandsKey : publishedResourcesKey
  return wx.getStorageSync(key + "_meta") || { page: 1, hasMore: false, total: 0 }
}

function loadMorePublicListings(pool, options) {
  options = options || {}
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: true, local: true, noMore: true })
  }
  var meta = getPublicListingsMeta(pool)
  if (!meta.hasMore) {
    return Promise.resolve({ ok: true, noMore: true })
  }
  var nextPage = (meta.page || 1) + 1
  return cloudStore.fetchPublicListings(pool, nextPage, options.pageSize || 50, options)
}

function refreshFromCloudForMine(options) {
  options = options || {}
  if (!isCloudEnabled()) {
    adminModule.syncStaffSessionOnLogin()
    return Promise.resolve({ ok: true, local: true })
  }
  if (!isUserRegistered()) {
    return Promise.resolve({ ok: true, skipped: true })
  }
  if (isStaffUser()) {
    return cloudStore.refreshStaffWorkbench({
      lite: true,
      silent: options.silent === true
    }).then(function(result) {
      adminModule.syncStaffSessionOnLogin()
      return result
    })
  }
  return cloudStore.refreshUserLiteFromCloud({
    silent: options.silent === true
  }).catch(function(error) {
    console.warn("用户数据云端拉取失败", error)
    return Promise.reject(error)
  })
}

function refreshStaffWorkbenchFromCloud() {
  if (!isCloudEnabled()) {
    adminModule.syncStaffSessionOnLogin()
    return Promise.resolve({ ok: true, local: true })
  }
  if (!isUserRegistered() || !isStaffUser()) {
    return Promise.resolve({ ok: true, skipped: true })
  }
  return cloudStore.refreshStaffWorkbench({}).then(function(result) {
    adminModule.syncStaffSessionOnLogin()
    return result
  })
}

function refreshStaffLaunchFromCloud() {
  if (!isCloudEnabled()) {
    adminModule.syncStaffSessionOnLogin()
    return Promise.resolve({ ok: true, local: true })
  }
  if (!isUserRegistered() || !isStaffUser()) {
    return refreshPoolPagesFromCloud()
  }
  return refreshStaffWorkbenchFromCloud().then(function(result) {
    return cloudStore.fetchBothPublicListingsSilent().then(function() {
      return result
    })
  })
}

function refreshFromCloudFull() {
  if (!isCloudEnabled()) {
    adminModule.syncStaffSessionOnLogin()
    return Promise.resolve({ ok: true, local: true })
  }
  if (!isUserRegistered()) {
    return refreshAllPublicListings()
  }
  if (isStaffUser()) {
    return refreshStaffLaunchFromCloud()
  }
  var syncPromise = refreshFromCloud().catch(function(error) {
    console.warn("用户数据云端拉取失败", error)
    return { ok: false, syncFailed: true }
  })
  return syncPromise.then(function(syncResult) {
    if (syncResult && syncResult.syncFailed) {
      return Promise.reject(new Error(cloudStore.getCloudStatus().error || "云端拉取失败"))
    }
    return refreshAllPublicListings()
  })
}

function refreshAdminFromCloud() {
  if (!isCloudEnabled() || !isAdminLoggedIn()) {
    return Promise.resolve({ ok: true, skipped: true })
  }
  return cloudStore.refreshAdminQueue({})
}

var DEMO_SEED_DEFAULT_COUNT = 4
var DEMO_SEED_CLEAR_COUNT = 100
var DEMO_SEED_START_PHONE = 18800000000
var DEMO_SEED_PASSWORD = "Demo1234"

function seedDemoDataAsync(options) {
  options = options || {}
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: false, message: "请先开启云端模式（config.js useCloud: true）并部署 tradeApi" })
  }
  if (!isAdminLoggedIn()) {
    return Promise.resolve({ ok: false, message: "无运营权限" })
  }

  var totalCount = Number(options.count || options.totalCount || DEMO_SEED_DEFAULT_COUNT)
  var batchSize = Number(options.batchSize || DEMO_SEED_DEFAULT_COUNT)
  var offset = 0
  var merged = {
    usersCreated: 0,
    usersSkipped: 0,
    resourcesCreated: 0,
    resourcesSkipped: 0,
    demandsCreated: 0,
    demandsSkipped: 0,
    startPhone: String(options.startPhone || DEMO_SEED_START_PHONE),
    endPhone: String(Number(options.startPhone || DEMO_SEED_START_PHONE) + totalCount - 1),
    totalCount: totalCount
  }

  function mergeStats(stats) {
    if (!stats) {
      return
    }
    merged.usersCreated += stats.usersCreated || 0
    merged.usersSkipped += stats.usersSkipped || 0
    merged.resourcesCreated += stats.resourcesCreated || 0
    merged.resourcesSkipped += stats.resourcesSkipped || 0
    merged.demandsCreated += stats.demandsCreated || 0
    merged.demandsSkipped += stats.demandsSkipped || 0
  }

  function runBatch() {
    var payload = Object.assign({
      startPhone: DEMO_SEED_START_PHONE,
      totalCount: totalCount,
      offset: offset,
      batchSize: batchSize,
      userPassword: DEMO_SEED_PASSWORD
    }, options, getAdminAuthPayload())
    delete payload.count
    return cloudStore.seedDemoDataRemote(payload).then(function(result) {
      var stats = result && result.data ? result.data : {}
      mergeStats(stats)
      if (typeof options.onProgress === "function") {
        options.onProgress({
          done: !!stats.done,
          nextOffset: stats.nextOffset || offset,
          totalCount: totalCount,
          merged: Object.assign({}, merged)
        })
      }
      if (!stats.done) {
        offset = stats.nextOffset || (offset + batchSize)
        return runBatch()
      }
      return refreshAllPublicListings().then(function() {
        return {
          ok: true,
          data: merged,
          message: result.message || "演示数据导入完成"
        }
      })
    })
  }

  return runBatch()
}

function clearDemoDataAsync(options) {
  options = options || {}
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: false, message: "请先开启云端模式（config.js useCloud: true）并部署 tradeApi" })
  }
  if (!isAdminLoggedIn()) {
    return Promise.resolve({ ok: false, message: "无运营权限" })
  }

  var totalCount = Number(options.count || options.totalCount || DEMO_SEED_CLEAR_COUNT)
  var batchSize = Number(options.batchSize || 10)
  var offset = 0
  var merged = {
    usersRemoved: 0,
    listingsRemoved: 0,
    submissionsRemoved: 0,
    startPhone: String(options.startPhone || DEMO_SEED_START_PHONE),
    endPhone: String(Number(options.startPhone || DEMO_SEED_START_PHONE) + totalCount - 1),
    totalCount: totalCount
  }

  function mergeStats(stats) {
    if (!stats) {
      return
    }
    merged.usersRemoved += stats.usersRemoved || 0
    merged.listingsRemoved += stats.listingsRemoved || 0
    merged.submissionsRemoved += stats.submissionsRemoved || 0
  }

  function runBatch() {
    var payload = Object.assign({
      startPhone: DEMO_SEED_START_PHONE,
      totalCount: totalCount,
      offset: offset,
      batchSize: batchSize
    }, options, getAdminAuthPayload())
    delete payload.count
    return cloudStore.clearDemoDataRemote(payload).then(function(result) {
      if (!result || result.ok === false) {
        return Promise.reject(new Error((result && result.message) || "清空失败"))
      }
      var stats = result && result.data ? result.data : {}
      mergeStats(stats)
      if (typeof options.onProgress === "function") {
        options.onProgress({
          done: !!stats.done,
          nextOffset: stats.nextOffset || offset,
          totalCount: totalCount,
          merged: Object.assign({}, merged)
        })
      }
      if (!stats.done) {
        offset = stats.nextOffset || (offset + batchSize)
        return runBatch()
      }
      return refreshAllPublicListings().then(function() {
        return {
          ok: true,
          data: merged,
          message: result.message || "演示数据已清空"
        }
      })
    })
  }

  return runBatch()
}

function mergeCloudListingPool(basePool, poolType) {
  var map = {}
  ;(basePool || []).forEach(function(item) {
    if (item && item.id) {
      map[item.id] = item
    }
  })
  getUserCloudOwnListings().forEach(function(item) {
    if (!item || !item.id) {
      return
    }
    var type = resolveListingPublicPoolType(item)
    if (type !== poolType) {
      return
    }
    map[item.id] = item
  })
  return Object.keys(map).map(function(id) {
    return map[id]
  })
}

function getPublishedResources() {
  return mergeCloudListingPool(wx.getStorageSync(publishedResourcesKey) || [], "resource")
}

function getPublishedDemands() {
  return mergeCloudListingPool(wx.getStorageSync(publishedDemandsKey) || [], "demand")
}

function getUserCloudOwnListings() {
  return wx.getStorageSync(userCloudOwnListingsKey) || []
}

function isListingClosed(item) {
  return !!(item && (item.status === "closed" || item.verification === "已关闭"))
}

function isListingPendingReview(item) {
  return !!(item && item.verification === "待审核")
}

function isListingPubliclyVisible(item) {
  if (!item || isListingClosed(item)) {
    return false
  }
  if (isListingPendingReview(item)) {
    return false
  }
  if (item.publicDisplay === false) {
    return false
  }
  return true
}

function getProxyListingSubmission(item) {
  if (!item) {
    return null
  }
  if (item.submissionId) {
    return getSubmissionWithoutRebuild(item.submissionId)
  }
  if (item.proxySubmissionOnly && item.id) {
    return getSubmissionWithoutRebuild(item.id)
  }
  return null
}

/** 代发管理：待审核 / 已发布 / 已关闭 / 已驳回 */
function getProxyListingStatusMeta(item) {
  if (!item) {
    return { label: "未知", class: "closed", key: "closed" }
  }
  var submission = getProxyListingSubmission(item)
  if (submission && submission.status === "已关闭" && submission.reviewResult === "驳回") {
    return { label: "已驳回", class: "rejected", key: "rejected" }
  }
  if (isListingPendingReview(item) || (submission && submission.status === "待审核")) {
    return { label: "待审核", class: "pending", key: "pending" }
  }
  if (isListingClosed(item) || (submission && submission.status === "已关闭")) {
    return { label: "已关闭", class: "closed", key: "closed" }
  }
  return { label: "已发布", class: "published", key: "published" }
}

function canViewerPreviewConnectListing(item, options) {
  options = options || {}
  if (!item || !options.connectId) {
    return false
  }
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return false
  }
  var connect = getSubmission(options.connectId)
  if (!connect || connect.type !== "connect") {
    return false
  }
  if (connect.targetId !== item.id && connect.sourceListingId !== item.id) {
    return false
  }
  return !!getConnectRole(connect, profile.phone)
}

function canViewListingDetail(item, options) {
  options = options || {}
  if (!item) {
    return false
  }
  if (isListingPubliclyVisible(item)) {
    return true
  }
  if (options.isStaffOversight && isStaffUser() && isStaffWorkMode()) {
    return true
  }
  if (options.isStaffProxyView || options.isStaffProxyManager) {
    return true
  }
  if (options.isPublisher || options.isListingPublisher || isListingPublisher(item.id)) {
    return true
  }
  if (canViewerPreviewConnectListing(item, options)) {
    return true
  }
  if (options.isConnectPreview) {
    var previewProfile = getUserProfile()
    if (previewProfile && previewProfile.phone) {
      var previewSubmissions = getSubmissions()
      for (var pi = 0; pi < previewSubmissions.length; pi += 1) {
        var previewConnect = previewSubmissions[pi]
        if (previewConnect.type !== "connect") {
          continue
        }
        if (previewConnect.targetId !== item.id && previewConnect.sourceListingId !== item.id) {
          continue
        }
        if (getConnectRole(previewConnect, previewProfile.phone)) {
          return true
        }
      }
    }
  }
  return false
}

function getStaffGlobalListing(id) {
  if (!id || !isStaffWorkMode()) {
    return null
  }
  var cache = getStaffGlobalConnectCache()
  var listings = cache.listings || []
  for (var i = 0; i < listings.length; i += 1) {
    if (listings[i].id === id) {
      return listings[i]
    }
  }
  return null
}

function isStaffWorkMode() {
  return isAdminLoggedIn()
}

function getListingPartyProfile(listing) {
  if (!listing) {
    return { company: "", contact: "", phone: "", role: "" }
  }
  var submission = listing.submissionId ? getSubmission(listing.submissionId) : null
  var staffProfile = getUserProfile()
  var company = listing.clientCompany || (submission && (submission.clientCompany || submission.company)) || ""
  var contact = listing.clientContact || (submission && (submission.clientContact || submission.contact)) || ""
  var role = listing.clientRole || (submission && (submission.clientRole || submission.role)) || ""
  var phone = listing.actualOwnerPhone || listing.ownerPhone || ""
  if (submission) {
    if (!phone) {
      phone = submission.actualOwnerPhone || submission.ownerPhone || submission.phone || ""
    }
  }
  if (isStaffProxyListing(listing) && staffProfile && staffProfile.company) {
    var clientPhone = phone || listing.actualOwnerPhone || listing.ownerPhone || ""
    if (clientPhone && staffProfile.phone && clientPhone !== staffProfile.phone && company === staffProfile.company) {
      company = listing.clientCompany || (submission && submission.clientCompany) || ""
      contact = listing.clientContact || (submission && submission.clientContact) || contact
      role = listing.clientRole || (submission && submission.clientRole) || role
    }
  }
  return {
    company: company,
    contact: contact,
    phone: phone,
    role: role
  }
}

function getAdminPendingListings() {
  if (!isCloudEnabled() || !isAdminLoggedIn()) {
    return []
  }
  return wx.getStorageSync(adminPendingListingsKey) || []
}

function findAdminPendingListing(id) {
  if (!id) {
    return null
  }
  var list = getAdminPendingListings()
  for (var i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].id === id) {
      return list[i]
    }
  }
  return null
}

function getAllListings() {
  return getPublishedResources().concat(getPublishedDemands())
    .concat(getUserCloudOwnListings())
    .concat(resources).concat(demands)
}

function isListingPublishSubmission(submission) {
  return !!(submission && isPublishType(submission.type))
}

function isOwnSubmission(submissionId) {
  var profile = getUserProfile()
  var submission = getSubmission(submissionId)
  if (!profile || !submission || !isListingPublishSubmission(submission)) {
    return false
  }
  return submissionBelongsToUser(submission, profile)
}

function listingBelongsToUser(listing, profile) {
  if (!listing || !profile) {
    return false
  }
  var openid = profile.openid || getMyOpenid()
  if (openid && listing.ownerOpenid && listing.ownerOpenid === openid) {
    return true
  }
  if (!profile.phone) {
    return false
  }
  var ownerPhone = listing.actualOwnerPhone || listing.ownerPhone || ""
  if (ownerPhone) {
    return ownerPhone === profile.phone
  }
  return false
}

function isStaffProxyListing(listing) {
  return !!(listing && listing.publishedByStaff)
}

function mergePreservedListingWithPublic(preserved, pub) {
  return listingSanitize.mergePreservedListingWithPublic(preserved, pub)
}

function sanitizePublicListingFields(listing) {
  return listingSanitize.sanitizePublicListingFields(listing)
}

/** 按当前查看者权限返回可安全展示的商机副本（详情/列表共用） */
function sanitizeListingForViewer(listing, options) {
  if (!listing) {
    return listing
  }
  options = options || {}
  if (options.forAdmin || options.forPlatformAdmin || options.isStaffProxyView || options.isStaffProxyManager) {
    return listing
  }
  if (options.isListingPublisher && isListingPublisher(listing.id)) {
    return listing
  }
  var safeCopy = isStaffProxyListing(listing) || listing.clientCompany || listing.clientContact || listing.actualOwnerPhone
    ? sanitizePublicListingFields(listing)
    : Object.assign({}, listing)
  delete safeCopy.ownerPhone
  delete safeCopy.actualOwnerPhone
  delete safeCopy.ownerOpenid
  if (safeCopy.details && safeCopy.details.length) {
    safeCopy.details = listingSanitize.filterPublisherSensitiveDetailRows(safeCopy.details)
  }
  return safeCopy
}

function proxySubmissionBelongsToStaff(submission, profile) {
  if (!submission || !submission.publishedByStaff || !profile || !profile.phone) {
    return false
  }
  if (submission.proxyStaffPhone && submission.proxyStaffPhone === profile.phone) {
    return true
  }
  if (isCloudEnabled() && profile.openid && submission.proxyStaffOpenid === profile.openid) {
    return true
  }
  return false
}

function enrichStaffProxyListingIdentity(listing, profile) {
  if (!listing || !listing.id || !profile || !profile.phone) {
    return listing
  }
  var submission = listing.submissionId ? getSubmissionWithoutRebuild(listing.submissionId) : null
  if (!proxyListingBelongsToStaff(listing, profile) && !proxySubmissionBelongsToStaff(submission, profile)) {
    return listing
  }
  if (listing.publishedByStaff && listing.proxyStaffPhone) {
    return listing
  }
  return Object.assign({}, listing, {
    publishedByStaff: true,
    proxyStaffPhone: listing.proxyStaffPhone || (submission && submission.proxyStaffPhone) || "",
    proxyStaffOpenid: listing.proxyStaffOpenid || (submission && submission.proxyStaffOpenid) || "",
    pool: listing.pool || getListingPool(listing.id) || (isResource(listing.id) ? "resource" : "demand")
  })
}

function proxyListingBelongsToStaff(listing, profile) {
  if (!listing || !profile || !profile.phone) {
    return false
  }
  if (listing.publishedByStaff) {
    if (listing.proxyStaffPhone && listing.proxyStaffPhone === profile.phone) {
      return true
    }
    if (isCloudEnabled() && profile.openid && listing.proxyStaffOpenid === profile.openid) {
      return true
    }
  }
  if (listing.submissionId) {
    var submission = getSubmissionWithoutRebuild(listing.submissionId)
    if (proxySubmissionBelongsToStaff(submission, profile)) {
      return true
    }
  }
  return false
}

function canStaffAccessProxyListing(listingId, options) {
  options = options || {}
  if (!listingId || !isStaffUser()) {
    return false
  }
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return false
  }
  var listing = getItem(listingId)
  if (!listing || !proxyListingBelongsToStaff(listing, profile)) {
    return false
  }
  if (options.manage) {
    return isStaffUser()
  }
  return true
}

function canStaffViewProxyListingConnects(listingId) {
  return canStaffAccessProxyListing(listingId, { manage: false })
}

function canStaffManageProxyListing(listingId) {
  return canStaffAccessProxyListing(listingId, { manage: true })
}

function canViewListingMatches(listingId) {
  return isListingPublisher(listingId) || canStaffManageProxyListing(listingId)
}

function getStaffProxyListings() {
  if (!isAdminLoggedIn()) {
    return []
  }
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return []
  }
  var seen = {}
  var items = []
  function pushListing(item) {
    if (!item || !item.id || seen[item.id]) {
      return
    }
    var resolved = enrichStaffProxyListingIdentity(item, profile)
    if (!proxyListingBelongsToStaff(resolved, profile)) {
      return
    }
    seen[item.id] = true
    items.push(resolved)
  }
  getPublishedResources().concat(getPublishedDemands()).forEach(pushListing)
  if (isCloudEnabled()) {
    var pendingListings = wx.getStorageSync(adminPendingListingsKey) || []
    pendingListings.forEach(pushListing)
    getAllSubmissionsRaw().forEach(function(submission) {
      if (!proxySubmissionBelongsToStaff(submission, profile) || !isListingPublishSubmission(submission)) {
        return
      }
      var listingId = submission.listingId
      if (listingId && seen[listingId]) {
        return
      }
      if (listingId) {
        var listing = getItem(listingId)
        if (listing) {
          pushListing(listing)
          return
        }
      }
      var trackStatuses = ["待审核", "已发布", "已关闭"]
      if (trackStatuses.indexOf(submission.status) === -1) {
        return
      }
      var stubKey = listingId || submission.id
      if (seen[stubKey]) {
        return
      }
      var isRes = submission.type === "resource" || (listingId && isResource(listingId))
      pushListing({
        id: stubKey,
        submissionId: submission.id,
        title: submission.title || (isRes ? "代发资源" : "代发需求"),
        type: submission.listingType || submission.type || (isRes ? "算力整机" : "算力租赁"),
        region: submission.region || "",
        verification: submission.status === "已发布"
          ? (isRes ? "资源已初审" : "需求已初审")
          : (submission.status === "待审核" ? "待审核" : "已关闭"),
        status: submission.status === "已关闭" ? "closed" : "",
        publishedByStaff: true,
        proxyStaffPhone: submission.proxyStaffPhone || "",
        proxyStaffOpenid: submission.proxyStaffOpenid || "",
        ownerPhone: submission.ownerPhone || submission.phone || "",
        actualOwnerPhone: submission.actualOwnerPhone || submission.phone || "",
        clientCompany: submission.clientCompany || submission.company || "",
        clientContact: submission.clientContact || submission.contact || "",
        clientRole: submission.clientRole || submission.role || "",
        publishedAt: submission.publishedAt || submission.createdAt || "",
        pool: isRes ? "resource" : "demand",
        proxySubmissionOnly: !listingId
      })
    })
  }
  items.sort(function(a, b) {
    return (b.publishedAt || b.createdAt || "").localeCompare(a.publishedAt || a.createdAt || "")
  })
  return items
}

function getStaffProxyListingViews() {
  return getStaffProxyListings().map(function(item) {
    var statusMeta = getProxyListingStatusMeta(item)
    if (item.proxySubmissionOnly) {
      var submissionOnlyResource = item.pool === "resource"
      return {
        id: item.id,
        submissionId: item.submissionId || item.id,
        title: item.title || (submissionOnlyResource ? "代发资源" : "代发需求"),
        type: item.type || "",
        region: item.region || "",
        poolFacts: [],
        poolSummaryLine: item.region || "",
        isStaffProxyItem: true,
        isDemandListing: !submissionOnlyResource,
        poolTypeLabel: submissionOnlyResource ? "资源" : "需求",
        poolTagClass: submissionOnlyResource ? "resource" : "demand",
        poolTimeLabel: item.publishedAt || item.createdAt || "",
        proxyClientLine: getStaffProxyClientLine(item),
        proxyClientCertHint: getStaffProxyClientCertHint(item),
        proxySubmissionOnly: true,
        proxyStatusLabel: statusMeta.label,
        proxyStatusClass: statusMeta.class,
        proxyStatusKey: statusMeta.key
      }
    }
    var isResourceItem = isResource(item.id)
    var enriched = isResourceItem
      ? prepareResourceListForView([item])[0]
      : prepareDemandListForView([item])[0]
    if (!enriched) {
      return null
    }
    return Object.assign({}, enriched, {
      isStaffProxyItem: true,
      displayProxyBadge: getListingProxyBadge(enriched),
      isDemandListing: !isResourceItem,
      poolTypeLabel: isResourceItem ? "资源" : "需求",
      poolTagClass: isResourceItem ? "resource" : "demand",
      proxyClientLine: getStaffProxyClientLine(item),
      proxyClientCertHint: getStaffProxyClientCertHint(item),
      proxyStatusLabel: statusMeta.label,
      proxyStatusClass: statusMeta.class,
      proxyStatusKey: statusMeta.key
    })
  }).filter(Boolean)
}

function getStaffProxyHubStats(items) {
  items = items || getStaffProxyListingViews()
  var stats = {
    total: items.length,
    resources: 0,
    demands: 0,
    pending: 0,
    published: 0,
    closed: 0,
    rejected: 0
  }
  items.forEach(function(item) {
    if (item.isDemandListing) {
      stats.demands += 1
    } else {
      stats.resources += 1
    }
    if (item.proxyStatusKey === "pending") {
      stats.pending += 1
    } else if (item.proxyStatusKey === "published") {
      stats.published += 1
    } else if (item.proxyStatusKey === "closed") {
      stats.closed += 1
    } else if (item.proxyStatusKey === "rejected") {
      stats.rejected += 1
    }
  })
  return stats
}

function filterStaffProxyListingViews(items, options) {
  options = options || {}
  var pool = options.pool || "all"
  var status = options.status || "all"
  var activeType = options.activeType || "全部"
  var keyword = String(options.keyword || "").trim().toLowerCase()
  return (items || []).filter(function(item) {
    if (pool === "resource" && item.isDemandListing) {
      return false
    }
    if (pool === "demand" && !item.isDemandListing) {
      return false
    }
    if (status !== "all" && item.proxyStatusKey !== status) {
      return false
    }
    if (activeType !== "全部") {
      var itemType = C.normalizeResourceType(item.type)
      if (C.resourceTypeOptions.indexOf(itemType) === -1) {
        itemType = C.normalizeDemandType(item.type)
      }
      if (itemType !== activeType) {
        return false
      }
    }
    if (keyword) {
      if (idFactory.looksLikeTradeIdKeyword(keyword)) {
        if (!idFactory.itemMatchesTradeIdKeyword(item, keyword)) {
          return false
        }
      } else {
        var haystack = [
          item.id,
          item.submissionId,
          item.title,
          item.type,
          item.region,
          item.proxyClientLine,
          item.poolSummaryLine
        ].join(" ").toLowerCase()
        if (haystack.indexOf(keyword) === -1 && !idFactory.itemMatchesTradeIdKeyword(item, keyword)) {
          return false
        }
      }
    }
    return true
  })
}

function buildListingClientIdentityPatch(submission, clientPhone) {
  var company = submission && submission.company ? String(submission.company).trim() : ""
  var contact = submission && submission.contact ? String(submission.contact).trim() : ""
  var role = submission && submission.role ? String(submission.role).trim() : ""
  var patch = {
    clientCompany: company,
    clientContact: contact,
    clientRole: role,
    actualOwnerPhone: clientPhone,
    ownerPhone: clientPhone
  }
  if (company) {
    patch.maskedCompany = fmt.maskCompany(company)
  }
  return patch
}

function getListingOwnerPhoneForCert(listing) {
  if (!listing) {
    return ""
  }
  var phone = listing.actualOwnerPhone || listing.ownerPhone || listing.phone || ""
  if (!phone && listing.submissionId) {
    var submission = getSubmission(listing.submissionId)
    if (submission) {
      phone = submission.actualOwnerPhone || submission.ownerPhone || submission.phone || ""
    }
  }
  return phone
}

function getApprovedCertLevelForPhone(phone) {
  if (!phone) {
    return ""
  }
  var hasLicense = false
  var hasCard = false
  getAllSubmissionsRaw().forEach(function(item) {
    if (!item || item.type !== "certify" || !isCertApproved(item)) {
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

function resolveListingPublisherCertLevel(listing) {
  if (!listing) {
    return ""
  }
  var phone = getListingOwnerPhoneForCert(listing)
  if (phone) {
    var liveLevel = getApprovedCertLevelForPhone(phone)
    if (liveLevel) {
      return liveLevel
    }
  }
  return listing.publisherCertLevel || ""
}

function getStaffProxyClientLine(listing) {
  if (!listing || !isStaffProxyListing(listing)) {
    return ""
  }
  var party = getListingPartyProfile(listing)
  var parts = []
  if (party.contact) {
    parts.push(party.contact)
  }
  var phone = getListingOwnerPhoneForCert(listing)
  if (phone) {
    parts.push(fmt.maskPhone(phone))
  }
  if (party.company) {
    parts.push(party.company)
  } else if (listing.maskedCompany) {
    parts.push(listing.maskedCompany)
  }
  if (party.role) {
    parts.push(party.role)
  }
  return parts.filter(Boolean).join(" · ")
}

function getStaffProxyClientCertHint(listing) {
  var level = resolveListingPublisherCertLevel(listing)
  if (level === "card") {
    return "尚未升级营业执照认证"
  }
  return ""
}

/** 代发详情页：结构化客户与商机状态（运营视图） */
function getStaffProxyDetailForm(listing) {
  if (!listing || !isStaffProxyListing(listing)) {
    return null
  }
  var party = getListingPartyProfile(listing)
  var phone = getListingOwnerPhoneForCert(listing)
  var certLevel = resolveListingPublisherCertLevel(listing)
  return {
    company: party.company || listing.maskedCompany || "未填写",
    contact: party.contact || "未填写",
    phoneDisplay: phone || "未填写",
    role: party.role || "",
    certLabel: certLevel === "license" ? "执照认证" : (certLevel === "card" ? "名片认证" : "未认证"),
    certClass: certLevel === "license" ? "license" : (certLevel === "card" ? "card" : "none"),
    statusLabel: getProxyListingStatusMeta(listing).label,
    statusClass: getProxyListingStatusMeta(listing).class,
    poolTypeLabel: isResource(listing.id) ? "资源" : "需求"
  }
}

function applyProxyPublishFields(listing, submission, staffProfile, clientPhone) {
  var proxyPatch = {
    publishedByStaff: true,
    proxyStaffPhone: staffProfile.phone,
    proxyStaffOpenid: staffProfile.openid || ""
  }
  var clientPatch = buildListingClientIdentityPatch(submission, clientPhone)
  var clientCertLevel = getApprovedCertLevelForPhone(clientPhone)
  var certPatch = {
    publisherCertLevel: clientCertLevel,
    publisherCertBadge: clientCertLevel ? getPublisherCertBadge(clientCertLevel) : null
  }
  if (listing) {
    Object.assign(listing, proxyPatch, clientPatch, certPatch, {
      pool: getListingPool(listing.id) || (isResource(listing.id) ? "resource" : "demand")
    })
  }
  if (submission) {
    Object.assign(submission, proxyPatch, clientPatch, {
      phone: clientPhone
    })
    if (submission.statusTimeline && submission.statusTimeline.length) {
      submission.statusTimeline[0].hint = clientPhone
        ? "平台运营代发，等待初审；通过后进入公开展示池，客户可通过该手机号登录查看。"
        : "平台运营代发，等待初审；通过后进入公开展示池。"
    }
  }
  return { listing: listing, submission: submission }
}

function collectAllConnectCandidates() {
  var map = {}
  getAllSubmissionsRaw().forEach(function(item) {
    map[item.id] = item
  })
  if (isAdminLoggedIn()) {
    (wx.getStorageSync(adminAllPendingSubmissionsKey) || []).forEach(function(item) {
      map[item.id] = item
    })
  }
  return Object.keys(map).map(function(key) {
    return map[key]
  })
}

/** 资源↔需求之间是否存在未完结对接（已关闭/已流失/已交换后返回 false，可再次出现在匹配列表） */
function hasUnfinishedConnectForResourceDemandPair(resourceListingId, demandListingId) {
  if (!resourceListingId || !demandListingId || !isResource(resourceListingId) || isResource(demandListingId)) {
    return false
  }
  var existing = findActiveConnectForListingPair(resourceListingId, demandListingId)
  return !!(existing && isConnectSubmissionUnfinished(existing))
}

/** 资源↔需求之间是否已有进行中的对接记录（含已交换名片，已关闭/已流失除外） */
function hasConnectForResourceDemandPair(resourceListingId, demandListingId) {
  if (!resourceListingId || !demandListingId || !isResource(resourceListingId) || isResource(demandListingId)) {
    return false
  }
  return !!findActiveConnectForListingPair(resourceListingId, demandListingId)
}

function findActiveConnectForListingPair(resourceListingId, demandListingId) {
  if (!resourceListingId || !demandListingId
    || !isResource(resourceListingId) || isResource(demandListingId)) {
    return null
  }
  var candidates = collectAllConnectCandidates()
  for (var i = 0; i < candidates.length; i += 1) {
    var item = candidates[i]
    if (item.type !== "connect" || !isActiveConnectSubmission(item)) {
      continue
    }
    var pairIds = [item.sourceListingId, item.targetId].filter(Boolean)
    if (pairIds.indexOf(resourceListingId) > -1 && pairIds.indexOf(demandListingId) > -1) {
      return item
    }
  }
  return null
}

function getStaffProxyListingSideLabel(listing) {
  if (!listing || !isStaffProxyListing(listing)) {
    return "代发商机"
  }
  return isResource(listing.id) ? "代发资源" : "代发需求"
}

function buildConnectDisclosedContacts(submission) {
  if (!submission || submission.type !== "connect") {
    return null
  }
  var applicantListing = submission.sourceListingId ? getItem(submission.sourceListingId) : null
  if (!applicantListing && submission.sourceListingId) {
    applicantListing = getStaffGlobalListing(submission.sourceListingId)
  }
  var applicantProfile = getListingPartyProfile(applicantListing)
  var applicantInfo = {
    company: applicantProfile.company || submission.company || "",
    contact: applicantProfile.contact || submission.contact || "",
    phone: applicantProfile.phone || submission.phone || "",
    role: applicantProfile.role || submission.role || ""
  }
  var targetListing = submission.targetId ? getItem(submission.targetId) : null
  if (!targetListing && submission.targetId) {
    targetListing = getStaffGlobalListing(submission.targetId)
  }
  var recipientProfile = getListingPartyProfile(targetListing)
  var recipientInfo = {
    company: recipientProfile.company || "",
    contact: recipientProfile.contact || "",
    phone: recipientProfile.phone || "",
    role: recipientProfile.role || ""
  }
  return {
    applicant: applicantInfo,
    recipient: recipientInfo
  }
}

function buildStaffProxyMatchConnectRecord(resource, resourceSub, demand, clientPhone, staffProfile, options) {
  options = options || {}
  var demandOwnerPhone = demand.ownerPhone || demand.actualOwnerPhone || getListingOwnerPhone(demand.id)
  var proxyToProxy = isStaffProxyListing(resource) && isStaffProxyListing(demand)
  var initiatedFrom = options.initiatedFrom === "demand" ? "demand" : "resource"
  var singleSideDesc = initiatedFrom === "demand"
    ? "平台运营代发匹配，由运营专员勾选资源并替客户发起对接。"
    : "平台运营代发匹配，由运营专员勾选需求并替客户发起对接。"
  return buildSubmissionRecord({
    type: "connect",
    connectDirection: "resource_to_demand",
    targetType: "demand",
    targetId: demand.id,
    targetTitle: demand.title,
    targetOwnerPhone: demandOwnerPhone,
    sourceListingId: resource.id,
    sourceTitle: resource.title,
    title: "资源匹配需求：" + (demand.title || ""),
    company: resourceSub ? resourceSub.company : "",
    contact: resourceSub ? resourceSub.contact : "",
    phone: clientPhone,
    region: demand.region || (resourceSub ? resourceSub.region : ""),
    role: resourceSub ? resourceSub.role : "",
    description: options.description || (proxyToProxy
      ? "平台运营代发匹配（代发资源对接代发需求），双方均为代发，已自动完结。"
      : singleSideDesc),
    publishedByStaff: true,
    matchedByStaff: true,
    proxyStaffPhone: staffProfile.phone,
    proxyStaffOpenid: staffProfile.openid || "",
    ownerPhone: clientPhone,
    actualOwnerPhone: clientPhone
  })
}

function applyConnectProxyNotifyFields(record) {
  if (!record || record.type !== "connect") {
    return record
  }
  var target = record.targetId ? getItem(record.targetId) : null
  var source = record.sourceListingId ? getItem(record.sourceListingId) : null
  if (target) {
    record.targetOwnerPhone = target.actualOwnerPhone || target.ownerPhone || target.phone
      || record.targetOwnerPhone || getListingOwnerPhone(record.targetId) || ""
    if (isStaffProxyListing(target)) {
      record.recipientProxyStaffPhone = target.proxyStaffPhone || record.recipientProxyStaffPhone || ""
      record.recipientProxyStaffOpenid = target.proxyStaffOpenid || record.recipientProxyStaffOpenid || ""
    }
  }
  if (source && isStaffProxyListing(source)) {
    record.applicantProxyStaffPhone = source.proxyStaffPhone || record.applicantProxyStaffPhone || ""
    record.applicantProxyStaffOpenid = source.proxyStaffOpenid || record.applicantProxyStaffOpenid || ""
  }
  var staffPhones = []
  if (record.proxyStaffPhone) {
    staffPhones.push(record.proxyStaffPhone)
  }
  if (target && target.proxyStaffPhone && staffPhones.indexOf(target.proxyStaffPhone) === -1) {
    staffPhones.push(target.proxyStaffPhone)
  }
  if (source && source.proxyStaffPhone && staffPhones.indexOf(source.proxyStaffPhone) === -1) {
    staffPhones.push(source.proxyStaffPhone)
  }
  if (staffPhones.length) {
    record.proxyStaffPhone = staffPhones[0]
    record.proxyStaffPhones = staffPhones
  }
  return record
}

function saveConnectSubmissionLocal(record) {
  applyConnectProxyNotifyFields(record)
  applyProxyToProxyAutoComplete(record)
  applyStaffProxyToProxyExchangeReady(record)
  if (isCloudEnabled() && cloudStore.createProxyConnectRemote) {
    return cloudStore.createProxyConnectRemote(record, {
      clientPhone: record.phone || record.ownerPhone || "",
      staffPhone: record.proxyStaffPhone || ""
    }).then(function(saved) {
      return (saved && saved.submission) ? saved.submission : record
    })
  }
  var list = getAllSubmissionsRaw()
  list.unshift(record)
  wx.setStorageSync(submissionKey, list)
  return Promise.resolve(record)
}

function createStaffProxyMatchConnects(resourceListingId, demandIds, options) {
  options = options || {}
  if (!canStaffManageProxyListing(resourceListingId)) {
    return Promise.reject(new Error("无权操作该代发资源"))
  }
  if (!isResource(resourceListingId)) {
    return Promise.reject(new Error("仅支持对代发资源勾选需求发起匹配"))
  }
  var resource = getItem(resourceListingId)
  if (!resource) {
    return Promise.reject(new Error("代发资源不存在"))
  }
  if (isListingClosed(resource)) {
    return Promise.reject(new Error("代发资源已关闭，暂不可匹配"))
  }
  var resourceSub = resource.submissionId ? getSubmission(resource.submissionId) : null
  var clientPhone = resource.actualOwnerPhone || resource.ownerPhone || resource.phone
    || (resourceSub && (resourceSub.actualOwnerPhone || resourceSub.phone)) || ""
  if (clientPhone && !/^1\d{10}$/.test(String(clientPhone))) {
    return Promise.reject(new Error("请填写正确的客户手机号"))
  }
  clientPhone = clientPhone || ""
  var staffProfile = getUserProfile()
  if (!staffProfile || !staffProfile.phone) {
    return Promise.reject(new Error("运营账号信息不完整"))
  }
  var uniqueIds = []
  var seen = {}
  ;(demandIds || []).forEach(function(id) {
    if (id && !seen[id]) {
      seen[id] = true
      uniqueIds.push(id)
    }
  })
  if (!uniqueIds.length) {
    return Promise.reject(new Error("请至少勾选一条需求"))
  }
  if (uniqueIds.length > 5) {
    return Promise.reject(new Error("一次最多勾选 5 条需求"))
  }

  var results = {
    created: [],
    skipped: [],
    failed: []
  }

  var chain = Promise.resolve()
  uniqueIds.forEach(function(demandId) {
    chain = chain.then(function() {
      var demand = getItem(demandId)
      if (!demand || isResource(demandId)) {
        results.failed.push({ demandId: demandId, message: "需求不存在" })
        return
      }
      if (isListingClosed(demand)) {
        results.failed.push({ demandId: demandId, message: "需求已关闭" })
        return
      }
      var existing = findActiveConnectForListingPair(resource.id, demandId)
      if (existing) {
        results.skipped.push({ demandId: demandId, connectId: existing.id })
        return
      }
      var record = buildStaffProxyMatchConnectRecord(resource, resourceSub, demand, clientPhone, staffProfile)
      if (options.description) {
        record.description = options.description
      }
      return saveConnectSubmissionLocal(record).then(function(saved) {
        if (!saved || !saved.id) {
          throw new Error("匹配记录保存失败")
        }
        results.created.push({ demandId: demandId, connectId: saved.id })
      }).catch(function(error) {
        results.failed.push({ demandId: demandId, message: error.message || "提交失败" })
      })
    })
  })
  return chain.then(function() {
    return results
  })
}

function canProxyConnectDemandFromResource(sourceResourceId, demandId) {
  if (!sourceResourceId || !demandId || !canStaffManageProxyListing(sourceResourceId)) {
    return false
  }
  if (!isResource(sourceResourceId) || isResource(demandId)) {
    return false
  }
  var demand = getItem(demandId)
  if (!demand || isListingClosed(demand)) {
    return false
  }
  return !findActiveConnectForListingPair(sourceResourceId, demandId)
}

function getProxyResourceConnectPairState(sourceResourceId, demandId) {
  if (!sourceResourceId || !demandId) {
    return { canConnect: false, connectRecordId: "" }
  }
  var existing = findActiveConnectForListingPair(sourceResourceId, demandId)
  if (existing && isConnectSubmissionUnfinished(existing)) {
    return { canConnect: false, connectRecordId: existing.id }
  }
  return {
    canConnect: canProxyConnectDemandFromResource(sourceResourceId, demandId),
    connectRecordId: ""
  }
}

function buildProxyResourceConnectSubmitUrl(sourceResourceId, demandId, demandTitle) {
  var url = "/pages/submit/submit?type=connect&mode=proxy&direction=resource_to_demand"
    + "&sourceResourceId=" + encodeURIComponent(sourceResourceId)
    + "&targetId=" + encodeURIComponent(demandId)
  if (demandTitle) {
    url += "&title=" + encodeURIComponent(demandTitle)
  }
  var redirect = "/pages/detail/detail?id=" + sourceResourceId + "&matchAnchor=" + sourceResourceId
  url += "&redirect=" + encodeURIComponent(redirect)
  return url
}

function enrichDemandPoolItemForProxyConnect(item, sourceResourceId) {
  if (!item || !sourceResourceId || !isStaffUser()) {
    return item
  }
  var pairState = getProxyResourceConnectPairState(sourceResourceId, item.id)
  return Object.assign({}, item, {
    showProxyConnectAction: pairState.canConnect,
    showProxyConnectLinked: !!pairState.connectRecordId,
    proxyConnectRecordId: pairState.connectRecordId || ""
  })
}

function enrichStaffProxyConnectFormFromResource(form, resource, resourceSub) {
  form = form || {}
  if (!resource) {
    return form
  }
  form.company = (resourceSub && (resourceSub.clientCompany || resourceSub.company)) || form.company || ""
  form.contact = (resourceSub && (resourceSub.clientContact || resourceSub.contact)) || form.contact || ""
  form.phone = resource.actualOwnerPhone || resource.ownerPhone || resource.phone
    || (resourceSub && (resourceSub.actualOwnerPhone || resourceSub.phone)) || form.phone || ""
  if (resourceSub && resourceSub.region && !form.region) {
    form.region = normalizeEnterpriseRegion(resourceSub.region)
  }
  if (resourceSub && (resourceSub.clientRole || resourceSub.role) && !form.role) {
    form.role = resourceSub.clientRole || resourceSub.role
  }
  return form
}

function enrichStaffProxyMatchOptions(resourceListingId, demandItems, selectedIds) {
  selectedIds = selectedIds || []
  var selectedMap = {}
  selectedIds.forEach(function(id) {
    selectedMap[id] = true
  })
  var resource = hydrateListingProductFields(getItem(resourceListingId))
  var hydratedDemands = (demandItems || []).map(hydrateListingProductFields)
  var sortedItems = resource
    ? matching.sortResourceDemandMatchesByProductName(resource, hydratedDemands)
    : hydratedDemands
  return sortedItems.filter(function(item) {
    if (!item || !item.id || isListingClosed(item) || isListingClosed(getItem(item.id))) {
      return false
    }
    return !hasConnectForResourceDemandPair(resourceListingId, item.id)
  }).map(function(item) {
    return Object.assign({}, item, {
      matchSelected: !!selectedMap[item.id],
      matchAlreadyLinked: false,
      matchLinkedLabel: ""
    })
  })
}

function enrichStaffProxyMatchResourceOptions(demandListingId, resourceItems, selectedIds) {
  selectedIds = selectedIds || []
  var selectedMap = {}
  selectedIds.forEach(function(id) {
    selectedMap[id] = true
  })
  var demand = hydrateListingProductFields(getItem(demandListingId))
  var hydratedResources = (resourceItems || []).map(hydrateListingProductFields)
  var sortedItems = demand
    ? matching.sortDemandResourceMatchesByProductName(demand, hydratedResources)
    : hydratedResources
  return sortedItems.filter(function(item) {
    if (!item || !item.id || isListingClosed(item) || isListingClosed(getItem(item.id))) {
      return false
    }
    return !hasConnectForResourceDemandPair(item.id, demandListingId)
  }).map(function(item) {
    return Object.assign({}, item, {
      matchSelected: !!selectedMap[item.id],
      matchAlreadyLinked: false,
      matchLinkedLabel: ""
    })
  })
}

function enrichOwnerDemandMatchResourceOptions(demandListingId, resourceItems, selectedIds) {
  return enrichStaffProxyMatchResourceOptions(demandListingId, resourceItems, selectedIds)
    .map(function(item) {
      var selectable = !isListingPublisher(item.id) && !item.matchPreviewOnly
      return Object.assign({}, item, {
        matchSelectable: selectable,
        matchPreviewOnly: !!item.matchPreviewOnly || !selectable
      })
    })
}

function getResourcePoolVisibleItemsForMatch() {
  cloudStore.reconcilePublishedListingPools()
  var items = matching.filterItems(getResources(), {
    activeType: "全部",
    activeRegion: "全部",
    activeCert: "all",
    activeTime: "all",
    activeDeliveryKind: "all",
    activeFavorite: "all",
    favoriteIds: favorites.getFavoriteIds("resources")
  })
  items = matching.sortItems(items, "match")
  return prepareResourceListForView(items)
}

function getDemandPoolVisibleItemsForMatch() {
  cloudStore.reconcilePublishedListingPools()
  var items = matching.filterItems(getDemands(), {
    activeType: "全部",
    activeRegion: "全部",
    activeCert: "all",
    activeTime: "all",
    activeDeliveryKind: "all",
    activeFavorite: "all",
    favoriteIds: favorites.getFavoriteIds("demands")
  })
  items = matching.sortItems(items, "match")
  return prepareDemandListForView(items)
}

function getOwnerDemandMatchResourceCandidates(demandListingId) {
  var demand = hydrateListingProductFields(getItem(demandListingId))
  if (!demand || isListingClosed(demand)) {
    return []
  }
  var poolResources = getResourcePoolVisibleItemsForMatch()
  var poolItems = []
  poolResources.forEach(function(item) {
    if (!item || !item.id) {
      return
    }
    if (isListingPublisher(item.id)) {
      return
    }
    if (isListingClosed(item) || isListingClosed(getItem(item.id))) {
      return
    }
    if (hasConnectForResourceDemandPair(item.id, demandListingId)) {
      return
    }
    poolItems.push(hydrateListingProductFields(item))
  })
  return matching.sortDemandResourceMatchesByProductName(demand, poolItems)
}

function getOwnerDemandMatchPickerBundle(demandListingId, expanded) {
  var defaultLimit = 3
  var allRelated = getOwnerDemandMatchResourceCandidates(demandListingId)
  return {
    allRelated: allRelated,
    displayRelated: expanded ? allRelated.slice(0, 20) : allRelated.slice(0, defaultLimit),
    total: allRelated.length,
    hasMore: allRelated.length > defaultLimit,
    expanded: !!expanded
  }
}

function buildOwnerDemandMatchPickerItems(demandListingId, limit, selectedIds) {
  limit = limit || 10
  var items = getOwnerDemandMatchResourceCandidates(demandListingId).slice(0, limit)
  return enrichOwnerDemandMatchResourceOptions(demandListingId, items, selectedIds)
}

function enrichOwnerResourceMatchDemandOptions(resourceListingId, demandItems, selectedIds) {
  return enrichStaffProxyMatchOptions(resourceListingId, demandItems, selectedIds)
    .map(function(item) {
      var selectable = !isListingPublisher(item.id) && !item.matchPreviewOnly
      return Object.assign({}, item, {
        matchSelectable: selectable,
        matchPreviewOnly: !!item.matchPreviewOnly || !selectable
      })
    })
}

function getOwnerResourceMatchDemandCandidates(resourceListingId) {
  var resource = hydrateListingProductFields(getItem(resourceListingId))
  if (!resource || isListingClosed(resource)) {
    return []
  }
  var poolDemands = getDemandPoolVisibleItemsForMatch()
  var poolItems = []
  poolDemands.forEach(function(item) {
    if (!item || !item.id) {
      return
    }
    if (isListingPublisher(item.id)) {
      return
    }
    if (isListingClosed(item) || isListingClosed(getItem(item.id))) {
      return
    }
    if (hasConnectForResourceDemandPair(resourceListingId, item.id)) {
      return
    }
    poolItems.push(hydrateListingProductFields(item))
  })
  return matching.sortResourceDemandMatchesByProductName(resource, poolItems)
}

function getOwnerResourceMatchPickerBundle(resourceListingId, expanded) {
  var defaultLimit = 3
  var allRelated = getOwnerResourceMatchDemandCandidates(resourceListingId)
  return {
    allRelated: allRelated,
    displayRelated: expanded ? allRelated.slice(0, 20) : allRelated.slice(0, defaultLimit),
    total: allRelated.length,
    hasMore: allRelated.length > defaultLimit,
    expanded: !!expanded
  }
}

function buildOwnerResourceMatchPickerItems(resourceListingId, limit, selectedIds) {
  limit = limit || 10
  var items = getOwnerResourceMatchDemandCandidates(resourceListingId).slice(0, limit)
  return enrichOwnerResourceMatchDemandOptions(resourceListingId, items, selectedIds)
}

function enrichViewerResourceMatchDemandOptions(resourceListingId, demandItems, selectedIds) {
  return enrichStaffProxyMatchOptions(resourceListingId, demandItems, selectedIds).map(function(item) {
    var selectable = isListingPublisher(item.id) && !item.matchPreviewOnly
    return Object.assign({}, item, {
      matchSelectable: selectable,
      matchPreviewOnly: !!item.matchPreviewOnly || !selectable
    })
  })
}

function buildViewerResourceMatchPickerItems(resourceListingId, limit, selectedIds) {
  limit = limit || 10
  var resource = hydrateListingProductFields(getItem(resourceListingId))
  var ownDemands = getUserActiveDemands()
  var relatedDemands = prepareDemandListForView(getRelatedMatches(resourceListingId, limit))
  var items = []
  var seen = {}
  ownDemands.forEach(function(item) {
    if (!item || !item.id || seen[item.id]) {
      return
    }
    if (resource && !matching.isCompatibleListingTypePair(resource, item, { isSourceResource: true })) {
      return
    }
    seen[item.id] = true
    items.push(item)
  })
  relatedDemands.forEach(function(item) {
    if (!item || !item.id || seen[item.id]) {
      return
    }
    seen[item.id] = true
    items.push(Object.assign({}, item, { matchPreviewOnly: true }))
  })
  return enrichViewerResourceMatchDemandOptions(resourceListingId, items, selectedIds)
}

function createStaffProxyMatchConnectsFromDemand(demandListingId, resourceIds) {
  if (!canStaffManageProxyListing(demandListingId)) {
    return Promise.reject(new Error("无权操作该代发需求"))
  }
  if (isResource(demandListingId)) {
    return Promise.reject(new Error("仅支持对代发需求勾选资源发起匹配"))
  }
  var demand = getItem(demandListingId)
  if (!demand) {
    return Promise.reject(new Error("代发需求不存在"))
  }
  if (isListingClosed(demand)) {
    return Promise.reject(new Error("代发需求已关闭，暂不可匹配"))
  }
  var staffProfile = getUserProfile()
  if (!staffProfile || !staffProfile.phone) {
    return Promise.reject(new Error("运营账号信息不完整"))
  }
  var uniqueIds = []
  var seen = {}
  ;(resourceIds || []).forEach(function(id) {
    if (id && !seen[id]) {
      seen[id] = true
      uniqueIds.push(id)
    }
  })
  if (!uniqueIds.length) {
    return Promise.reject(new Error("请至少勾选一条资源"))
  }
  if (uniqueIds.length > 5) {
    return Promise.reject(new Error("一次最多勾选 5 条资源"))
  }

  var results = { created: [], skipped: [], failed: [] }
  var chain = Promise.resolve()
  uniqueIds.forEach(function(resourceId) {
    chain = chain.then(function() {
      var resource = getItem(resourceId)
      if (!resource || !isResource(resourceId)) {
        results.failed.push({ resourceId: resourceId, message: "资源不存在" })
        return
      }
      if (isListingClosed(resource)) {
        results.failed.push({ resourceId: resourceId, message: "资源已关闭" })
        return
      }
      var existing = findActiveConnectForListingPair(resourceId, demand.id)
      if (existing) {
        results.skipped.push({ resourceId: resourceId, connectId: existing.id })
        return
      }
      var resourceSub = resource.submissionId ? getSubmission(resource.submissionId) : null
      var clientPhone = resource.actualOwnerPhone || resource.ownerPhone || resource.phone
        || (resourceSub && (resourceSub.actualOwnerPhone || resourceSub.phone)) || ""
      if (clientPhone && !/^1\d{10}$/.test(String(clientPhone))) {
        results.failed.push({ resourceId: resourceId, message: "请填写正确的客户手机号" })
        return
      }
      clientPhone = clientPhone || ""
      var record = buildStaffProxyMatchConnectRecord(resource, resourceSub, demand, clientPhone, staffProfile, {
        initiatedFrom: "demand"
      })
      return saveConnectSubmissionLocal(record).then(function(saved) {
        if (!saved || !saved.id) {
          throw new Error("匹配记录保存失败")
        }
        results.created.push({ resourceId: resourceId, connectId: saved.id })
      }).catch(function(error) {
        results.failed.push({ resourceId: resourceId, message: error.message || "提交失败" })
      })
    })
  })
  return chain.then(function() {
    return results
  })
}

function createViewerDemandMatchConnects() {
  return Promise.reject(new Error("资源方不可在他人需求详情发起匹配，请由需求发布方或平台运营撮合"))
}

function createOwnerDemandMatchConnects(demandListingId, resourceIds) {
  if (!isListingPublisher(demandListingId) || isResource(demandListingId)) {
    return Promise.reject(new Error("无权操作该需求"))
  }
  if (isStaffUser()) {
    return Promise.reject(new Error("运营账号请使用代发管理发起匹配"))
  }
  if (!canApplyConnect()) {
    return Promise.reject(new Error("请先登录"))
  }
  var demand = getItem(demandListingId)
  if (!demand || isListingClosed(demand)) {
    return Promise.reject(new Error("需求不存在或已关闭"))
  }
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return Promise.reject(new Error("请先登录"))
  }
  var uniqueIds = []
  var seen = {}
  ;(resourceIds || []).forEach(function(id) {
    if (id && !seen[id]) {
      seen[id] = true
      uniqueIds.push(id)
    }
  })
  if (!uniqueIds.length) {
    return Promise.reject(new Error("请至少勾选一条资源"))
  }
  if (uniqueIds.length > 5) {
    return Promise.reject(new Error("一次最多勾选 5 条资源"))
  }

  var results = { created: [], skipped: [], failed: [] }
  var chain = Promise.resolve()
  uniqueIds.forEach(function(resourceId) {
    chain = chain.then(function() {
      var resource = getItem(resourceId)
      if (!resource || !isResource(resourceId)) {
        results.failed.push({ resourceId: resourceId, message: "资源不存在" })
        return
      }
      if (isListingClosed(resource)) {
        results.failed.push({ resourceId: resourceId, message: "资源已关闭" })
        return
      }
      var existing = findActiveConnectForListingPair(resourceId, demand.id)
      if (existing) {
        results.skipped.push({ resourceId: resourceId, connectId: existing.id })
        return
      }
      var resourceSub = resource.submissionId ? getSubmission(resource.submissionId) : null
      var record
      if (isListingPublisher(resourceId)) {
        record = buildSubmissionRecord({
          type: "connect",
          connectDirection: "resource_to_demand",
          targetType: "demand",
          targetId: demand.id,
          targetTitle: demand.title,
          sourceListingId: resource.id,
          sourceTitle: resource.title,
          title: "资源匹配需求：" + (demand.title || ""),
          company: profile.company || (resourceSub ? resourceSub.company : ""),
          contact: profile.contact || (resourceSub ? resourceSub.contact : ""),
          phone: profile.phone,
          ownerPhone: profile.phone,
          region: demand.region || profile.region || "",
          role: profile.role || (resourceSub ? resourceSub.role : ""),
          description: "需求方勾选已发布资源发起匹配申请。",
          ownerInitiatedMatch: true
        })
        enrichConnectSubmission(record)
        applyConnectProxyNotifyFields(record)
      } else {
        if (!canApplyConnectToListing(resourceId)) {
          results.failed.push({ resourceId: resourceId, message: "该资源不可对接" })
          return
        }
        record = buildSubmissionRecord({
          type: "connect",
          connectDirection: "demand_to_resource",
          targetType: "resource",
          targetId: resource.id,
          targetTitle: resource.title,
          sourceListingId: demand.id,
          sourceTitle: demand.title,
          title: "需求对接资源：" + (resource.title || ""),
          company: profile.company || "",
          contact: profile.contact || "",
          phone: profile.phone,
          ownerPhone: profile.phone,
          region: demand.region || profile.region || "",
          role: profile.role || "",
          description: "需求方在需求详情勾选资源池资源发起对接申请。"
        })
        enrichConnectSubmission(record)
      }
      if (isCloudEnabled()) {
        return cloudStore.createSubmissionRemote(record, null).then(function(result) {
          var saved = result && (result.submission || result.record) ? (result.submission || result.record) : record
          if (!saved || !saved.id) {
            throw new Error("匹配记录保存失败")
          }
          results.created.push({ resourceId: resourceId, connectId: saved.id })
        }).catch(function(error) {
          results.failed.push({ resourceId: resourceId, message: error.message || "提交失败" })
        })
      }
      var list = getAllSubmissionsRaw()
      list.unshift(record)
      wx.setStorageSync(submissionKey, list)
      results.created.push({ resourceId: resourceId, connectId: record.id })
    })
  })
  return chain.then(function() {
    return results
  })
}

function createOwnerResourceMatchConnects(resourceListingId, demandIds) {
  if (!isListingPublisher(resourceListingId) || !isResource(resourceListingId)) {
    return Promise.reject(new Error("无权操作该资源"))
  }
  if (isStaffUser()) {
    return Promise.reject(new Error("运营账号请使用代发管理发起匹配"))
  }
  if (!canApplyConnect()) {
    return Promise.reject(new Error("请先登录"))
  }
  var resource = getItem(resourceListingId)
  if (!resource || isListingClosed(resource)) {
    return Promise.reject(new Error("资源不存在或已关闭"))
  }
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return Promise.reject(new Error("请先登录"))
  }
  var resourceSub = resource.submissionId ? getSubmission(resource.submissionId) : null
  var uniqueIds = []
  var seen = {}
  ;(demandIds || []).forEach(function(id) {
    if (id && !seen[id]) {
      seen[id] = true
      uniqueIds.push(id)
    }
  })
  if (!uniqueIds.length) {
    return Promise.reject(new Error("请至少勾选一条需求"))
  }
  if (uniqueIds.length > 5) {
    return Promise.reject(new Error("一次最多勾选 5 条需求"))
  }

  var results = { created: [], skipped: [], failed: [] }
  var chain = Promise.resolve()
  uniqueIds.forEach(function(demandId) {
    chain = chain.then(function() {
      var demand = getItem(demandId)
      if (!demand || isResource(demandId)) {
        results.failed.push({ demandId: demandId, message: "需求不存在" })
        return
      }
      if (isListingClosed(demand)) {
        results.failed.push({ demandId: demandId, message: "需求已关闭" })
        return
      }
      var existing = findActiveConnectForListingPair(resourceListingId, demandId)
      if (existing) {
        results.skipped.push({ demandId: demandId, connectId: existing.id })
        return
      }
      var record = buildSubmissionRecord({
        type: "connect",
        connectDirection: "resource_to_demand",
        targetType: "demand",
        targetId: demand.id,
        targetTitle: demand.title,
        sourceListingId: resource.id,
        sourceTitle: resource.title,
        title: "资源匹配需求：" + (demand.title || ""),
        company: profile.company || (resourceSub ? resourceSub.company : ""),
        contact: profile.contact || (resourceSub ? resourceSub.contact : ""),
        phone: profile.phone,
        ownerPhone: profile.phone,
        region: demand.region || profile.region || "",
        role: profile.role || (resourceSub ? resourceSub.role : ""),
        description: "资源方勾选可对接需求发起匹配申请。",
        ownerInitiatedMatch: true
      })
      enrichConnectSubmission(record)
      applyConnectProxyNotifyFields(record)
      if (isCloudEnabled()) {
        return cloudStore.createSubmissionRemote(record, null).then(function(result) {
          var saved = result && (result.submission || result.record) ? (result.submission || result.record) : record
          if (!saved || !saved.id) {
            throw new Error("匹配记录保存失败")
          }
          results.created.push({ demandId: demandId, connectId: saved.id })
        }).catch(function(error) {
          results.failed.push({ demandId: demandId, message: error.message || "提交失败" })
        })
      }
      var list = getAllSubmissionsRaw()
      list.unshift(record)
      wx.setStorageSync(submissionKey, list)
      results.created.push({ demandId: demandId, connectId: record.id })
    })
  })
  return chain.then(function() {
    return results
  })
}

function createViewerResourceMatchConnects() {
  return Promise.reject(new Error("请点底部「申请对接」，在对接页选择您的需求"))
}

function findListingPublishSubmission(listingId) {
  if (!listingId) {
    return null
  }
  var listing = getItem(listingId)
  if (listing && listing.submissionId) {
    var linked = getSubmissionWithoutRebuild(listing.submissionId)
    if (linked && isListingPublishSubmission(linked)) {
      return linked
    }
  }
  var submissions = getAllSubmissionsRaw()
  for (var i = 0; i < submissions.length; i += 1) {
    var item = submissions[i]
    if (item && item.listingId === listingId && isListingPublishSubmission(item)) {
      return item
    }
  }
  if (isCloudEnabled() && isAdminLoggedIn()) {
    var pendingListings = wx.getStorageSync(adminPendingListingsKey) || []
    for (var j = 0; j < pendingListings.length; j += 1) {
      var pending = pendingListings[j]
      if (!pending || pending.id !== listingId || !pending.submissionId) {
        continue
      }
      var pendingSub = getSubmissionWithoutRebuild(pending.submissionId)
      if (pendingSub && isListingPublishSubmission(pendingSub)) {
        return pendingSub
      }
    }
  }
  return null
}

/** 代发商机仅客户本人算发布方；运营不算。无代发上下文时返回 null。 */
function resolveProxyListingPublisher(listingId, profile) {
  if (!listingId || !profile || !profile.phone) {
    return null
  }
  var listing = getItem(listingId)
  if (listing && isStaffProxyListing(listing)) {
    return listingBelongsToUser(listing, profile)
  }
  var submission = findListingPublishSubmission(listingId)
  if (!submission || !submission.publishedByStaff) {
    return null
  }
  var ownerPhone = submission.actualOwnerPhone || submission.ownerPhone || submission.phone || ""
  if (ownerPhone) {
    return ownerPhone === profile.phone
  }
  return false
}

/** 商机真正的发布方（含代发客户）。用于关闭、池隐藏、发布方隐私等。见 10_权限规则.md */
function isListingPublisher(listingId) {
  if (!listingId) {
    return false
  }
  var profile = getUserProfile()
  if (!profile) {
    return false
  }
  var openid = profile.openid || getMyOpenid()
  if (!openid && !profile.phone) {
    return false
  }
  var proxyPublisher = resolveProxyListingPublisher(listingId, profile)
  if (proxyPublisher !== null) {
    return proxyPublisher
  }
  var listing = getItem(listingId)
  if (listing) {
    if (listingBelongsToUser(listing, profile)) {
      var proxySub = listing.submissionId
        ? getSubmissionWithoutRebuild(listing.submissionId)
        : findListingPublishSubmission(listingId)
      if (!proxySub || !proxySub.publishedByStaff) {
        return true
      }
    }
    if (listing.submissionId) {
      var linkedSubmission = getSubmissionWithoutRebuild(listing.submissionId)
      if (!(linkedSubmission && linkedSubmission.publishedByStaff) && isOwnSubmission(listing.submissionId)) {
        return true
      }
    }
  }
  var submissions = getSubmissions()
  for (var i = 0; i < submissions.length; i += 1) {
    var submission = submissions[i]
    if (!isListingPublishSubmission(submission) || submission.listingId !== listingId) {
      continue
    }
    if (submission.publishedByStaff) {
      continue
    }
    if (submissionBelongsToUser(submission, profile)) {
      return true
    }
  }
  return false
}

/**
 * 当前用户是否以「主人/运营」身份操作该商机（含运营代发管理视图）。
 * 勿用于关闭、池隐藏、发布方隐私——那些场景用 isListingPublisher。
 */
function isOwnListing(listingId) {
  if (!listingId) {
    return false
  }
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return false
  }
  if (isStaffWorkMode()) {
    return canStaffManageProxyListing(listingId)
  }
  return isListingPublisher(listingId)
}

function resolveListingViaConnectParty(id, options) {
  options = options || {}
  if (!id || !isUserRegistered()) {
    return null
  }
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return null
  }
  var phone = profile.phone

  function connectReferencesListing(connect) {
    if (!connect || connect.type !== "connect") {
      return false
    }
    if (connect.targetId !== id && connect.sourceListingId !== id) {
      return false
    }
    return !!getConnectRole(connect, phone)
  }

  if (options.connectId) {
    var specificConnect = getSubmission(options.connectId)
    if (connectReferencesListing(specificConnect)) {
      var specificListing = getItem(id)
      if (specificListing) {
        return specificListing
      }
    }
  }

  var viewerConnect = findViewerConnectForListing(id)
  if (!viewerConnect) {
    var submissions = getSubmissions()
    for (var i = 0; i < submissions.length; i += 1) {
      if (connectReferencesListing(submissions[i])) {
        viewerConnect = submissions[i]
        break
      }
    }
  }
  if (viewerConnect) {
    return getItem(id)
  }
  return null
}

function resolveListingForDetail(id, options) {
  options = options || {}
  if (!id) {
    return null
  }
  var item = getItem(id)
  if (isStaffWorkMode()) {
    var staffGlobalListing = getStaffGlobalListing(id)
    if (staffGlobalListing) {
      item = item ? mergePreservedListingWithPublic(item, staffGlobalListing) : staffGlobalListing
    }
  } else if (item && isAdminLoggedIn() && canStaffManageProxyListing(id)) {
    var managedGlobalListing = getStaffGlobalListing(id)
    if (managedGlobalListing) {
      item = mergePreservedListingWithPublic(item, managedGlobalListing)
    }
  }
  if (item) {
    return item
  }
  if (!isUserRegistered()) {
    return null
  }
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return null
  }
  var submissions = getSubmissions()
  for (var j = 0; j < submissions.length; j += 1) {
    var submission = submissions[j]
    if (submission.listingId !== id || !submissionBelongsToUser(submission, profile)) {
      continue
    }
    var poolKey = isResource(id) ? publishedResourcesKey : publishedDemandsKey
    var pool = wx.getStorageSync(poolKey) || []
    for (var k = 0; k < pool.length; k += 1) {
      if (pool[k].id === id) {
        return pool[k]
      }
    }
  }
  if (isAdminLoggedIn()) {
    var adminPendingListing = findAdminPendingListing(id)
    if (adminPendingListing) {
      return adminPendingListing
    }
    var proxyListing = getItem(id)
    if (proxyListing && proxyListingBelongsToStaff(proxyListing, profile)) {
      return proxyListing
    }
    var staffGlobalListing = getStaffGlobalListing(id)
    if (staffGlobalListing) {
      return staffGlobalListing
    }
  }
  return resolveListingViaConnectParty(id, options)
}

function filterUserActiveListings(items) {
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return []
  }
  return (items || []).filter(function(item) {
    if (isListingClosed(item) || !isListingPubliclyVisible(item)) {
      return false
    }
    if (!item.submissionId) {
      return false
    }
    var submission = getSubmission(item.submissionId)
    if (!submission) {
      return false
    }
    return submissionBelongsToUser(submission, profile)
  })
}

function getUserActiveDemands() {
  return prepareDemandListForView(filterUserActiveListings(getPublishedDemands()))
}

function getUserActiveResources() {
  return prepareResourceListForView(filterUserActiveListings(getPublishedResources()))
}

function isResourceToDemandConnect(submission) {
  return !!(submission && submission.connectDirection === "resource_to_demand")
}

/** 需求方在资源详情发起的对接申请（非资源方匹配需求） */
function isDemandToResourceConnect(submission) {
  if (!submission || submission.type !== "connect") {
    return false
  }
  if (submission.connectDirection === "resource_to_demand") {
    return false
  }
  if (submission.connectDirection === "demand_to_resource") {
    return true
  }
  return !!(submission.targetId && isResource(submission.targetId))
}

function closeUserListing(listingId) {
  if (!listingId || (listingId.indexOf("UDEM-") !== 0 && listingId.indexOf("URES-") !== 0)) {
    return Promise.resolve({ ok: false, message: "只能关闭资源或需求类型的公示" })
  }
  var listing = getItem(listingId)
  if (!listing) {
    return Promise.resolve({ ok: false, message: "公示不存在" })
  }
  if (isListingClosed(listing)) {
    return Promise.resolve({ ok: false, message: "该商机已关闭" })
  }
  if (!isListingPublisher(listingId) && !canStaffManageProxyListing(listingId)) {
    return Promise.resolve({ ok: false, message: "只能由发布方本人或负责运营关闭该商机" })
  }
  if (!listing.submissionId) {
    return Promise.resolve({ ok: false, message: "关联提交不存在" })
  }
  var poolLabel = isResource(listingId) ? "资源池" : "需求池"
  var closeHint = isStaffProxyListing(listing)
    ? "代发商机已关闭，不再在" + poolLabel + "公开展示。"
    : "你已关闭该商机，不再在" + poolLabel + "公开展示。"

  if (isCloudEnabled()) {
    var submission = getSubmission(listing.submissionId)
    var statusTimeline = (submission && submission.statusTimeline ? submission.statusTimeline.slice() : [])
    statusTimeline.push({
      status: "已关闭",
      time: formatDate(new Date()),
      hint: closeHint
    })
    return cloudStore.patchSubmissionRemote(listing.submissionId, {
      status: "已关闭",
      statusTimeline: statusTimeline,
      closedAt: formatDate(new Date()),
      listingPatch: {
        status: "closed",
        verification: "已关闭"
      }
    }).then(function() {
      return closeUnfinishedConnectsForListing(listingId)
    }).then(function() {
      return refreshPublicListings(isResource(listingId) ? "resource" : "demand", 1)
    }).then(function() {
      return { ok: true }
    }).catch(function(error) {
      return { ok: false, message: error.message || "关闭失败" }
    })
  }

  updatePublishedListing(listingId, {
    status: "closed",
    verification: "已关闭"
  })
  appendSubmissionTimeline(
    listing.submissionId,
    "已关闭",
    closeHint,
    { closedAt: formatDate(new Date()) }
  )
  return closeUnfinishedConnectsForListing(listingId).then(function() {
    return { ok: true }
  })
}

function closeUserDemand(listingId) {
  return closeUserListing(listingId)
}

function isListingPrivateDisplay(listing, submission) {
  if (listing && listing.publicDisplay === false) {
    return true
  }
  if (submission && submission.publicDisplay === false) {
    return true
  }
  return false
}

function getListingApprovedPublicHint(listing, submission, options) {
  options = options || {}
  var poolLabel = listing && isResource(listing.id) ? "资源池" : "需求池"
  var isPrivate = isListingPrivateDisplay(listing, submission)
  if (options.staffReview) {
    return isPrivate
      ? "撮合经理已完成初审，未开启公开展示，仅发布方可在提交记录中查看。"
      : "撮合经理已完成初审，信息已在公开展示池展示。"
  }
  return isPrivate
    ? "平台已完成初审，未开启公开展示，仅你可在提交记录中查看。"
    : "平台已完成初审，信息已在公开展示池展示。"
}

function buildPublicDisplayToggleHint(listingId, enabled) {
  var poolLabel = isResource(listingId) ? "资源池" : "需求池"
  if (enabled !== false) {
    return "已开启公开展示，他人可在" + poolLabel + "查看并申请对接（企业名称与联系方式已脱敏）。"
  }
  return "已关闭公开展示，不再在" + poolLabel + "展示；仅你可在提交记录中查看。"
}

function canToggleListingPublicDisplay(listingId) {
  if (!listingId) {
    return false
  }
  var listing = getItem(listingId)
  if (!listing || isListingClosed(listing)) {
    return false
  }
  if (!listing.submissionId) {
    return false
  }
  return isListingPublisher(listingId) || canStaffManageProxyListing(listingId)
}

function setListingPublicDisplay(listingId, enabled) {
  if (!canToggleListingPublicDisplay(listingId)) {
    return Promise.resolve({ ok: false, message: "当前无法调整公开展示设置" })
  }
  var listing = getItem(listingId)
  var submission = getSubmission(listing.submissionId)
  if (!submission) {
    return Promise.resolve({ ok: false, message: "关联提交不存在" })
  }
  var publicDisplay = enabled !== false
  var hint = buildPublicDisplayToggleHint(listingId, publicDisplay)
  var statusTimeline = (submission.statusTimeline || []).slice()
  statusTimeline.push({
    status: getSubmissionDisplayStatus(submission),
    time: formatDate(new Date()),
    hint: hint
  })

  if (isCloudEnabled()) {
    return cloudStore.patchSubmissionRemote(listing.submissionId, {
      publicDisplay: publicDisplay,
      statusTimeline: statusTimeline,
      listingPatch: { publicDisplay: publicDisplay }
    }).then(function() {
      return refreshPublicListings(isResource(listingId) ? "resource" : "demand", 1)
    }).then(function() {
      return { ok: true, publicDisplay: publicDisplay }
    }).catch(function(error) {
      return { ok: false, message: error.message || "设置失败" }
    })
  }

  updatePublishedListing(listingId, { publicDisplay: publicDisplay })
  appendSubmissionTimeline(
    listing.submissionId,
    getSubmissionDisplayStatus(submission),
    hint,
    { publicDisplay: publicDisplay }
  )
  return Promise.resolve({ ok: true, publicDisplay: publicDisplay })
}

function shouldExcludeListingFromPublicPool(listingId, listingHint) {
  if (!listingId || !isUserRegistered()) {
    return false
  }
  var listing = (listingHint && listingHint.id === listingId) ? listingHint : getItem(listingId)
  // 平台代发商机：运营账号在公开展示池一律可见（仅代发客户本人会被隐藏）
  if (isStaffUser()) {
    if (listing && isStaffProxyListing(listing)) {
      return false
    }
    var submission = findListingPublishSubmission(listingId)
    if (submission && submission.publishedByStaff) {
      return false
    }
  }
  return isListingPublisher(listingId)
}

function getListingPermissionContext(listingId, options) {
  options = options || {}
  var isResourceListing = isResource(listingId)
  var isGuest = options.isGuest != null
    ? !!options.isGuest
    : (!isUserRegistered() && !isAdminLoggedIn())
  var listing = getItem(listingId)
  return permissions.buildListingPermissionContext(listingId, {
    isResource: isResourceListing,
    isGuest: isGuest,
    isPublisher: isListingPublisher(listingId),
    isStaffProxyManager: canStaffManageProxyListing(listingId),
    isStaffProxyViewer: canStaffViewProxyListingConnects(listingId),
    isStaffUser: isStaffUser(),
    isClosed: !!(listing && isListingClosed(listing)),
    isMatchPreview: !!options.isMatchPreview,
    isConnectPreview: !!options.isConnectPreview,
    canApplyConnect: canApplyConnect(),
    canViewPublisherInfo: canViewListingPublisherInfo(listingId, {
      isListingPublisher: isListingPublisher(listingId),
      isStaffProxyView: canStaffManageProxyListing(listingId),
      forPlatformAdmin: isPlatformAdminUser() && isStaffWorkMode(),
      fromShare: !!options.fromShare
    }),
    canClose: canCloseListing(listingId)
  })
}

function filterPoolListings(items) {
  return (items || []).filter(function(item) {
    if (!item || !item.id || !isListingPubliclyVisible(item)) {
      return false
    }
    if (shouldExcludeListingFromPublicPool(item.id, item)) {
      return false
    }
    return true
  })
}

function resolveListingPublicPoolType(item) {
  if (!item || !item.id) {
    return null
  }
  if (item.pool === "demand" || item.pool === "resource") {
    return item.pool
  }
  var poolById = getListingPool(item.id)
  if (poolById) {
    return poolById
  }
  return isResource(item.id) ? "resource" : "demand"
}

/** 补齐仅存在于代发管理/提交记录、尚未写入公开展示池缓存的已审核代发商机 */
function appendStaffProxyPublicPoolListings(items, poolType) {
  if (!isStaffUser()) {
    return items || []
  }
  var list = (items || []).slice()
  var seen = {}
  list.forEach(function(item) {
    if (item && item.id) {
      seen[item.id] = true
    }
  })
  getStaffProxyListings().forEach(function(item) {
    if (!item || !item.id || seen[item.id]) {
      return
    }
    if (resolveListingPublicPoolType(item) !== poolType) {
      return
    }
    seen[item.id] = true
    list.push(item)
  })
  return list
}

function getResources() {
  cloudStore.reconcilePublishedListingPools()
  var list = filterPoolListings(appendStaffProxyPublicPoolListings(
    getPublishedResources().concat(resources).filter(function(item) {
      return !item || !item.id || getListingPool(item.id) !== "demand"
    }),
    "resource"
  ))
  return matching.applyQualityScores(list)
}

function getDemands() {
  cloudStore.reconcilePublishedListingPools()
  var list = filterPoolListings(appendStaffProxyPublicPoolListings(
    getPublishedDemands().concat(collectMisplacedDemandListings()).concat(demands),
    "demand"
  ))
  return matching.applyQualityScores(list)
}

function getItem(id) {
  var list = getAllListings()
  for (var i = 0; i < list.length; i += 1) {
    if (list[i].id === id) {
      return list[i]
    }
  }
  var pendingListing = findAdminPendingListing(id)
  if (pendingListing) {
    return pendingListing
  }
  var staffListing = getStaffGlobalListing(id)
  if (staffListing) {
    return staffListing
  }
  return null
}

function lookupTradeRecordById(keyword) {
  var id = String(keyword || "").trim()
  if (!id) {
    return null
  }
  var listing = getItem(id)
  if (listing && listing.id) {
    return {
      kind: "listing",
      id: listing.id,
      pool: isResource(listing.id) ? "resource" : "demand",
      label: idFactory.getTradeIdTypeLabel(listing.id),
      url: getDetailPageUrl(listing.id)
    }
  }
  var submission = getSubmission(id)
  if (submission && submission.id) {
    var submissionUrl = "/pages/record/record?id=" + encodeURIComponent(submission.id)
    if (submission.type === "certify") {
      submissionUrl = "/pages/cert-record/cert-record?id=" + encodeURIComponent(submission.id)
    }
    return {
      kind: "submission",
      id: submission.id,
      submitType: submission.type,
      label: idFactory.getTradeIdTypeLabel(submission.id) || "提交记录",
      url: submissionUrl
    }
  }
  if (isStaffUser() && isStaffWorkMode()) {
    var staffConnect = getStaffGlobalConnectRaw(id)
    if (staffConnect && staffConnect.id) {
      return {
        kind: "connect",
        id: staffConnect.id,
        submitType: "connect",
        label: "对接",
        url: "/pages/ops-connect-detail/ops-connect-detail?id=" + encodeURIComponent(staffConnect.id)
      }
    }
  }
  return null
}

function filterSubmissionsByKeyword(items, keyword) {
  keyword = String(keyword || "").trim()
  if (!keyword) {
    return items || []
  }
  if (idFactory.looksLikeTradeIdKeyword(keyword)) {
    return (items || []).filter(function(item) {
      return idFactory.itemMatchesTradeIdKeyword(item, keyword)
    })
  }
  var normalized = keyword.toLowerCase()
  return (items || []).filter(function(item) {
    if (idFactory.itemMatchesTradeIdKeyword(item, keyword)) {
      return true
    }
    var text = [
      item.id,
      item.listingId,
      item.targetId,
      item.sourceListingId,
      item.cardTitle,
      item.title,
      item.summaryLine,
      item.description,
      item.targetTitle,
      item.sourceTitle
    ].join(" ").toLowerCase()
    return text.indexOf(normalized) > -1
  })
}

function tryNavigateTradeIdSearch(keyword, options) {
  options = options || {}
  var lookup = lookupTradeRecordById(keyword)
  if (!lookup || !lookup.url) {
    if (options.toastOnMiss !== false) {
      wx.showToast({ title: "未找到该编号", icon: "none" })
    }
    return false
  }
  if (options.pool === "resource") {
    if (lookup.kind !== "listing" || lookup.pool !== "resource") {
      wx.showToast({ title: "该编号不是资源", icon: "none" })
      return false
    }
  }
  if (options.pool === "demand") {
    if (lookup.kind !== "listing" || lookup.pool !== "demand") {
      wx.showToast({ title: "该编号不是需求", icon: "none" })
      return false
    }
  }
  if (options.pool === "connect") {
    if (lookup.kind !== "submission" || lookup.submitType !== "connect") {
      if (!(lookup.kind === "connect")) {
        wx.showToast({ title: "该编号不是对接记录", icon: "none" })
        return false
      }
    }
  }
  wx.navigateTo({ url: lookup.url })
  return true
}

function isResource(id) {
  return id && (id.indexOf("RES-") === 0 || id.indexOf("URES-") === 0)
}

function maskCompany(name) {
  if (!name) {
    return "已登记企业"
  }
  if (name.length <= 2) {
    return name.charAt(0) + "*"
  }
  if (name.length <= 4) {
    return name.slice(0, 1) + "**" + name.slice(-1)
  }
  return name.slice(0, 2) + "***" + name.slice(-2)
}

function formatDateOnly(date) {
  function pad(value) {
    return value < 10 ? "0" + value : "" + value
  }
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate())
}

function buildTags(type, region, extra) {
  var tags = [type, region, "用户发布"]
  if (extra) {
    tags.unshift(extra)
  }
  return tags.filter(function(tag, index) {
    return tag && tags.indexOf(tag) === index
  }).slice(0, 4)
}

function isServerListingType(type) {
  return C.normalizeResourceType(type) === "算力整机" || C.normalizeDemandType(type) === "算力整机"
}

function isPartsListingType(type) {
  return C.normalizeResourceType(type) === "硬件配件" || C.normalizeDemandType(type) === "硬件配件"
}

function getResourceFormProfile(listingType) {
  var normalizedType = C.normalizeResourceType(listingType)
  return {
    isServerForm: isServerListingType(normalizedType),
    isRentalForm: C.rentalResourceTypes.indexOf(normalizedType) > -1,
    isPartsForm: C.partsResourceTypes.indexOf(normalizedType) > -1,
    isMaintForm: C.maintenanceResourceTypes.indexOf(normalizedType) > -1,
    isRoomBuildForm: C.roomBuildResourceTypes.indexOf(normalizedType) > -1,
    isDcOpForm: C.dcOpResourceTypes.indexOf(normalizedType) > -1,
    isFinanceForm: C.financeResourceTypes.indexOf(normalizedType) > -1,
    isComprehensiveForm: C.comprehensiveResourceTypes.indexOf(normalizedType) > -1,
    isOtherForm: C.comprehensiveResourceTypes.indexOf(normalizedType) > -1,
    isComputeForm: C.rentalResourceTypes.indexOf(normalizedType) > -1,
    isIdcForm: false
  }
}

function getDemandFormProfile(listingType) {
  var normalizedType = C.normalizeDemandType(listingType)
  return {
    isServerForm: isServerListingType(normalizedType),
    isRentalForm: C.rentalResourceTypes.indexOf(normalizedType) > -1,
    isPartsForm: C.partsResourceTypes.indexOf(normalizedType) > -1,
    isMaintForm: C.maintenanceResourceTypes.indexOf(normalizedType) > -1,
    isRoomBuildForm: C.roomBuildResourceTypes.indexOf(normalizedType) > -1,
    isDcOpForm: C.dcOpResourceTypes.indexOf(normalizedType) > -1,
    isFinanceForm: C.financeResourceTypes.indexOf(normalizedType) > -1,
    isComprehensiveForm: C.comprehensiveResourceTypes.indexOf(normalizedType) > -1,
    isOtherForm: C.comprehensiveResourceTypes.indexOf(normalizedType) > -1,
    isComputeForm: C.rentalResourceTypes.indexOf(normalizedType) > -1,
    isIdcForm: false,
    isAgentForm: false
  }
}

function createAttachmentId() {
  return "ATT-" + Date.now() + "-" + Math.floor(Math.random() * 1000)
}

function guessAttachmentType(fileName, filePath) {
  var name = String(fileName || filePath || "").toLowerCase()
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(name)) {
    return "image"
  }
  return "file"
}

function saveSubmissionAttachment(tempFilePath, fileName) {
  var safeName = (fileName || "附件").trim() || "附件"
  var fileType = guessAttachmentType(safeName, tempFilePath)
  if (isCloudEnabled() && cloudStore.uploadSubmissionAttachment) {
    return cloudStore.uploadSubmissionAttachment(tempFilePath, safeName).then(function(url) {
      return {
        id: createAttachmentId(),
        name: safeName,
        url: url,
        fileType: fileType
      }
    })
  }
  return new Promise(function(resolve, reject) {
    if (!tempFilePath) {
      reject(new Error("未选择文件"))
      return
    }
    var fs = wx.getFileSystemManager()
    var extMatch = safeName.match(/\.([a-zA-Z0-9]+)$/)
    var ext = extMatch ? extMatch[1] : (tempFilePath.indexOf(".png") > -1 ? "png" : "jpg")
    var basePath = wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : ""
    if (!basePath) {
      resolve({
        id: createAttachmentId(),
        name: safeName,
        url: tempFilePath,
        fileType: fileType
      })
      return
    }
    var filePath = basePath + "/attach_" + Date.now() + "_" + Math.floor(Math.random() * 1000) + "." + ext
    fs.saveFile({
      tempFilePath: tempFilePath,
      filePath: filePath,
      success: function(res) {
        resolve({
          id: createAttachmentId(),
          name: safeName,
          url: res.savedFilePath || filePath,
          fileType: fileType
        })
      },
      fail: function() {
        resolve({
          id: createAttachmentId(),
          name: safeName,
          url: tempFilePath,
          fileType: fileType
        })
      }
    })
  })
}

function resolveSubmissionAttachments(attachments, options) {
  var list = attachments || []
  if (list.length === 0) {
    return Promise.resolve([])
  }
  if (!isCloudEnabled() || !cloudStore.resolveCloudImageUrls) {
    return Promise.resolve(list.map(function(item) {
      return Object.assign({}, item, { displayUrl: item.url })
    }))
  }
  return cloudStore.resolveCloudImageUrls(list.map(function(item) {
    return { url: item.url, label: item.name || item.label }
  }), options).then(function(resolved) {
    return list.map(function(item, index) {
      var resolvedItem = resolved[index] || {}
      var displayUrl = resolvedItem.displayUrl || resolvedItem.url || item.url
      return Object.assign({}, item, {
        displayUrl: displayUrl,
        unavailable: !!resolvedItem.unavailable,
        unavailableHint: resolvedItem.unavailableHint || ""
      })
    })
  })
}

function canEditSubmissionAttachments(record) {
  if (!record || record.type === "connect" || record.type === "certify" || record.type === "match") {
    return false
  }
  var profile = getUserProfile()
  if (!profile || !submissionBelongsToUser(record, profile)) {
    return false
  }
  var editableStatuses = ["待审核", "认证中", "待跟进"]
  return editableStatuses.indexOf(record.status) > -1
}

function updateSubmissionAttachments(submissionId, attachments) {
  var record = getSubmission(submissionId)
  if (!record) {
    return Promise.reject(new Error("记录不存在"))
  }
  if (!canEditSubmissionAttachments(record)) {
    return Promise.reject(new Error("当前状态不可修改附件"))
  }
  var nextAttachments = (attachments || []).slice(0, C.MAX_SUBMISSION_ATTACHMENTS)
  if (isCloudEnabled()) {
    return cloudStore.patchSubmissionRemote(submissionId, {
      attachments: nextAttachments
    }).then(function() {
      return getSubmission(submissionId)
    })
  }
  var list = getAllSubmissionsRaw()
  var index = -1
  for (var i = 0; i < list.length; i += 1) {
    if (list[i].id === submissionId) {
      index = i
      break
    }
  }
  if (index === -1) {
    return Promise.reject(new Error("记录不存在"))
  }
  list[index] = Object.assign({}, list[index], { attachments: nextAttachments })
  wx.setStorageSync(submissionKey, list)
  return Promise.resolve(list[index])
}

function getServerConfigText(source) {
  if (!source) {
    return ""
  }
  var spec = String(source.configSpec || "").trim()
  var detail = String(source.configDetail || "").trim()
  if (spec && detail) {
    if (spec === detail || spec.indexOf(detail) > -1) {
      return spec
    }
    if (detail.indexOf(spec) > -1) {
      return detail
    }
    return spec + "；" + detail
  }
  return spec || detail
}

function getServerConfigSummary(source, maxLen) {
  var text = getServerConfigText(source)
  if (!text) {
    return ""
  }
  var limit = maxLen || 36
  return text.length > limit ? text.slice(0, limit) + "..." : text
}

function getResourceListingRegion(form) {
  if (!form) {
    return ""
  }
  if (isServerListingType(form.listingType) || isPartsListingType(form.listingType)) {
    return form.procurementRegion || form.region || ""
  }
  if (form.region && !isPlaceholderValue(form.region)) {
    return form.region
  }
  if (form.procurementRegion) {
    return form.procurementRegion
  }
  if (form.idcName) {
    return form.idcName
  }
  if (form.dcName) {
    return form.dcName
  }
  return ""
}

function buildPartsResourceDetails(form) {
  var rows = []
  var desc = (form.description || "").trim()
  pushDetailRow(rows, "配件名称", form.serverProduct)
  pushDetailRow(rows, "规格型号", form.specModel)
  pushDetailRow(rows, "数量", form.scale)
  pushDetailRow(rows, "报价", form.price, "面议")
  pushDetailRow(rows, "交期", form.deliveryTime || form.cycle)
  pushDetailRow(rows, "质保", form.warranty)
  pushDetailRow(rows, "发货地点", form.procurementRegion || form.region)
  pushDetailRow(rows, "备注", desc)
  pushDetailRow(rows, "企业角色", form.role)
  return rows
}

function buildPartsDemandDetails(form) {
  var rows = []
  var desc = (form.description || "").trim()
  pushDetailRow(rows, "配件名称", form.serverProduct)
  pushDetailRow(rows, "规格型号", form.specModel)
  pushDetailRow(rows, "数量", form.scale)
  pushDetailRow(rows, "预算", form.budget)
  pushDetailRow(rows, "交期", form.deliveryTime || form.startTime, "尽快")
  pushDetailRow(rows, "质保", form.warranty)
  pushDetailRow(rows, "收货地点", form.procurementRegion)
  pushDetailRow(rows, "品牌偏好", form.serverBrand, "不限")
  pushDetailRow(rows, "备注", desc)
  pushDetailRow(rows, "企业角色", form.role)
  return rows
}

function buildResourceDetails(form) {
  if (isServerListingType(form.listingType)) {
    var rows = []
    var desc = (form.description || "").trim()
    pushDetailRow(rows, "产品", form.serverProduct)
    pushDetailRow(rows, "规格", getServerConfigText(form))
    pushDetailRow(rows, "质保", form.warranty)
    pushDetailRow(rows, "数量", normalizeListingScaleForServer(form))
    pushDetailRow(rows, "报价", form.price, "面议")
    pushDetailRow(rows, "交期", form.deliveryTime || form.cycle)
    pushDetailRow(rows, "地点", form.procurementRegion || form.region)
    pushDetailRow(rows, "支付", form.serverPayment)
    pushDetailRow(rows, "流程", form.serverProcess)
    pushDetailRow(rows, "备注", desc)
    pushDetailRow(rows, "企业角色", form.role)
    return rows
  }
  if (isPartsListingType(form.listingType)) {
    return buildPartsResourceDetails(form)
  }
  var profile = getResourceFormProfile(form.listingType)
  var rows = [
    { label: "资源类型", value: form.listingType },
    { label: "资源描述", value: form.description || "暂无" }
  ]
  if (form.region && !isPlaceholderValue(form.region)) {
    rows.push({ label: "企业所在地", value: form.region })
  }
  rows.push(
    { label: "资源规模", value: form.scale },
    { label: "价格说明", value: form.price || "面议" },
    { label: "企业角色", value: form.role }
  )
  if (profile.isRentalForm) {
    rows.push(
      { label: "租赁标的", value: form.rentalSubject || form.specModel || "待沟通确认" },
      { label: "型号/规格", value: form.specModel || "待沟通确认" },
      { label: "租期/周期", value: form.cycle || "待沟通确认" },
      { label: "交付方式", value: form.delivery || "待沟通确认" },
      { label: "交付周期", value: form.deliveryTime || "待沟通确认" },
      { label: "网络/配套", value: form.networkSpec || "待沟通确认" },
      { label: "数据中心", value: form.idcName || "待沟通确认" },
      { label: "机房等级", value: form.idcLevel || "待沟通确认" },
      { label: "单柜功率", value: form.cabinetPower || "待沟通确认" },
      { label: "带宽资源", value: form.bandwidth || "待沟通确认" }
    )
  } else if (profile.isMaintForm) {
    rows.push(
      { label: "维保对象", value: form.maintenanceTarget || form.scale || "待沟通确认" },
      { label: "服务级别", value: form.warranty || "待沟通确认" },
      { label: "服务范围", value: form.serviceScope || "待沟通确认" },
      { label: "合作周期", value: form.cycle || form.deliveryTime || "待沟通确认" }
    )
  } else if (profile.isRoomBuildForm) {
    rows.push(
      { label: "建设规模", value: form.projectScale || form.scale || "待沟通确认" },
      { label: "服务范围", value: form.serviceScope || "待沟通确认" },
      { label: "项目周期", value: form.deliveryTime || form.cycle || "待沟通确认" }
    )
  } else if (profile.isDcOpForm) {
    rows.push(
      { label: "数据中心名称", value: form.dcName || "待沟通确认" },
      { label: "运营规模", value: form.scale || "待沟通确认" },
      { label: "服务内容", value: form.serviceScope || "待沟通确认" },
      { label: "合作周期", value: form.cycle || "待沟通确认" }
    )
  } else if (profile.isFinanceForm) {
    rows.push(
      { label: "资金用途", value: form.financePurpose || form.serviceScope || "待沟通确认" },
      { label: "资金规模", value: form.financeScale || form.scale || form.price || "待沟通确认" },
      { label: "合作方式", value: form.financeMode || form.cycle || "待沟通确认" },
      { label: "合作周期", value: form.deliveryTime || form.cycle || "待沟通确认" }
    )
  }
  return rows.filter(function(row) {
    return row.value && row.value !== "待沟通确认"
  })
}

function isPlaceholderValue(value) {
  if (!value) {
    return true
  }
  var text = String(value).trim()
  var placeholders = ["待沟通确认", "待沟通", "见需求说明", "待联系", "暂无", "不限"]
  return placeholders.indexOf(text) > -1
}

function pushDetailRow(rows, label, value, fallback) {
  var formatted = value
  if (isPlaceholderValue(formatted)) {
    formatted = fallback || ""
  }
  if (formatted) {
    rows.push({ label: label, value: formatted })
  }
}

function getServerDeliveryKind(deliveryTime) {
  var text = String(deliveryTime || "").trim()
  if (!text) {
    return ""
  }
  if (text.indexOf("准现货") >= 0) {
    return "准现货"
  }
  if (text.indexOf("现货") >= 0) {
    return "现货"
  }
  if (text.indexOf("期货") >= 0) {
    return "期货"
  }
  return ""
}

function parseServerDeliveryTime(deliveryTime) {
  var text = String(deliveryTime || "").trim()
  var kind = getServerDeliveryKind(text)
  var detail = ""
  if (kind) {
    detail = text.slice(text.indexOf(kind) + kind.length).trim()
    detail = detail.replace(/^[\s\/\-·、,，\(（]+/, "").replace(/[\)）]$/, "").trim()
  }
  return {
    deliveryKind: kind,
    deliveryTimeDetail: detail
  }
}

function buildServerDeliveryTime(deliveryKind, deliveryTimeDetail) {
  var kind = String(deliveryKind || "").trim()
  var detail = String(deliveryTimeDetail || "").trim()
  if (!kind) {
    return ""
  }
  return detail ? (kind + " " + detail) : kind
}

function titleHasServerDeliveryKind(title) {
  return /准现货|现货|期货/.test(String(title || ""))
}

function buildServerResourceTitle(source) {
  if (!source) {
    return ""
  }
  var customTitle = String(source.title || "").trim()
  var product = String(source.serverProduct || "").trim()
  var scale = String(source.scale || "").trim()
  var cycle = String(source.cycle || source.deliveryTime || "").trim()
  var kind = getServerDeliveryKind(cycle) || source.deliveryKind || ""
  var parts = []
  if (kind) {
    parts.push(kind)
  }
  if (product) {
    parts.push(product)
  } else if (customTitle && !titleHasServerDeliveryKind(customTitle)) {
    parts.push(customTitle)
  }
  if (scale) {
    parts.push(scale)
  }
  if (parts.length) {
    return parts.join(" ")
  }
  return customTitle || String(source.listingType || "算力整机")
}

function buildPartsResourceTitle(source) {
  if (!source) {
    return ""
  }
  var customTitle = String(source.title || "").trim()
  if (customTitle) {
    return customTitle
  }
  var product = String(source.serverProduct || "").trim()
  var spec = String(source.specModel || "").trim()
  var scale = String(source.scale || "").trim()
  var parts = []
  if (product) {
    parts.push(product)
  } else if (spec) {
    parts.push(spec)
  }
  if (scale) {
    parts.push(scale)
  }
  return parts.length ? parts.join(" ") : "硬件配件"
}

function buildPartsResourceHighlights(form) {
  var highlights = []
  if (form.serverProduct && !isPlaceholderValue(form.serverProduct)) {
    highlights.push(form.serverProduct)
  } else if (form.specModel && !isPlaceholderValue(form.specModel)) {
    highlights.push(form.specModel)
  }
  if (form.scale && !isPlaceholderValue(form.scale)) {
    highlights.push(form.scale)
  }
  if (form.price && !isPlaceholderValue(form.price)) {
    highlights.push(form.price)
  }
  if (form.deliveryTime && !isPlaceholderValue(form.deliveryTime)) {
    highlights.push(form.deliveryTime)
  } else if (form.warranty && !isPlaceholderValue(form.warranty)) {
    highlights.push(form.warranty)
  }
  if (highlights.indexOf("待平台核验") === -1) {
    highlights.push("待平台核验")
  }
  return highlights.filter(function(item, index, arr) {
    return item && arr.indexOf(item) === index
  }).slice(0, 4)
}

function buildGeneralDemandPoolTitle(item) {
  var parts = []
  var type = C.normalizeDemandType(item && item.type)
  if (type && !isPlaceholderValue(type)) {
    parts.push(type)
  }
  if (item && item.scale && !isPlaceholderValue(item.scale)) {
    parts.push(item.scale)
  }
  if (item && item.budget && !isPlaceholderValue(item.budget)) {
    parts.push(item.budget)
  }
  if (parts.length) {
    return parts.join(" ")
  }
  var summary = String((item && item.summary) || "").trim()
  if (summary) {
    return summary.length > 40 ? summary.slice(0, 40) + "..." : summary
  }
  return type ? type + "需求" : "需求"
}

function resolveDemandDisplayTitle(item) {
  if (!item) {
    return ""
  }
  var displayType = C.normalizeDemandType(item.type)
  var title = String(item.title || "").trim()
  if (isServerListingType(displayType)) {
    return resolveServerResourceDisplayTitle(Object.assign({}, item, { type: displayType })) || title || displayType || "算力整机"
  }
  if (isPartsListingType(displayType)) {
    return buildPartsResourceTitle(item) || title || "硬件配件"
  }
  if (title) {
    return title
  }
  return buildGeneralDemandPoolTitle(item)
}

function resolveServerResourceDisplayTitle(item) {
  if (!item || !isServerListingType(item.type)) {
    return item ? item.title : ""
  }
  var title = String(item.title || "").trim()
  if (titleHasServerDeliveryKind(title)) {
    return title
  }
  return buildServerResourceTitle(item) || title
}

function buildServerResourceHighlights(form) {
  var highlights = []
  var kind = getServerDeliveryKind(form.deliveryTime || form.cycle)
  if (kind) {
    highlights.push(kind)
  }
  if (form.deliveryTime && !isPlaceholderValue(form.deliveryTime)) {
    highlights.push(form.deliveryTime)
  }
  if (form.serverProduct && !isPlaceholderValue(form.serverProduct)) {
    highlights.push(form.serverProduct)
  } else {
    var configSummary = getServerConfigSummary(form, 36)
    if (configSummary && !isPlaceholderValue(configSummary)) {
      highlights.push(configSummary)
    }
  }
  if (form.scale && !isPlaceholderValue(form.scale)) {
    highlights.push(form.scale)
  }
  if (form.procurementRegion && !isPlaceholderValue(form.procurementRegion)) {
    var address = String(form.procurementRegion).trim()
    highlights.push(address.length > 24 ? address.slice(0, 24) + "..." : address)
  }
  if (form.price && !isPlaceholderValue(form.price)) {
    highlights.push(form.price)
  } else if (form.warranty && !isPlaceholderValue(form.warranty)) {
    highlights.push(form.warranty)
  }
  if (highlights.indexOf("待平台核验") === -1) {
    highlights.push("待平台核验")
  }
  return highlights.filter(function(item, index, arr) {
    return item && arr.indexOf(item) === index
  }).slice(0, 4)
}

function buildDemandSummary(form, listingType) {
  var desc = (form.description || "").trim()
  if (desc) {
    return desc
  }
  var title = (form.title || "").trim()
  if (title) {
    return title
  }
  var parts = []
  if (form.scene && !isPlaceholderValue(form.scene)) {
    parts.push(form.scene)
  }
  if (form.scale && !isPlaceholderValue(form.scale)) {
    parts.push(form.scale)
  }
  if (form.region) {
    parts.push(form.region)
  }
  return parts.join("，") || ((form.region || "待确认地区") + " " + listingType + "需求")
}

function buildDemandHighlights(form, listingType) {
  var isServer = isServerListingType(listingType)
  var isParts = isPartsListingType(listingType)
  var highlights = []
  if (isServer) {
    var serverKind = getServerDeliveryKind(form.deliveryTime || form.cycle)
    if (serverKind) {
      highlights.push(serverKind)
    }
    if (form.deliveryTime && !isPlaceholderValue(form.deliveryTime)) {
      highlights.push(form.deliveryTime)
    }
    if (form.serverProduct && !isPlaceholderValue(form.serverProduct)) {
      highlights.push(form.serverProduct)
    } else {
      var configSummary = getServerConfigSummary(form, 36)
      if (configSummary && !isPlaceholderValue(configSummary)) {
        highlights.push(configSummary)
      }
    }
  }
  if (isParts) {
    if (form.serverProduct && !isPlaceholderValue(form.serverProduct)) {
      highlights.push(form.serverProduct)
    } else if (form.specModel && !isPlaceholderValue(form.specModel)) {
      highlights.push(form.specModel)
    }
  }
  if ((isServer || isParts) && form.procurementRegion && !isPlaceholderValue(form.procurementRegion)) {
    var address = String(form.procurementRegion).trim()
    highlights.push(address.length > 24 ? address.slice(0, 24) + "..." : address)
  }
  if (form.scale && !isPlaceholderValue(form.scale)) {
    highlights.push(form.scale)
  }
  if (form.budget && !isPlaceholderValue(form.budget)) {
    highlights.push("预算 " + form.budget)
  }
  if (!isServer && form.deliveryTime && !isPlaceholderValue(form.deliveryTime)) {
    highlights.push("交货 " + form.deliveryTime)
  } else if (!isServer && form.startTime && !isPlaceholderValue(form.startTime) && form.startTime !== "尽快") {
    highlights.push("期望 " + form.startTime)
  }
  var desc = (form.description || "").trim()
  if (highlights.length < 2 && desc) {
    highlights.push(desc.length > 36 ? desc.slice(0, 36) + "..." : desc)
  }
  if (highlights.length === 0) {
    highlights.push(listingType, form.region || "待确认地区")
  }
  if (highlights.indexOf("待平台核验") === -1) {
    highlights.push("待平台核验")
  }
  return highlights.filter(function(item, index, arr) {
    return item && arr.indexOf(item) === index
  }).slice(0, 4)
}

function normalizeListingScaleForServer(formOrScale, listingType) {
  var scale = typeof formOrScale === "string" ? formOrScale : (formOrScale && formOrScale.scale)
  if (!scale || isPlaceholderValue(scale)) {
    return scale || ""
  }
  if (listingType && !isServerListingType(listingType)) {
    return String(scale).trim()
  }
  if (formOrScale && formOrScale.listingType && !isServerListingType(formOrScale.listingType)) {
    return String(scale).trim()
  }
  return fmt.normalizeServerScale(scale)
}

function buildDemandDisplayScale(form) {
  if (form.scale && !isPlaceholderValue(form.scale)) {
    return normalizeListingScaleForServer(form.scale, form.listingType || "算力整机")
  }
  if ((form.description || "").trim()) {
    return "详见描述"
  }
  return "待沟通"
}

function buildDemandDetails(form, listingType) {
  var rows = []
  var desc = (form.description || "").trim()
  if (isServerListingType(listingType)) {
    pushDetailRow(rows, "产品", form.serverProduct)
    pushDetailRow(rows, "规格", getServerConfigText(form))
    pushDetailRow(rows, "质保", form.warranty)
    pushDetailRow(rows, "数量", normalizeListingScaleForServer(form))
    pushDetailRow(rows, "预算", form.budget)
    pushDetailRow(rows, "交期", form.deliveryTime || form.cycle)
    pushDetailRow(rows, "地点", form.procurementRegion || form.region)
    pushDetailRow(rows, "支付", form.serverPayment)
    pushDetailRow(rows, "流程", form.serverProcess)
    pushDetailRow(rows, "品牌偏好", form.serverBrand, "不限")
    pushDetailRow(rows, "备注", desc)
    pushDetailRow(rows, "企业角色", form.role)
    return rows
  }
  if (isPartsListingType(listingType)) {
    return buildPartsDemandDetails(form)
  }
  if (desc) {
    rows.push({ label: "需求说明", value: desc })
  }
  var profile = getDemandFormProfile(listingType)
  pushDetailRow(rows, "需求类型", listingType)
  pushDetailRow(rows, "企业所在地", form.region)
  pushDetailRow(rows, "需求规模", form.scale)
  pushDetailRow(rows, "期望开始", form.startTime, "尽快")
  pushDetailRow(rows, "预算范围", form.budget)
  if (profile.isRentalForm) {
    pushDetailRow(rows, "租赁标的", form.rentalSubject || form.specModel)
    pushDetailRow(rows, "型号/规格", form.specModel)
    pushDetailRow(rows, "租期/周期", form.cycle)
    pushDetailRow(rows, "交付方式", form.delivery)
    pushDetailRow(rows, "交付周期", form.deliveryTime)
    pushDetailRow(rows, "网络/配套", form.networkSpec)
    pushDetailRow(rows, "数据中心", form.idcName)
    pushDetailRow(rows, "机房等级", form.idcLevel)
    pushDetailRow(rows, "单柜功率", form.cabinetPower)
    pushDetailRow(rows, "带宽资源", form.bandwidth)
  } else if (profile.isMaintForm) {
    pushDetailRow(rows, "维保对象", form.maintenanceTarget || form.scale)
    pushDetailRow(rows, "服务级别", form.warranty)
    pushDetailRow(rows, "服务范围", form.serviceScope)
    pushDetailRow(rows, "合作周期", form.cycle || form.deliveryTime)
  } else if (profile.isRoomBuildForm) {
    pushDetailRow(rows, "建设规模", form.projectScale || form.scale)
    pushDetailRow(rows, "服务范围", form.serviceScope)
    pushDetailRow(rows, "项目周期", form.deliveryTime || form.startTime, "尽快")
  } else if (profile.isDcOpForm) {
    pushDetailRow(rows, "数据中心", form.dcName)
    pushDetailRow(rows, "服务范围", form.serviceScope)
    pushDetailRow(rows, "合作周期", form.cycle)
  } else if (profile.isFinanceForm) {
    pushDetailRow(rows, "资金用途", form.financePurpose || form.serviceScope)
    pushDetailRow(rows, "资金规模", form.financeScale || form.scale || form.budget)
    pushDetailRow(rows, "合作方式", form.financeMode || form.cycle)
    pushDetailRow(rows, "合作周期", form.deliveryTime || form.cycle)
  }
  pushDetailRow(rows, "企业角色", form.role)
  return rows
}

function buildResourceListing(form, submissionId) {
  var now = fmt.formatDate(new Date())
  var listingType = C.normalizeResourceType(form.listingType)
  var isServer = isServerListingType(listingType)
  var isParts = isPartsListingType(listingType)
  var listingRegion = getResourceListingRegion(form)
  var deliveryKind = (isServer || isParts) ? getServerDeliveryKind(form.deliveryTime || form.cycle) : ""
  var listing = {
    id: idFactory.generateResourceListingId(),
    pool: "resource",
    type: listingType,
    region: listingRegion,
    title: (form.title || "").trim() || (isServer ? buildServerResourceTitle(form) : (isParts ? buildPartsResourceTitle(form) : form.title)),
    city: listingRegion,
    scale: isServer ? normalizeListingScaleForServer(form) : form.scale,
    cycle: (isServer || isParts) ? (form.deliveryTime || form.cycle || "") : form.cycle,
    price: form.price || "面议",
    verification: "待审核",
    matchScore: 0,
    publishedAt: now,
    isUserPublished: true,
    submissionId: submissionId,
    configSpec: form.configSpec || "",
    serverProduct: form.serverProduct || "",
    specModel: form.specModel || "",
    serverPayment: form.serverPayment || "",
    serverProcess: form.serverProcess || "",
    warranty: form.warranty || "",
    deliveryKind: deliveryKind,
    highlights: isServer
      ? buildServerResourceHighlights(form)
      : (isParts
        ? buildPartsResourceHighlights(form)
        : [form.specModel, form.scale, form.cycle || form.deliveryTime, "待平台核验"].filter(Boolean)),
    tags: buildTags(listingType, listingRegion, isServer ? (deliveryKind || "整机交付") : (isParts ? "配件供应" : form.delivery)),
    maskedCompany: fmt.maskCompany(form.company),
    publisherCertLevel: getUserCertLevel(),
    publisherCertBadge: getPublisherCertBadge(getUserCertLevel()),
    summary: form.description || (form.title + "，" + form.scale + (listingRegion ? "，" + listingRegion : "") + "可对接。"),
    scene: "",
    details: buildResourceDetails(form),
    hidden: ["企业全称", "联系人", "手机号", "精确报价", "库存明细"],
    publicDisplay: form.publicDisplay !== false
  }
  listing.matchScore = matching.computeListingQualityScore(listing, { certLevel: getUserCertLevel() })
  return listing
}

function buildDemandListing(form, submitType, submissionId) {
  var listingType = C.normalizeDemandType(form.listingType || (submitType === "room" ? "机房建设" : submitType === "server" ? "算力整机" : "算力租赁"))
  var now = fmt.formatDate(new Date())
  var isServer = isServerListingType(listingType)
  var isParts = isPartsListingType(listingType)
  var listingRegion = (isServer || isParts) ? (form.procurementRegion || form.region) : form.region
  var budget = form.budget && !matching.isPlaceholderValue(form.budget) ? form.budget : ((form.description || "").trim() ? "详见描述" : "待沟通")
  var cycle = form.deliveryTime && !matching.isPlaceholderValue(form.deliveryTime)
    ? form.deliveryTime
    : (form.cycle && !matching.isPlaceholderValue(form.cycle) ? form.cycle : ((form.description || "").trim() ? "详见描述" : "待沟通"))
  var displayScale = buildDemandDisplayScale(form)
  var listing = {
    id: idFactory.generateDemandListingId(),
    pool: "demand",
    type: listingType,
    region: listingRegion,
    title: (form.title || "").trim() || (isServer ? buildServerResourceTitle(form) : (isParts ? buildPartsResourceTitle(form) : buildGeneralDemandPoolTitle({
      type: listingType,
      scale: displayScale,
      budget: budget,
      summary: form.description || ""
    }))),
    city: listingRegion,
    scale: displayScale,
    budget: budget,
    cycle: cycle,
    verification: "待审核",
    matchScore: 0,
    publishedAt: now,
    isUserPublished: true,
    submissionId: submissionId,
    configSpec: form.configSpec || "",
    serverProduct: form.serverProduct || "",
    specModel: form.specModel || "",
    serverBrand: form.serverBrand || "",
    serverPayment: form.serverPayment || "",
    serverProcess: form.serverProcess || "",
    warranty: form.warranty || "",
    deliveryKind: (isServer || isParts) ? getServerDeliveryKind(form.deliveryTime || form.cycle || form.title) : "",
    highlights: buildDemandHighlights(form, listingType),
    tags: buildTags(listingType, listingRegion, isServer
      ? (getServerDeliveryKind(form.deliveryTime || form.cycle || form.title)
        || (form.startTime && !matching.isPlaceholderValue(form.startTime) ? "近期启动" : ""))
      : (isParts ? "配件采购" : (form.startTime && !matching.isPlaceholderValue(form.startTime) ? "近期启动" : "用户发布"))),
    maskedCompany: fmt.maskCompany(form.company),
    publisherCertLevel: getUserCertLevel(),
    publisherCertBadge: getPublisherCertBadge(getUserCertLevel()),
    summary: buildDemandSummary(form, listingType),
    scene: form.scene && !matching.isPlaceholderValue(form.scene) ? form.scene : "",
    details: buildDemandDetails(form, listingType),
    hidden: ["企业全称", "联系人", "手机号", "详细预算", "招标文件"],
    publicDisplay: form.publicDisplay !== false
  }
  listing.matchScore = matching.computeListingQualityScore(listing, { certLevel: getUserCertLevel() })
  return listing
}

function publishListing(submitType, form, submissionId) {
  var listing
  var key
  if (submitType === "resource") {
    listing = buildResourceListing(form, submissionId)
    key = publishedResourcesKey
  } else {
    listing = buildDemandListing(form, submitType, submissionId)
    key = publishedDemandsKey
  }
  var list = wx.getStorageSync(key) || []
  list.unshift(listing)
  wx.setStorageSync(key, list)
  return listing
}

function updateSubmissionPublished(submissionId, listingId) {
  var list = getSubmissions()
  var index = -1
  for (var i = 0; i < list.length; i += 1) {
    if (list[i].id === submissionId) {
      index = i
      break
    }
  }
  if (index === -1) {
    return null
  }
  list[index].listingId = listingId
  list[index].statusTimeline = list[index].statusTimeline || []
  list[index].statusTimeline.push({
    status: "待审核",
    time: formatDate(new Date()),
    hint: "公示信息已录入，等待平台初审；通过后继续公开展示。"
  })
  wx.setStorageSync(submissionKey, list)
  return list[index]
}

function getResourceTypeOptions() {
  return resourceTypeOptions
}

function getDemandTypeOptions() {
  return demandTypeOptions
}

function getResourceTypeFilterChips() {
  return resourceTypeOptions.map(function(type) {
    return { value: type, label: resourceTypeFilterLabels[type] || type }
  })
}

function getDemandTypeFilterChips() {
  return demandTypeOptions.map(function(type) {
    return { value: type, label: demandTypeFilterLabels[type] || type }
  })
}

function getResourceTypeHint(type) {
  var normalized = C.normalizeResourceType(type)
  return C.resourceTypeHints[normalized] || ""
}

function getDemandTypeHint(type) {
  var normalized = C.normalizeDemandType(type)
  return C.demandTypeHints[normalized] || ""
}

function isPublishType(type) {
  return type === "resource" || type === "demand" || type === "room" || type === "server"
}

function getListingPool(id) {
  return listingSanitize.getListingPoolFromId(id)
}

function collectMisplacedDemandListings() {
  return (getPublishedResources() || []).filter(function(item) {
    return item && item.id && getListingPool(item.id) === "demand"
  })
}

function updatePublishedListing(id, updates) {
  var pool = getListingPool(id)
  if (!pool) {
    return null
  }
  var key = pool === "resource" ? publishedResourcesKey : publishedDemandsKey
  var list = wx.getStorageSync(key) || []
  var index = -1
  for (var i = 0; i < list.length; i += 1) {
    if (list[i].id === id) {
      index = i
      break
    }
  }
  if (index === -1) {
    return null
  }
  list[index] = Object.assign({}, list[index], updates)
  wx.setStorageSync(key, list)
  return list[index]
}

function removePublishedListing(id) {
  var pool = getListingPool(id)
  if (!pool) {
    return false
  }
  var key = pool === "resource" ? publishedResourcesKey : publishedDemandsKey
  var list = wx.getStorageSync(key) || []
  var next = list.filter(function(item) {
    return item.id !== id
  })
  wx.setStorageSync(key, next)
  return next.length !== list.length
}

function buildSubmissionTimelinePatch(submissionId, status, hint, extra) {
  var submission = getSubmission(submissionId)
  if (!submission) {
    return null
  }
  var statusTimeline = (submission.statusTimeline || []).slice()
  statusTimeline.push({
    status: status,
    time: formatDate(new Date()),
    hint: hint
  })
  return Object.assign({
    status: status,
    statusTimeline: statusTimeline
  }, extra || {})
}

function appendSubmissionTimeline(submissionId, status, hint, extra) {
  var patch = buildSubmissionTimelinePatch(submissionId, status, hint, extra)
  if (!patch) {
    return isCloudEnabled() ? Promise.reject(new Error("记录不存在")) : null
  }
  if (isCloudEnabled()) {
    return cloudStore.patchSubmissionRemote(submissionId, patch).then(function() {
      return getSubmission(submissionId)
    })
  }
  var list = getAllSubmissionsRaw()
  var index = -1
  for (var i = 0; i < list.length; i += 1) {
    if (list[i].id === submissionId) {
      index = i
      break
    }
  }
  if (index === -1) {
    return null
  }
  list[index] = Object.assign({}, list[index], patch)
  wx.setStorageSync(submissionKey, list)
  return list[index]
}

function getListingOwnerPhone(listingId) {
  var listing = getItem(listingId)
  if (!listing) {
    return ""
  }
  if (listing.actualOwnerPhone || listing.ownerPhone) {
    return listing.actualOwnerPhone || listing.ownerPhone
  }
  if (!listing.submissionId) {
    return ""
  }
  var submission = getSubmission(listing.submissionId)
  if (!submission) {
    return ""
  }
  return submission.actualOwnerPhone || submission.ownerPhone || submission.phone || ""
}

function connectSubmissionVisibleToProxyStaff(submission, phone) {
  if (!submission || submission.type !== "connect" || !phone) {
    return false
  }
  var profile = getUserProfile()
  if (submission.proxyStaffPhone === phone) {
    return true
  }
  if (submission.proxyStaffPhones && submission.proxyStaffPhones.indexOf(phone) > -1) {
    return true
  }
  if (submission.recipientProxyStaffPhone === phone) {
    return true
  }
  if (profile && profile.openid && submission.recipientProxyStaffOpenid === profile.openid) {
    return true
  }
  if (submission.applicantProxyStaffPhone === phone) {
    return true
  }
  if (profile && profile.openid && submission.applicantProxyStaffOpenid === profile.openid) {
    return true
  }
  var target = submission.targetId ? getItem(submission.targetId) : null
  var source = submission.sourceListingId ? getItem(submission.sourceListingId) : null
  if (target && target.proxyStaffPhone === phone && isStaffProxyListing(target)) {
    return true
  }
  if (source && source.proxyStaffPhone === phone && isStaffProxyListing(source)) {
    return true
  }
  if (profile && profile.openid) {
    if (target && target.proxyStaffOpenid === profile.openid && isStaffProxyListing(target)) {
      return true
    }
    if (source && source.proxyStaffOpenid === profile.openid && isStaffProxyListing(source)) {
      return true
    }
  }
  return false
}

function getConnectRecipientPhone(submission) {
  if (!submission || submission.type !== "connect") {
    return ""
  }
  var target = submission.targetId ? getItem(submission.targetId) : null
  if (target) {
    return target.actualOwnerPhone || target.ownerPhone || target.phone
      || submission.targetOwnerPhone || getListingOwnerPhone(submission.targetId) || ""
  }
  return submission.targetOwnerPhone || getListingOwnerPhone(submission.targetId) || ""
}

function getConnectRole(submission, phone) {
  if (!submission || submission.type !== "connect") {
    return null
  }
  if (!phone) {
    return null
  }
  if (isStaffWorkMode()) {
    if (connectSubmissionVisibleToProxyStaff(submission, phone)) {
      return "proxyStaff"
    }
    return null
  }
  if (isStaffUser() && connectSubmissionVisibleToProxyStaff(submission, phone)) {
    return "proxyStaff"
  }
  var profile = getUserProfile()
  if (profile && profile.openid && submission.ownerOpenid === profile.openid) {
    return "applicant"
  }
  if (submission.phone === phone || submission.ownerPhone === phone) {
    return "applicant"
  }
  if (getConnectRecipientPhone(submission) === phone) {
    return "recipient"
  }
  return null
}

function getConnectApplicantSideMode(submission) {
  if (!submission || submission.type !== "connect") {
    return "user"
  }
  if (submission.matchedByStaff) {
    return "proxy"
  }
  var source = submission.sourceListingId ? getItem(submission.sourceListingId) : null
  if (source && isStaffProxyListing(source)) {
    return "proxy"
  }
  return "user"
}

function getConnectRecipientSideMode(submission) {
  if (!submission || submission.type !== "connect") {
    return "user"
  }
  var target = submission.targetId ? getItem(submission.targetId) : null
  if (target && isStaffProxyListing(target)) {
    return "proxy"
  }
  return "user"
}

function isProxyToProxyConnect(submission) {
  return getConnectApplicantSideMode(submission) === "proxy"
    && getConnectRecipientSideMode(submission) === "proxy"
}

function applyProxyToProxyAutoComplete(record) {
  if (!record || record.type !== "connect" || !isProxyToProxyConnect(record)) {
    return record
  }
  if (record.matchedByStaff || record.ownerInitiatedMatch) {
    return record
  }
  if (record.proxyAutoCompleted || record.status === "已交换名片") {
    if (record.status === "已交换名片" && !record.disclosedContacts) {
      record.disclosedContacts = buildConnectDisclosedContacts(record)
    }
    return record
  }
  record.proxyAutoCompleted = true
  record.status = "已交换名片"
  record.matchedAt = formatDate(new Date())
  record.disclosedContacts = buildConnectDisclosedContacts(record)
  record.statusTimeline = [{
    status: "已交换名片",
    time: formatDate(new Date()),
    hint: "双方均为平台代发，对接已自动完结，无需另行确认。"
  }]
  return record
}

/** 运营代发资源↔代发需求勾选匹配：双方均为代发，直接自动完结，无需交换确认 */
function applyStaffProxyToProxyExchangeReady(record) {
  if (!record || record.type !== "connect" || !record.matchedByStaff || !isProxyToProxyConnect(record)) {
    return record
  }
  if (record.status === "已交换名片" || record.proxyAutoCompleted) {
    if (record.status === "已交换名片" && !record.disclosedContacts) {
      record.disclosedContacts = buildConnectDisclosedContacts(record)
    }
    return record
  }
  var now = formatDate(new Date())
  record.proxyAutoCompleted = true
  record.status = "已交换名片"
  record.matchedAt = now
  record.disclosedContacts = buildConnectDisclosedContacts(record)
  record.statusTimeline = [{
    status: "已交换名片",
    time: now,
    hint: "平台运营代发匹配（代发资源对接代发需求），双方均为代发，已自动完结，无需交换确认。"
  }]
  return record
}

var staffProxyToProxyRepairStatuses = {
  "待交换确认": true,
  "对方已确认": true,
  "待对方确认": true
}

function shouldRepairStaffProxyToProxyConnect(submission) {
  if (!submission || submission.type !== "connect" || !submission.matchedByStaff) {
    return false
  }
  if (!isProxyToProxyConnect(submission)) {
    return false
  }
  if (submission.proxyAutoCompleted || submission.status === "已交换名片") {
    return false
  }
  return !!staffProxyToProxyRepairStatuses[submission.status]
}

function isConnectInExchangePhase(submission) {
  if (!submission || submission.type !== "connect") {
    return false
  }
  if (submission.status === "待平台审核") {
    return false
  }
  return submission.status === "待交换确认"
    || submission.status === "对方已确认"
    || isConnectRecipientResponded(submission)
}

function repairConnectRecipientRespondedStatus(submission) {
  if (!submission || submission.type !== "connect") {
    return { submission: submission, changed: false }
  }
  var normalized = connectStage.normalizeConnectSubmissionFields(submission)
  if (normalized.status === submission.status) {
    return { submission: submission, changed: false }
  }
  return { submission: normalized, changed: true }
}

function repairStaffProxyToProxyConnectSubmission(submission) {
  if (shouldRepairStaffProxyToProxyConnect(submission)) {
    var beforeStatus = submission.status
    var repaired = applyStaffProxyToProxyExchangeReady(Object.assign({}, submission))
    return {
      submission: repaired,
      changed: repaired.status !== beforeStatus
        || !!repaired.proxyAutoCompleted !== !!submission.proxyAutoCompleted
        || (!submission.disclosedContacts && !!repaired.disclosedContacts)
    }
  }
  if (submission
    && submission.type === "connect"
    && isProxyToProxyConnect(submission)
    && submission.status === "已交换名片"
    && !submission.disclosedContacts) {
    var backfilled = Object.assign({}, submission)
    backfilled.disclosedContacts = buildConnectDisclosedContacts(backfilled)
    return {
      submission: backfilled,
      changed: !!backfilled.disclosedContacts
    }
  }
  return { submission: submission, changed: false }
}

function repairConnectSubmissionRecord(submission) {
  var closedRepair = repairConnectDueToClosedListingSubmission(submission)
  if (closedRepair.changed) {
    return closedRepair
  }
  var respondedRepair = repairConnectRecipientRespondedStatus(submission)
  if (respondedRepair.changed) {
    return respondedRepair
  }
  return repairStaffProxyToProxyConnectSubmission(submission)
}

function repairStaffProxyToProxyConnects() {
  var list = getAllSubmissionsRaw()
  var repaired = 0
  var changed = false
  list.forEach(function(item, index) {
    var result = repairConnectSubmissionRecord(item)
    if (result.changed) {
      list[index] = result.submission
      repaired += 1
      changed = true
      syncStaffGlobalConnectCacheForConnect(result.submission)
    }
  })
  if (changed) {
    wx.setStorageSync(submissionKey, list)
  }
  var staffCache = getStaffGlobalConnectCache()
  if (staffCache && staffCache.connects && staffCache.connects.length) {
    var staffChanged = false
    var nextConnects = staffCache.connects.map(function(item) {
      var result = repairConnectSubmissionRecord(item)
      if (result.changed) {
        staffChanged = true
        return result.submission
      }
      return item
    })
    if (staffChanged) {
      var nextItems = (staffCache.items || []).map(function(item) {
        for (var i = 0; i < nextConnects.length; i += 1) {
          if (nextConnects[i].id === item.id) {
            var displayStatus = getSubmissionDisplayStatus(nextConnects[i])
            return Object.assign({}, item, {
              displayStatus: displayStatus,
              rawStatus: nextConnects[i].status || "",
              statusBadgeClass: getRecordStatusBadgeClass(displayStatus)
            })
          }
        }
        return item
      })
      wx.setStorageSync(staffGlobalConnectsKey, Object.assign({}, staffCache, {
        connects: nextConnects,
        items: nextItems
      }))
    }
  }
  return Promise.resolve({ repaired: repaired })
}

function isConnectRecipientViewer(submission, phone) {
  if (!submission || !phone) {
    return false
  }
  if (getConnectRecipientPhone(submission) === phone) {
    return true
  }
  if (getConnectRecipientSideMode(submission) !== "proxy" || !isStaffUser()) {
    return false
  }
  var profile = getUserProfile()
  if (submission.recipientProxyStaffPhone === phone) {
    return true
  }
  if (profile && profile.openid && submission.recipientProxyStaffOpenid === profile.openid) {
    return true
  }
  var target = submission.targetId ? getItem(submission.targetId) : null
  if (target && isStaffProxyListing(target)) {
    if (target.proxyStaffPhone === phone) {
      return true
    }
    if (profile && profile.openid && target.proxyStaffOpenid === profile.openid) {
      return true
    }
  }
  return false
}

function canActAsConnectRecipient(submission, phone) {
  return isConnectRecipientViewer(submission, phone)
}

function getConnectActionSideForViewer(submission, phone) {
  if (getConnectRole(submission, phone) === "applicant") {
    return "applicant"
  }
  if (canActAsConnectRecipient(submission, phone)) {
    return "recipient"
  }
  if (submission && submission.matchedByStaff && isStaffUser()) {
    var profile = getUserProfile()
    if (submission.proxyStaffPhone === phone
      || submission.applicantProxyStaffPhone === phone
      || (profile && profile.openid && submission.applicantProxyStaffOpenid === profile.openid)) {
      return "applicant"
    }
    if (submission.recipientProxyStaffPhone === phone
      || (profile && profile.openid && submission.recipientProxyStaffOpenid === profile.openid)) {
      return "recipient"
    }
  }
  return null
}

function isActiveConnectSubmission(submission) {
  if (!submission || submission.type !== "connect") {
    return false
  }
  return ["已关闭", "已流失"].indexOf(submission.status) === -1
}

function isConnectSubmissionUnfinished(submission) {
  return connectStage.isConnectSubmissionUnfinished(submission)
}

function buildConnectClosedByListingHint(closedListingId) {
  var listing = getItem(closedListingId)
  var label = listing && isResource(listing.id) ? "资源" : "需求"
  var title = listing && listing.title ? listing.title : "关联商机"
  return "关联" + label + "「" + title + "」已关闭，对接自动结束，无需再跟进。"
}

function findClosedListingIdForConnect(connect) {
  if (!connect || connect.type !== "connect") {
    return ""
  }
  var listingIds = [connect.targetId, connect.sourceListingId]
  for (var i = 0; i < listingIds.length; i += 1) {
    var listingId = listingIds[i]
    if (!listingId) {
      continue
    }
    var listing = getItem(listingId)
    if (listing && isListingClosed(listing)) {
      return listingId
    }
    if (listing && listing.submissionId) {
      var publishSub = getSubmissionWithoutRebuild(listing.submissionId)
      if (publishSub && publishSub.status === "已关闭") {
        return listingId
      }
    }
  }
  return ""
}

function buildConnectClosedByListingPatch(connect, closedListingId) {
  var next = Object.assign({}, connect, {
    status: "已关闭",
    closedDueToListing: closedListingId,
    closedAt: formatDate(new Date())
  })
  next.statusTimeline = (connect.statusTimeline || []).slice()
  next.statusTimeline.push({
    status: "已关闭",
    time: formatDate(new Date()),
    hint: buildConnectClosedByListingHint(closedListingId)
  })
  return next
}

function repairConnectDueToClosedListingSubmission(submission) {
  if (!submission || submission.type !== "connect" || !isConnectSubmissionUnfinished(submission)) {
    return { submission: submission, changed: false }
  }
  var closedListingId = findClosedListingIdForConnect(submission)
  if (!closedListingId) {
    return { submission: submission, changed: false }
  }
  return {
    submission: buildConnectClosedByListingPatch(submission, closedListingId),
    changed: true
  }
}

function syncStaffGlobalConnectCacheForConnect(connectSubmission) {
  if (!connectSubmission || !connectSubmission.id) {
    return
  }
  var staffCache = getStaffGlobalConnectCache()
  if (!staffCache || !staffCache.connects || !staffCache.connects.length) {
    return
  }
  var changed = false
  var nextConnects = staffCache.connects.map(function(item) {
    if (item.id === connectSubmission.id) {
      changed = true
      return connectSubmission
    }
    return item
  })
  if (!changed) {
    return
  }
  var displayStatus = getSubmissionDisplayStatus(connectSubmission)
  var nextItems = (staffCache.items || []).map(function(item) {
    if (item.id !== connectSubmission.id) {
      return item
    }
    return Object.assign({}, item, {
      displayStatus: displayStatus,
      rawStatus: connectSubmission.status || "",
      statusBadgeClass: getRecordStatusBadgeClass(displayStatus)
    })
  })
  wx.setStorageSync(staffGlobalConnectsKey, Object.assign({}, staffCache, {
    connects: nextConnects,
    items: nextItems
  }))
}

function closeConnectDueToListingClosed(connectId, closedListingId) {
  var submission = getSubmission(connectId)
  if (!submission || !isConnectSubmissionUnfinished(submission)) {
    return Promise.resolve(submission)
  }
  return Promise.resolve(appendSubmissionTimeline(
    connectId,
    "已关闭",
    buildConnectClosedByListingHint(closedListingId),
    {
      closedDueToListing: closedListingId,
      closedAt: formatDate(new Date())
    }
  )).then(function(updated) {
    if (updated) {
      syncStaffGlobalConnectCacheForConnect(updated)
    }
    return updated
  })
}

function collectConnectsForListing(listingId) {
  if (!listingId) {
    return []
  }
  return collectAllConnectCandidates().filter(function(item) {
    return item.type === "connect"
      && (item.targetId === listingId || item.sourceListingId === listingId)
  })
}

function closeUnfinishedConnectsForListing(listingId) {
  var connects = collectConnectsForListing(listingId).filter(isConnectSubmissionUnfinished)
  if (!connects.length) {
    return Promise.resolve({ closed: 0 })
  }
  var chain = Promise.resolve({ closed: 0 })
  connects.forEach(function(connect) {
    chain = chain.then(function(result) {
      return closeConnectDueToListingClosed(connect.id, listingId).then(function() {
        return { closed: result.closed + 1 }
      }).catch(function() {
        return result
      })
    })
  })
  return chain
}

function repairUnfinishedConnectsForClosedListings() {
  var pending = {}
  collectAllConnectCandidates().forEach(function(connect) {
    if (!isConnectSubmissionUnfinished(connect)) {
      return
    }
    ;[connect.targetId, connect.sourceListingId].forEach(function(listingId) {
      if (!listingId || pending[connect.id]) {
        return
      }
      var listing = getItem(listingId)
      if (listing && isListingClosed(listing)) {
        pending[connect.id] = listingId
      }
    })
  })
  var ids = Object.keys(pending)
  if (!ids.length) {
    return Promise.resolve({ closed: 0 })
  }
  var chain = Promise.resolve({ closed: 0 })
  ids.forEach(function(connectId) {
    chain = chain.then(function(result) {
      return closeConnectDueToListingClosed(connectId, pending[connectId]).then(function() {
        return { closed: result.closed + 1 }
      }).catch(function() {
        return result
      })
    })
  })
  return chain
}

function getUserConnectSubmissionForTarget(targetListingId, options) {
  options = options || {}
  var profile = getUserProfile()
  if (!profile || !profile.phone || !targetListingId) {
    return null
  }
  var phone = profile.phone
  var direction = options.connectDirection || "demand_to_resource"
  var matches = getSubmissions().filter(function(item) {
    if (item.type !== "connect" || item.targetId !== targetListingId) {
      return false
    }
    if (direction === "resource_to_demand") {
      if (item.connectDirection !== "resource_to_demand") {
        return false
      }
    } else if (item.connectDirection === "resource_to_demand") {
      return false
    }
    return getConnectRole(item, phone) === "applicant"
  })
  for (var i = 0; i < matches.length; i += 1) {
    if (isActiveConnectSubmission(matches[i])) {
      return matches[i]
    }
  }
  return null
}

function findBlockingConnectForApply(payload) {
  if (!payload || payload.type !== "connect" || !payload.targetId) {
    return null
  }
  var existing = findViewerConnectForListing(payload.targetId)
  if (existing) {
    return existing
  }
  var direction = payload.connectDirection || "demand_to_resource"
  var resourceId = direction === "resource_to_demand" ? payload.sourceListingId : payload.targetId
  var demandId = direction === "resource_to_demand" ? payload.targetId : payload.sourceListingId
  if (resourceId && demandId && isResource(resourceId) && !isResource(demandId)) {
    return findActiveConnectForListingPair(resourceId, demandId)
  }
  return null
}

function getBlockingConnectApplyMessage(payload, existing) {
  if (!existing) {
    return "已有进行中的对接，请先在记录中查看进度"
  }
  if (payload && payload.connectDirection === "resource_to_demand") {
    return "你已提交过匹配申请"
  }
  return "你已申请过该资源"
}

function getSubmissionDisplayStatus(item) {
  if (!item) {
    return ""
  }
  if (item.type === "connect") {
    return connectStage.deriveConnectDisplayStatus(item)
  }
  if (item.type === "certify") {
    if (item.status === "待审核") {
      return "认证中"
    }
    if (item.status === "已推荐" || item.status === "已发布" || item.status === "已认证") {
      return "已认证"
    }
  }
  if (item.listingId && (item.type === "resource" || isDemandSubmitType(item.type))) {
    var listing = getItem(item.listingId)
    if (listing && isListingClosed(listing)) {
      return "已关闭"
    }
  }
  return item.status || "待审核"
}

function getListingPublishTip(record) {
  if (!record || !record.listingId) {
    return ""
  }
  var displayStatus = getSubmissionDisplayStatus(record)
  var poolLabel = record.type === "resource" ? "资源池" : "需求池"
  var listing = getItem(record.listingId)
  var isPrivate = record.publicDisplay === false || (listing && listing.publicDisplay === false)
  if (displayStatus === "已关闭") {
    return "该信息已从" + poolLabel + "下架，他人无法再查看或申请对接。"
  }
  if (displayStatus === "已发布") {
    if (isPrivate) {
      return "你的信息已通过平台审核，未开启公开展示，仅你可在提交记录中查看。"
    }
    return "你的信息已通过平台审核，正在公开展示池展示；企业名称和联系方式已脱敏。"
  }
  if (isPrivate) {
    return "你的信息已提交，平台审核通过后不会出现在" + poolLabel + "；未开启公开展示，仅你可在提交记录中查看。"
  }
  return "你的信息已提交，平台审核通过后才会在公开展示池展示；企业名称和联系方式已脱敏。"
}

function getListingPreviewButtonText(record) {
  if (!record) {
    return "预览提交内容"
  }
  if (getSubmissionDisplayStatus(record) === "已发布") {
    return "查看公示页面"
  }
  return "预览提交内容"
}

function shouldShowListingButton(record) {
  if (!record || !record.listingId) {
    return false
  }
  var displayStatus = getSubmissionDisplayStatus(record)
  return displayStatus !== "已关闭" && displayStatus !== "已流失"
}

function getRecordListViewListingButtonText(item) {
  if (!item || !item.listingId || !shouldShowListingButton(item)) {
    return ""
  }
  if (item.type === "resource") {
    return "查看资源"
  }
  if (isDemandSubmitType(item.type)) {
    return "查看需求"
  }
  return ""
}

function getRecordListCloseButtonText(item) {
  if (!item) {
    return "关闭"
  }
  if (item.type === "resource") {
    return "关闭资源"
  }
  if (isDemandSubmitType(item.type)) {
    return "关闭需求"
  }
  return "关闭"
}

function getSubmissionDisplayHint(item) {
  var displayStatus = getSubmissionDisplayStatus(item)
  return getStatusHint(displayStatus)
}

function getListingReviewQueue() {
  var queue = []

  function pushItems(list, pool) {
    list.forEach(function(listing) {
      if (listing.verification !== "待审核") {
        return
      }
      var submission = listing.submissionId ? getSubmission(listing.submissionId) : null
      queue.push({
        id: listing.id,
        reviewType: "listing",
        pool: pool,
        typeName: pool === "resource" ? "资源公示" : "需求公示",
        title: listing.title,
        listingType: listing.type,
        company: submission ? submission.company : listing.maskedCompany,
        contact: submission ? submission.contact : "",
        phone: submission ? submission.phone : "",
        region: listing.region,
        summary: listing.summary,
        createdAt: submission ? submission.createdAt : listing.publishedAt,
        submissionId: listing.submissionId || "",
        listing: listing,
        submission: submission
      })
    })
  }

  if (isCloudEnabled() && isAdminLoggedIn()) {
    var pendingListings = wx.getStorageSync(adminPendingListingsKey) || []
    var pendingResources = pendingListings.filter(function(item) {
      return item.pool === "resource" || isResource(item.id)
    })
    var pendingDemands = pendingListings.filter(function(item) {
      return item.pool === "demand" || (item.id && (item.id.indexOf("UDEM-") === 0 || item.id.indexOf("DEM-") === 0))
    })
    pushItems(pendingResources, "resource")
    pushItems(pendingDemands, "demand")
  } else {
    pushItems(getPublishedResources(), "resource")
    pushItems(getPublishedDemands(), "demand")
  }
  queue.sort(function(a, b) {
    return (b.createdAt || "").localeCompare(a.createdAt || "")
  })
  return queue
}

function getSubmissionReviewQueue() {
  var typeNames = {
    demand: "需求提交",
    resource: "资源发布",
    server: "算力整机需求",
    room: "机房项目",
    match: "人工撮合",
    connect: "对接申请",
    certify: "企业认证"
  }

  if (isCloudEnabled() && isAdminLoggedIn()) {
    var listingSubmissionIds = {}
    getListingReviewQueue().forEach(function(item) {
      if (item.submissionId) {
        listingSubmissionIds[item.submissionId] = true
      }
    })
    return (wx.getStorageSync(adminPendingSubmissionsKey) || []).filter(function(item) {
      if (listingSubmissionIds[item.id]) {
        return false
      }
      if (item.type === "certify" && !isCertReviewStillNeeded(item)) {
        return false
      }
      return true
    }).map(function(item) {
      return {
        id: item.id,
        reviewType: "submission",
        pool: "",
        typeName: typeNames[item.type] || "商机申请",
        title: item.title || item.targetTitle || typeNames[item.type] || "待审核申请",
        listingType: item.listingType || item.type,
        company: item.company,
        contact: item.contact,
        phone: item.phone,
        region: item.region,
        summary: item.description,
        createdAt: item.createdAt,
        submissionId: item.id,
        listing: null,
        submission: item
      }
    })
  }

  var listingSubmissionIds = {}
  getListingReviewQueue().forEach(function(item) {
    if (item.submissionId) {
      listingSubmissionIds[item.submissionId] = true
    }
  })
  var sourceList = isAdminLoggedIn() ? getAllSubmissionsRaw() : getSubmissions()
  return sourceList.filter(function(item) {
    if (item.type === "connect") {
      return item.status === "待平台审核" && item.needsPlatformConnectReview
    }
    if (item.status !== "待审核") {
      return false
    }
    if (listingSubmissionIds[item.id]) {
      return false
    }
    if (item.type === "certify" && !isCertReviewStillNeeded(item)) {
      return false
    }
    return true
  }).map(function(item) {
    return {
      id: item.id,
      reviewType: "submission",
      pool: "",
      typeName: typeNames[item.type] || "商机申请",
      title: item.title || item.targetTitle || item.typeName || "待审核申请",
      listingType: item.listingType || item.type,
      company: item.company,
      contact: item.contact,
      phone: item.phone,
      region: item.region,
      summary: item.description,
      createdAt: item.createdAt,
      submissionId: item.id,
      listing: null,
      submission: item
    }
  })
}

function isProxyConnectReviewSubmission(submission) {
  return !!(submission
    && submission.type === "connect"
    && submission.status === "待平台审核"
    && submission.needsPlatformConnectReview)
}

function getProxyConnectReviewSummary(submission) {
  if (!isProxyConnectReviewSubmission(submission)) {
    return null
  }
  var target = submission.targetId ? getItem(submission.targetId) : null
  var source = submission.sourceListingId ? getItem(submission.sourceListingId) : null
  var proxyListing = isStaffProxyListing(source) ? source : (isStaffProxyListing(target) ? target : null)
  var proxySide = proxyListing ? getStaffProxyListingSideLabel(proxyListing) : "代发商机"
  var clientPhone = submission.actualOwnerPhone || submission.phone || ""
  return {
    proxySide: proxySide,
    proxyListingTitle: proxyListing ? proxyListing.title : (submission.sourceTitle || submission.targetTitle || ""),
    proxyClientPhone: clientPhone ? maskPhone(clientPhone) : "",
    proxyStaffPhone: submission.proxyStaffPhone ? maskPhone(submission.proxyStaffPhone) : "",
    applyType: submission.matchedByStaff ? "运营代客户勾选发起" : "第三方申请对接"
  }
}

function getProxyConnectReviewQueue() {
  return getSubmissionReviewQueue().filter(function(item) {
    return item.submission && isProxyConnectReviewSubmission(item.submission)
  }).map(function(item) {
    var summary = getProxyConnectReviewSummary(item.submission) || {}
    return Object.assign({}, item, {
      typeName: "代发对接",
      tagClass: "warning",
      statusLabel: "待平台审批",
      proxySide: summary.proxySide || "",
      proxyClientPhone: summary.proxyClientPhone || "",
      proxyListingTitle: summary.proxyListingTitle || ""
    })
  })
}

function getAdminReviewQueue(tab) {
  if (tab === "submission") {
    return getSubmissionReviewQueue()
  }
  if (tab === "certify") {
    return getSubmissionReviewQueue().filter(function(item) {
      return item.submission && item.submission.type === "certify"
    })
  }
  if (tab === "proxyConnect") {
    return getProxyConnectReviewQueue()
  }
  if (tab === "business") {
    return getSubmissionReviewQueue().filter(function(item) {
      if (item.submission && item.submission.type === "certify") {
        return false
      }
      if (item.submission && isProxyConnectReviewSubmission(item.submission)) {
        return false
      }
      return true
    })
  }
  if (tab === "all") {
    return getListingReviewQueue().concat(getSubmissionReviewQueue()).sort(function(a, b) {
      return (b.createdAt || "").localeCompare(a.createdAt || "")
    })
  }
  return getListingReviewQueue()
}

function getAdminStats() {
  return {
    pendingListings: getListingReviewQueue().length,
    pendingSubmissions: getSubmissionReviewQueue().length
  }
}

function getAdminHubStats() {
  var submissions = getSubmissionReviewQueue()
  var pendingCertify = 0
  var pendingBusiness = 0
  var pendingProxyConnect = 0
  submissions.forEach(function(item) {
    if (item.submission && isProxyConnectReviewSubmission(item.submission)) {
      pendingProxyConnect += 1
    } else if (item.submission && item.submission.type === "certify") {
      pendingCertify += 1
    } else {
      pendingBusiness += 1
    }
  })
  var pendingListings = getListingReviewQueue().length
  var pendingTotal = getAdminReviewQueue("all").length
  return {
    pendingListings: pendingListings,
    pendingCertify: pendingCertify,
    pendingBusiness: pendingBusiness,
    pendingProxyConnect: pendingProxyConnect,
    pendingSubmissions: submissions.length,
    pendingTotal: pendingTotal
  }
}

function getSubmissionTypeLabel(type) {
  var typeNames = {
    demand: "需求提交",
    resource: "资源发布",
    server: "算力整机需求",
    room: "机房项目",
    match: "人工撮合",
    connect: "对接申请",
    certify: "企业认证"
  }
  return typeNames[type] || type || ""
}

function isCardCertReviewSubmission(submission) {
  return !!(submission && submission.type === "certify" && submission.certLevel !== "license")
}

function pushAdminReviewField(fields, label, value) {
  if (value !== undefined && value !== null && value !== "") {
    fields.push({ label: label, value: value })
  }
}

function buildConnectPartyListingMeta(listingId) {
  if (!listingId) {
    return {
      listingId: "",
      poolTypeLabel: "",
      canOpenListing: false
    }
  }
  return {
    listingId: listingId,
    poolTypeLabel: isResource(listingId) ? "资源" : "需求",
    canOpenListing: true
  }
}

function buildConnectReviewParties(submission) {
  var target = submission.targetId ? getItem(submission.targetId) : null
  var source = submission.sourceListingId ? getItem(submission.sourceListingId) : null
  if (!source && submission.sourceListingId) {
    source = getStaffGlobalListing(submission.sourceListingId)
  }
  if (!target && submission.targetId) {
    target = getStaffGlobalListing(submission.targetId)
  }
  var applicantSubmission = source && source.submissionId ? getSubmission(source.submissionId) : null
  var targetSubmission = target && target.submissionId ? getSubmission(target.submissionId) : null
  var sourceProfile = getListingPartyProfile(source)
  var targetProfile = getListingPartyProfile(target)
  var applicantListingId = source ? source.id : (submission.sourceListingId || "")
  var recipientListingId = target ? target.id : (submission.targetId || "")
  if (isResourceToDemandConnect(submission)) {
    return [
      Object.assign({
        side: "申请方",
        partyRole: "applicant",
        roleLabel: "资源方",
        title: source ? source.title : (submission.sourceTitle || "未关联已发布资源"),
        type: source ? source.type : "",
        region: source ? source.region : submission.region,
        company: submission.company || sourceProfile.company || (applicantSubmission ? applicantSubmission.company : ""),
        contact: submission.contact || sourceProfile.contact || (applicantSubmission ? applicantSubmission.contact : ""),
        phone: submission.phone || sourceProfile.phone || (applicantSubmission ? applicantSubmission.phone : ""),
        summary: source ? source.summary : (submission.description || "")
      }, buildConnectPartyListingMeta(applicantListingId)),
      Object.assign({
        side: "对接方",
        partyRole: "recipient",
        roleLabel: "需求方",
        title: target ? target.title : submission.targetTitle,
        type: target ? target.type : "",
        region: target ? target.region : "",
        company: targetProfile.company || (targetSubmission ? targetSubmission.company : ""),
        contact: targetProfile.contact || (targetSubmission ? targetSubmission.contact : ""),
        phone: targetProfile.phone || (targetSubmission ? targetSubmission.phone : ""),
        summary: target ? target.summary : ""
      }, buildConnectPartyListingMeta(recipientListingId))
    ]
  }
  return [
    Object.assign({
      side: "申请方",
      partyRole: "applicant",
      roleLabel: "需求方",
      title: source ? source.title : (submission.sourceTitle || "未关联已发布需求"),
      type: source ? source.type : "",
      region: source ? source.region : submission.region,
      company: submission.company || sourceProfile.company || (applicantSubmission ? applicantSubmission.company : ""),
      contact: submission.contact || sourceProfile.contact || (applicantSubmission ? applicantSubmission.contact : ""),
      phone: submission.phone || sourceProfile.phone || (applicantSubmission ? applicantSubmission.phone : ""),
      summary: source ? source.summary : (submission.description || "")
    }, buildConnectPartyListingMeta(applicantListingId)),
    Object.assign({
      side: "对接方",
      partyRole: "recipient",
      roleLabel: "资源方",
      title: target ? target.title : submission.targetTitle,
      type: target ? target.type : "",
      region: target ? target.region : "",
      company: targetProfile.company || (targetSubmission ? targetSubmission.company : ""),
      contact: targetProfile.contact || (targetSubmission ? targetSubmission.contact : ""),
      phone: targetProfile.phone || (targetSubmission ? targetSubmission.phone : ""),
      summary: target ? target.summary : ""
    }, buildConnectPartyListingMeta(recipientListingId))
  ]
}

function isConnectContactsExchanged(submission) {
  return connectStage.isConnectContactsExchanged(submission)
}

function getConnectConfirmRoleLabel(submission) {
  return isResourceToDemandConnect(submission) ? "需求方" : "资源方"
}

function getConnectStageContext(submission, viewerPhone) {
  return {
    role: viewerPhone ? getConnectRole(submission, viewerPhone) : null,
    actions: viewerPhone ? getConnectRecordActions(submission, viewerPhone) : null,
    confirmRoleLabel: getConnectConfirmRoleLabel(submission),
    canActAsRecipient: viewerPhone ? canActAsConnectRecipient(submission, viewerPhone) : false
  }
}

function getConnectStageView(submission, viewerPhone) {
  return connectStage.buildConnectStageView(
    submission,
    viewerPhone,
    getConnectStageContext(submission, viewerPhone)
  )
}

function buildConnectPartiesForView(submission, options) {
  options = options || {}
  var viewerPhone = options.viewerPhone || ""
  var forAdmin = !!options.forAdmin
  var forStaffOversight = !!options.forStaffOversight
  var exchanged = isConnectContactsExchanged(submission)
  var viewerRole = viewerPhone ? getConnectRole(submission, viewerPhone) : null
  return buildConnectReviewParties(submission).map(function(party) {
    var isSelf = viewerRole && party.partyRole === viewerRole
    var showContact = forAdmin || forStaffOversight || exchanged || isSelf
    var sideLabel = forAdmin || forStaffOversight ? party.side : (viewerRole ? (isSelf ? "我方" : "对方") : party.roleLabel)
    return Object.assign({}, party, {
      side: sideLabel,
      company: showContact ? party.company : "",
      contact: showContact ? party.contact : "",
      phone: showContact ? party.phone : "",
      contactLocked: !showContact
    })
  })
}

function getStaffGlobalConnectCache() {
  return wx.getStorageSync(staffGlobalConnectsKey) || {}
}

function getStaffGlobalConnectSourceList() {
  if (isCloudEnabled()) {
    return (getStaffGlobalConnectCache().connects || []).slice()
  }
  return collectAllConnectCandidates().filter(function(item) {
    return item.type === "connect"
  })
}

function buildStaffGlobalConnectView(connect) {
  if (!connect || connect.type !== "connect") {
    return null
  }
  var parties = buildConnectPartiesForView(connect, { forStaffOversight: true })
  var applicant = null
  var recipient = null
  parties.forEach(function(party) {
    if (party.partyRole === "applicant") {
      applicant = party
    } else if (party.partyRole === "recipient") {
      recipient = party
    }
  })
  var displayStatus = getSubmissionDisplayStatus(connect)
  var direction = isResourceToDemandConnect(connect) ? "资源方 → 需求方" : "需求方 → 资源方"
  var keywordParts = [
    connect.id,
    displayStatus,
    connect.status,
    connect.description,
    applicant && applicant.company,
    applicant && applicant.contact,
    applicant && applicant.phone,
    applicant && applicant.title,
    recipient && recipient.company,
    recipient && recipient.contact,
    recipient && recipient.phone,
    recipient && recipient.title
  ]
  return {
    id: connect.id,
    displayStatus: displayStatus,
    statusBadgeClass: getRecordStatusBadgeClass(displayStatus),
    rawStatus: connect.status || "",
    isInProgress: isConnectSubmissionUnfinished(connect),
    direction: direction,
    directionShort: isResourceToDemandConnect(connect) ? "资源匹配需求" : "需求申请资源",
    applicantRoleLabel: applicant ? applicant.roleLabel : "",
    applicantCompany: applicant ? applicant.company : "",
    applicantContact: applicant ? applicant.contact : "",
    applicantPhone: applicant ? applicant.phone : "",
    applicantTitle: applicant ? applicant.title : "",
    recipientRoleLabel: recipient ? recipient.roleLabel : "",
    recipientCompany: recipient ? recipient.company : "",
    recipientContact: recipient ? recipient.contact : "",
    recipientPhone: recipient ? recipient.phone : "",
    recipientTitle: recipient ? recipient.title : "",
    connectParties: parties,
    description: connect.description || "",
    relativeTime: formatRelativeTime(connect.createdAt),
    createdAt: connect.createdAt || "",
    isProxyConnect: isProxyConnectReviewSubmission(connect) || isProxyToProxyConnect(connect) || !!connect.matchedByStaff,
    matchedByStaff: !!connect.matchedByStaff,
    needsPlatformReview: !!(connect.status === "待平台审核" && connect.needsPlatformConnectReview),
    targetId: connect.targetId || "",
    sourceListingId: connect.sourceListingId || "",
    keywordBlob: keywordParts.filter(Boolean).join(" ")
  }
}

function persistStaffGlobalConnectRepair(repaired) {
  if (!repaired || !repaired.id) {
    return
  }
  var cache = getStaffGlobalConnectCache()
  if (!cache.connects || !cache.connects.length) {
    return
  }
  var changed = false
  var nextConnects = cache.connects.map(function(item) {
    if (item.id === repaired.id) {
      changed = true
      return repaired
    }
    return item
  })
  if (!changed) {
    return
  }
  wx.setStorageSync(staffGlobalConnectsKey, Object.assign({}, cache, {
    connects: nextConnects
  }))
}

function normalizeStaffGlobalConnectRecord(connect) {
  if (!connect || connect.type !== "connect") {
    return connect
  }
  var repairResult = repairStaffProxyToProxyConnectSubmission(connect)
  if (repairResult.changed) {
    persistStaffGlobalConnectRepair(repairResult.submission)
  }
  return repairResult.submission
}

function getStaffGlobalConnectViews() {
  if (!isStaffUser() || !isStaffWorkMode()) {
    return []
  }
  var sourceList = getStaffGlobalConnectSourceList()
  return sourceList.map(function(connect) {
    return buildStaffGlobalConnectView(normalizeStaffGlobalConnectRecord(connect))
  }).filter(Boolean).sort(function(a, b) {
    return (b.createdAt || "").localeCompare(a.createdAt || "")
  })
}

function getStaffGlobalConnectStats(items) {
  items = items || getStaffGlobalConnectViews()
  var active = 0
  var pendingPlatform = 0
  var pendingConfirm = 0
  var exchanging = 0
  var exchanged = 0
  items.forEach(function(item) {
    var status = item.displayStatus || item.rawStatus || ""
    if (item.isInProgress) {
      active += 1
    }
    if (item.needsPlatformReview || status === "待平台审核") {
      pendingPlatform += 1
    } else if (status === "待对方确认") {
      pendingConfirm += 1
    } else if (status === "待交换确认" || status === "对方已确认") {
      exchanging += 1
    } else if (status === "已交换名片" || status === "已约谈" || status === "已报价" || status === "已成交") {
      exchanged += 1
    }
  })
  return {
    total: items.length,
    active: active,
    pendingPlatform: pendingPlatform,
    pendingConfirm: pendingConfirm,
    exchanging: exchanging,
    exchanged: exchanged
  }
}

function filterStaffGlobalConnectViews(items, options) {
  options = options || {}
  var status = options.status || "all"
  var keyword = String(options.keyword || "").trim().toLowerCase()
  return (items || []).filter(function(item) {
    var displayStatus = item.displayStatus || item.rawStatus || ""
    if (status === "active") {
      if (!item.isInProgress) {
        return false
      }
    } else if (status === "pending_platform") {
      if (!item.needsPlatformReview && displayStatus !== "待平台审核") {
        return false
      }
    } else if (status === "pending_confirm") {
      if (displayStatus !== "待对方确认") {
        return false
      }
    } else if (status === "exchanging") {
      if (displayStatus !== "待交换确认" && displayStatus !== "对方已确认") {
        return false
      }
    } else if (status === "exchanged") {
      if (["已交换名片", "已约谈", "已报价", "已成交"].indexOf(displayStatus) < 0) {
        return false
      }
    } else if (status === "closed") {
      if (displayStatus !== "已关闭" && displayStatus !== "已流失") {
        return false
      }
    }
    if (keyword) {
      var blob = String(item.keywordBlob || [
        item.id,
        item.applicantCompany,
        item.applicantContact,
        item.applicantPhone,
        item.recipientCompany,
        item.recipientContact,
        item.recipientPhone,
        item.applicantTitle,
        item.recipientTitle,
        item.description
      ].filter(Boolean).join(" ")).toLowerCase()
      if (blob.indexOf(keyword) < 0) {
        return false
      }
    }
    return true
  })
}

function getUserConnectStatusFilterOptions() {
  return [
    { value: "all", label: "全部" },
    { value: "action_mine", label: "待我处理" },
    { value: "active", label: "进行中" },
    { value: "pending_platform", label: "待平台" },
    { value: "waiting_other", label: "待对方" },
    { value: "exchanging", label: "交换中" },
    { value: "exchanged", label: "已完成" },
    { value: "closed", label: "已关闭" }
  ]
}

function matchUserConnectStatusFilter(item, statusKey, viewerPhone) {
  if (!item || item.type !== "connect") {
    return false
  }
  if (!statusKey || statusKey === "all") {
    return true
  }
  var view = getConnectStageView(item, viewerPhone)
  var displayStatus = view.displayStatus || getSubmissionDisplayStatus(item)
  var stage = view.stage
  var ST = connectStage.CONNECT_STAGES
  if (statusKey === "active") {
    return view.isInProgress
  }
  if (statusKey === "action_mine") {
    return view.needsAction || view.pendingSide === "mine"
  }
  if (statusKey === "pending_platform") {
    return view.pendingSide === "platform"
      || stage === ST.PLATFORM_REVIEW
      || displayStatus === "待平台审核"
  }
  if (statusKey === "waiting_other") {
    return view.pendingSide === "other"
  }
  if (statusKey === "exchanging") {
    return stage === ST.WAIT_APPLICANT_EXCHANGE
      || stage === ST.WAIT_RECIPIENT_EXCHANGE
      || displayStatus === "待交换确认"
      || displayStatus === "对方已确认"
  }
  if (statusKey === "exchanged") {
    return stage === ST.EXCHANGED
      || displayStatus === "已交换名片"
      || ["已约谈", "已报价", "已成交"].indexOf(displayStatus) >= 0
  }
  if (statusKey === "closed") {
    return stage === ST.CLOSED
      || displayStatus === "已关闭"
      || displayStatus === "已流失"
  }
  return true
}

function filterConnectSubmissionsForRecordsList(items, options) {
  options = options || {}
  var profile = getUserProfile()
  var viewerPhone = profile ? profile.phone : ""
  var statusKey = options.connectStatus || "all"
  return (items || []).filter(function(item) {
    return matchUserConnectStatusFilter(item, statusKey, viewerPhone)
  })
}

function getUserListingStatusFilterOptions() {
  return [
    { value: "all", label: "全部" },
    { value: "pending", label: "待审核" },
    { value: "published", label: "已发布" },
    { value: "closed", label: "已关闭" },
    { value: "rejected", label: "已驳回" },
    { value: "public_on", label: "已公开展示" },
    { value: "public_off", label: "未公开展示" }
  ]
}

function getRecordPublicDisplayView(record) {
  if (!record || (record.type !== "resource" && !isDemandSubmitType(record.type)) || !record.listingId) {
    return { show: false, label: "", badgeClass: "", key: "" }
  }
  var listing = getItem(record.listingId)
  var isPrivate = isListingPrivateDisplay(listing, record)
  return {
    show: true,
    label: isPrivate ? "未公开展示" : "已公开展示",
    badgeClass: isPrivate ? "public-display-off" : "public-display-on",
    key: isPrivate ? "public_off" : "public_on"
  }
}

function getListingRecordStatusKey(item) {
  if (!item || (item.type !== "resource" && !isDemandSubmitType(item.type))) {
    return ""
  }
  if (item.status === "已关闭" && item.reviewResult === "驳回") {
    return "rejected"
  }
  var displayStatus = getSubmissionDisplayStatus(item)
  if (displayStatus === "待审核" || item.status === "待审核") {
    return "pending"
  }
  if (displayStatus === "已关闭" || displayStatus === "已流失") {
    return "closed"
  }
  if (displayStatus === "已发布" || displayStatus === "已推荐" || displayStatus === "已认证") {
    return "published"
  }
  return "pending"
}

function matchUserListingStatusFilter(item, statusKey) {
  if (!item || (item.type !== "resource" && !isDemandSubmitType(item.type))) {
    return false
  }
  if (!statusKey || statusKey === "all") {
    return true
  }
  if (statusKey === "public_on" || statusKey === "public_off") {
    return getRecordPublicDisplayView(item).key === statusKey
  }
  return getListingRecordStatusKey(item) === statusKey
}

function filterListingSubmissionsForRecordsList(items, options) {
  options = options || {}
  var statusKey = options.listingStatus || "all"
  return (items || []).filter(function(item) {
    return matchUserListingStatusFilter(item, statusKey)
  })
}

function getRecordStatusFilterOptions(filterCategory) {
  if (filterCategory === "connect") {
    return getUserConnectStatusFilterOptions()
  }
  if (filterCategory === "resource" || filterCategory === "demand") {
    return getUserListingStatusFilterOptions()
  }
  return []
}

function filterSubmissionsForRecordsStatus(items, filterCategory, statusKey) {
  if (!statusKey || statusKey === "all" || !filterCategory || filterCategory === "all") {
    return items || []
  }
  if (filterCategory === "connect") {
    return filterConnectSubmissionsForRecordsList(items, { connectStatus: statusKey })
  }
  if (filterCategory === "resource" || filterCategory === "demand") {
    return filterListingSubmissionsForRecordsList(items, { listingStatus: statusKey })
  }
  return items || []
}

function getStaffGlobalConnectDetail(id) {
  if (!id || !isStaffUser() || !isStaffWorkMode()) {
    return null
  }
  var views = getStaffGlobalConnectViews()
  for (var i = 0; i < views.length; i += 1) {
    if (views[i].id === id) {
      return views[i]
    }
  }
  var sourceList = getStaffGlobalConnectSourceList()
  for (var j = 0; j < sourceList.length; j += 1) {
    if (sourceList[j].id === id) {
      return buildStaffGlobalConnectView(sourceList[j])
    }
  }
  return null
}

function getStaffGlobalConnectRaw(id) {
  if (!id) {
    return null
  }
  var sourceList = getStaffGlobalConnectSourceList()
  for (var i = 0; i < sourceList.length; i += 1) {
    if (sourceList[i].id === id) {
      return sourceList[i]
    }
  }
  return null
}

function refreshStaffGlobalConnectsFromCloud(options) {
  options = options || {}
  if (!isCloudEnabled()) {
    return Promise.resolve({ ok: true, local: true })
  }
  if (!isAdminLoggedIn()) {
    return Promise.resolve({ ok: false, message: "无运营权限" })
  }
  var remoteOptions = {
    skipRepair: options.skipRepair === true,
    silent: options.background === true || options.silent === true
  }
  return cloudStore.listStaffGlobalConnectsRemote(remoteOptions).then(function(result) {
    if (result && result.data) {
      cloudStore.applyStaffGlobalConnectData(result.data)
    }
    if (options.background) {
      return result
    }
    return repairUnfinishedConnectsForClosedListings().then(function() {
      return result
    })
  })
}

function getConnectDisplayHint(submission, viewerPhone) {
  if (!submission || submission.type !== "connect") {
    return getSubmissionDisplayHint(submission)
  }
  if (isConnectContactsExchanged(submission)) {
    return "双方已同意交换联系方式，可查看对方企业与联系方式。"
  }
  var role = viewerPhone ? getConnectRole(submission, viewerPhone) : null
  if (submission.status === "待平台审核" && role === "proxyStaff") {
    return "涉及平台代发商机，请在运营工作台审批该对接申请。"
  }
  var stageView = getConnectStageView(submission, viewerPhone)
  if (stageView.pendingHint) {
    return stageView.pendingHint
  }
  if (role === "recipient" && stageView.stage === connectStage.CONNECT_STAGES.WAIT_RECIPIENT_CONFIRM) {
    return "您收到一条对接申请，同意后将同时发起交换名片，等待申请方确认。"
  }
  if (role === "applicant" && stageView.stage === connectStage.CONNECT_STAGES.WAIT_RECIPIENT_CONFIRM) {
    var confirmRoleLabel = getConnectConfirmRoleLabel(submission)
    return "对接申请已发送，等待" + confirmRoleLabel + "确认。对方未回应时，可在本页取消或重新申请。"
  }
  return getStatusHint(stageView.displayStatus || getSubmissionDisplayStatus(submission))
}

function getApprovedCardCert() {
  var certs = getSubmissions().filter(function(item) {
    return item.type === "certify" && item.certLevel === "card" && isCertApproved(item)
  })
  return certs.length > 0 ? certs[0] : null
}

function getApprovedLicenseCert() {
  var certs = getSubmissions().filter(function(item) {
    return item.type === "certify" && item.certLevel === "license" && isCertApproved(item)
  })
  return certs.length > 0 ? certs[0] : null
}

function getApprovedCertLevel() {
  if (getApprovedLicenseCert()) {
    return "license"
  }
  if (getApprovedCardCert()) {
    return "card"
  }
  var profile = getUserProfile()
  if (profile && profile.certLevel && profile.certStatus === "verified") {
    return profile.certLevel
  }
  return ""
}

function repairProfileCertStatus() {
  var approvedLevel = getApprovedCertLevel()
  if (!approvedLevel) {
    return Promise.resolve(null)
  }
  var profile = getUserProfile()
  if (!profile) {
    return Promise.resolve(null)
  }
  if (profile.certStatus === "verified" && profile.certLevel === approvedLevel) {
    return Promise.resolve(profile)
  }
  var merged = Object.assign({}, profile, {
    certStatus: "verified",
    certLevel: approvedLevel
  })
  wx.setStorageSync(userProfileKey, merged)
  return Promise.resolve(merged)
}

function getPendingCertSubmission(certLevel) {
  var certs = getCertifySubmissions()
  for (var i = 0; i < certs.length; i++) {
    if (!isCertPending(certs[i])) {
      continue
    }
    if (certLevel && certs[i].certLevel !== certLevel) {
      continue
    }
    return certs[i]
  }
  return null
}

function buildCertUpgradeFieldLocks(cardCert) {
  cardCert = cardCert || {}
  function hadValue(field) {
    var val = cardCert[field]
    return !!(val && String(val).trim())
  }
  return {
    company: hadValue("company"),
    region: hadValue("region"),
    role: hadValue("role"),
    contact: hadValue("contact"),
    phone: hadValue("phone"),
    email: hadValue("email"),
    website: hadValue("website"),
    cardImage: hadValue("cardImage"),
    creditCode: false,
    licenseImage: false,
    description: false
  }
}

function mergeCertDescription(baseDescription, supplement) {
  var base = (baseDescription || "").trim()
  var extra = (supplement || "").trim()
  if (base && extra) {
    return base + "\n【升级补充】" + extra
  }
  return extra || base
}

function getCertViewState(options) {
  options = options || {}
  var certSummary = getUserCertSummary()
  var cert = certSummary.certifyRecord
  var cardCert = getApprovedCardCert()
  var isUpgrade = options.level === "license" && (
    certSummary.canUpgrade ||
    (!!getApprovedCardCert() && !getPendingCertSubmission("license"))
  )
  var isRejected = !!(cert && (cert.status === "已关闭" || cert.status === "已流失"))

  if (isUpgrade) {
    return {
      readOnly: false,
      mode: "upgrade",
      cert: cardCert || cert,
      cardCert: cardCert,
      fieldLocks: buildCertUpgradeFieldLocks(cardCert),
      certSummary: certSummary
    }
  }
  if (isRejected) {
    return { readOnly: false, mode: "edit", cert: cert, certSummary: certSummary }
  }
  var profile = getUserProfile()
  var pendingApplication = hasPendingCertApplication()
  if (
    pendingApplication ||
    options.view === "1" ||
    certSummary.status === "pending" ||
    certSummary.status === "card_verified" ||
    certSummary.status === "license_verified"
  ) {
    if (cert) {
      return { readOnly: true, mode: "view", cert: cert, certSummary: certSummary }
    }
    if (pendingApplication) {
      return {
        readOnly: true,
        mode: "view",
        cert: cert,
        certSummary: certSummary,
        pendingFromProfile: !!(profile && profile.certStatus === "pending")
      }
    }
    return { readOnly: false, mode: "edit", cert: null, certSummary: certSummary }
  }
  return { readOnly: false, mode: "edit", cert: cert, certSummary: certSummary }
}

function buildAdminReviewFields(submission, listing) {
  var fields = []
  if (submission) {
    pushAdminReviewField(fields, "申请类型", getSubmissionTypeLabel(submission.type))
    pushAdminReviewField(fields, "标题", submission.title)
    pushAdminReviewField(fields, "业务类型", submission.listingType)
    pushAdminReviewField(fields, "产品", submission.serverProduct)
    pushAdminReviewField(fields, "规格", getServerConfigText(submission))
    pushAdminReviewField(fields, "企业所在地", submission.region)
    pushAdminReviewField(fields, "地点", submission.procurementRegion)
    pushAdminReviewField(fields, "品牌偏好", submission.serverBrand)
    pushAdminReviewField(fields, "质保", submission.warranty)
    pushAdminReviewField(fields, "支付", submission.serverPayment)
    pushAdminReviewField(fields, "流程", submission.serverProcess)
    pushAdminReviewField(fields, "规模", submission.scale)
    pushAdminReviewField(fields, "期望交货", submission.deliveryTime || submission.startTime)
    pushAdminReviewField(fields, "周期", submission.cycle)
    pushAdminReviewField(fields, "预算", submission.budget)
    pushAdminReviewField(fields, "价格", submission.price)
    pushAdminReviewField(fields, "交付方式", submission.delivery)
    pushAdminReviewField(fields, "期望开始", submission.startTime)
    pushAdminReviewField(fields, "对接对象", submission.targetTitle)
    pushAdminReviewField(fields, "己方需求", submission.sourceTitle)
    pushAdminReviewField(fields, "对接方向", submission.connectDirection === "resource_to_demand"
      ? "资源方申请对接需求方"
      : (submission.connectDirection === "demand_to_resource" ? "需求方申请对接资源方" : ""))
    pushAdminReviewField(fields, "对接说明", submission.type === "connect" ? submission.description : "")
    pushAdminReviewField(fields, "认证等级", submission.certLevel === "license" ? "营业执照认证" : (submission.certLevel === "card" ? "名片认证" : ""))
    pushAdminReviewField(fields, "信用代码", submission.creditCode)
    pushAdminReviewField(fields, "邮箱", submission.email)
    pushAdminReviewField(fields, "官网", submission.website)
    if (submission.type !== "connect" && !String(submission.description || "").trim()) {
      pushAdminReviewField(fields, "说明", submission.description)
    }
  }
  if (listing) {
    pushAdminReviewField(fields, "公示标题", listing.title)
    pushAdminReviewField(fields, "公示类型", listing.type)
    pushAdminReviewField(fields, "公示摘要", listing.summary)
    pushAdminReviewField(fields, "核验状态", listing.verification)
    pushAdminReviewField(fields, "发布时间", listing.publishedAt)
  }
  return fields
}

function getAdminReviewDetail(reviewType, id) {
  var typeNames = {
    demand: "需求提交",
    resource: "资源发布",
    server: "算力整机需求",
    room: "机房项目",
    match: "人工撮合",
    connect: "对接申请",
    certify: "企业认证"
  }

  if (reviewType === "listing") {
    var listing = getItem(id)
    if (!listing) {
      return null
    }
    var submission = listing.submissionId ? getSubmission(listing.submissionId) : null
    var pool = isResource(id) ? "resource" : "demand"
    return {
      reviewType: "listing",
      id: id,
      submissionId: listing.submissionId || "",
      listingId: id,
      typeName: pool === "resource" ? "资源公示" : "需求公示",
      statusText: listing.verification || "待审核",
      title: listing.title,
      listingType: listing.type,
      summary: submission ? String(submission.description || "").trim() : listing.summary,
      company: submission ? submission.company : listing.maskedCompany,
      contact: submission ? submission.contact : "",
      phone: submission ? submission.phone : "",
      role: submission ? submission.role : "",
      region: (submission ? submission.region : "") || listing.region || "",
      createdAt: submission ? submission.createdAt : listing.publishedAt,
      showApplicantRegionRole: !isCardCertReviewSubmission(submission),
      fields: buildAdminReviewFields(submission, listing),
      attachments: submission && submission.attachments
        ? submission.attachments.map(function(item) {
          return {
            label: item.name || "附件",
            url: item.url,
            fileType: item.fileType || "file"
          }
        })
        : []
    }
  }

  var record = getSubmission(id)
  if (!record) {
    return null
  }
  var linkedListing = record.listingId ? getItem(record.listingId) : null
  var certImages = []
  if (record.type === "certify") {
    if (record.cardImage) {
      certImages.push({ label: "个人名片", url: record.cardImage })
    }
    if (record.licenseImage) {
      certImages.push({ label: "营业执照", url: record.licenseImage })
    }
  }
  var connectParties = record.type === "connect"
    ? buildConnectPartiesForView(record, { forAdmin: true })
    : []
  var isProxyConnectReview = isProxyConnectReviewSubmission(record)
  var proxyInfo = isProxyConnectReview ? getProxyConnectReviewSummary(record) : null
  var attachments = (record.attachments || []).map(function(item) {
    return {
      label: item.name || "附件",
      url: item.url,
      fileType: item.fileType || "file"
    }
  })
  return {
    reviewType: "submission",
    id: record.id,
    submissionId: record.id,
    listingId: record.listingId || "",
    typeName: isProxyConnectReview ? "代发对接审核" : (typeNames[record.type] || "商机申请"),
    statusText: record.status || "待审核",
    title: record.title || record.targetTitle || typeNames[record.type] || "待审核申请",
    attachments: attachments,
    listingType: record.listingType || record.type,
    summary: record.description || "",
    company: record.company,
    contact: record.contact,
    phone: record.phone,
    role: record.role,
    region: record.region,
    createdAt: record.createdAt,
    showApplicantRegionRole: !isCardCertReviewSubmission(record),
    certLevel: record.certLevel || "",
    certImages: certImages,
    connectParties: connectParties,
    isConnectReview: record.type === "connect",
    isProxyConnectReview: isProxyConnectReview,
    proxyInfo: proxyInfo,
    fields: buildAdminReviewFields(record, linkedListing)
  }
}

function getAdminSession() {
  return adminModule.getAdminSession()
}

function isStaffUser() {
  return adminModule.isStaffUser()
}

function getStaffRoleLabel() {
  return adminModule.getStaffRoleLabel()
}

function isAdminModeActive() {
  return adminModule.isAdminModeActive()
}

function getAdminAuthPayload() {
  return adminModule.getAdminAuthPayload()
}

function enterAdminMode() {
  return adminModule.enterAdminMode()
}

function exitAdminMode() {
  return adminModule.exitAdminMode()
}

function isAdminLoggedIn() {
  return adminModule.isAdminLoggedIn()
}

function loginAdmin() {
  return {
    ok: false,
    message: "运营账号请使用已开通 staffRole 的用户账号登录，无需单独登录运营后台。"
  }
}

function logoutAdmin() {
  return adminModule.logoutAdmin()
}

function getAdminLoginHint() {
  return adminModule.getAdminLoginHint()
}

function ensureStaffAdminMode() {
  return adminModule.ensureStaffAdminMode()
}

function getAccountMode() {
  return adminModule.getAccountMode()
}

function switchToStaffMode() {
  return adminModule.switchToStaffMode()
}

function switchToUserMode() {
  return adminModule.switchToUserMode()
}

function getAdminLockStatus() {
  return { locked: false, remainSeconds: 0 }
}

function buildApprovedListingPatch(listing) {
  var pool = getListingPool(listing.id)
  var verification = pool === "resource" ? "资源已初审" : "需求已初审"
  var highlights = listing && listing.highlights
    ? listing.highlights.map(function(item) {
      return item === "待平台核验" ? "平台已初审" : item
    })
    : ["平台已初审"]
  return {
    verification: verification,
    matchScore: matching.buildApprovedListingScore(listing),
    highlights: highlights,
    publishedAt: formatDate(new Date())
  }
}

function applyListingApprovalLocal(listingId, options) {
  options = options || {}
  var current = getItem(listingId)
  if (!current) {
    return null
  }
  var listing = updatePublishedListing(listingId, buildApprovedListingPatch(current))
  if (listing && listing.submissionId) {
    var submission = getSubmission(listing.submissionId)
    appendSubmissionTimeline(
      listing.submissionId,
      "已发布",
      getListingApprovedPublicHint(listing, submission, { staffReview: !options.auto }),
      { reviewResult: "通过" }
    )
  }
  return listing
}

function shouldAutoApproveListing() {
  return config.autoApproveListing !== false
}

function approveListingReview(listingId) {
  if (isCloudEnabled()) {
    if (!isAdminLoggedIn()) {
      return Promise.reject(new Error("无运营权限"))
    }
    return cloudStore.adminReviewRemote(Object.assign({
      reviewType: "listing",
      action: "approve",
      id: listingId
    }, getAdminAuthPayload())).then(function() {
      return getItem(listingId)
    })
  }
  return applyListingApprovalLocal(listingId)
}

function isAccountDisabled(profile) {
  profile = profile || getUserProfile()
  return !!(profile && profile.accountStatus === "disabled")
}

function adminTakeDownListingAsync(listingId, reason) {
  if (!isPlatformAdminUser()) {
    return Promise.resolve({ ok: false, message: "仅平台管理员可下架商机" })
  }
  if (!listingId) {
    return Promise.resolve({ ok: false, message: "缺少商机编号" })
  }
  if (isCloudEnabled()) {
    return cloudStore.adminTakeDownListingRemote(listingId, reason).then(function(result) {
      if (!result || result.ok === false) {
        return { ok: false, message: (result && result.message) || "下架失败" }
      }
      updatePublishedListing(listingId, {
        status: "closed",
        verification: "已关闭"
      })
      if (result.data && result.data.listing && result.data.listing.submissionId) {
        appendSubmissionTimeline(
          result.data.listing.submissionId,
          "已关闭",
          reason || "平台管理员下架，不再公开展示。",
          {}
        )
      }
      return { ok: true }
    }).catch(function(error) {
      return { ok: false, message: error.message || "下架失败" }
    })
  }
  var listing = getItem(listingId)
  if (!listing) {
    return Promise.resolve({ ok: false, message: "商机不存在" })
  }
  if (isListingClosed(listing)) {
    return Promise.resolve({ ok: false, message: "该商机已下架" })
  }
  updatePublishedListing(listingId, {
    status: "closed",
    verification: "已关闭"
  })
  if (listing.submissionId) {
    appendSubmissionTimeline(
      listing.submissionId,
      "已关闭",
      reason || "平台管理员下架，不再公开展示。",
      {}
    )
  }
  return closeUnfinishedConnectsForListing(listingId).then(function() {
    return { ok: true }
  })
}

function adminSearchPublishedListingsAsync(options) {
  if (!isPlatformAdminUser()) {
    return Promise.resolve({ ok: false, message: "仅平台管理员可查询", items: [] })
  }
  options = options || {}
  if (isCloudEnabled()) {
    return cloudStore.adminSearchPublishedListingsRemote(options).then(function(result) {
      return {
        ok: !!(result && result.ok !== false),
        items: result && result.data ? (result.data.items || []) : [],
        total: result && result.data ? (result.data.total || 0) : 0,
        message: result && result.message
      }
    }).catch(function(error) {
      return { ok: false, message: error.message || "查询失败", items: [] }
    })
  }
  var keyword = String(options.keyword || "").trim().toLowerCase()
  var pool = options.pool || "all"
  var includeClosed = !!options.includeClosed
  var source = []
  if (pool === "demand") {
    source = wx.getStorageSync(publishedDemandsKey) || []
  } else if (pool === "resource") {
    source = wx.getStorageSync(publishedResourcesKey) || []
  } else {
    source = (wx.getStorageSync(publishedResourcesKey) || []).concat(wx.getStorageSync(publishedDemandsKey) || [])
  }
  var items = source.filter(function(item) {
    if (!item || !item.id) {
      return false
    }
    if (!includeClosed && isListingClosed(item)) {
      return false
    }
    if (!keyword) {
      return true
    }
    var haystack = [item.id, item.title, item.type, item.region, item.summary].join(" ").toLowerCase()
    return haystack.indexOf(keyword) > -1
  }).map(function(item) {
    return {
      id: item.id,
      pool: item.pool || (isResource(item.id) ? "resource" : "demand"),
      type: item.type || "",
      title: item.title || "",
      region: item.region || "",
      verification: item.verification || "",
      publishedAt: item.publishedAt || "",
      ownerPhone: item.ownerPhone || "",
      publishedByStaff: !!item.publishedByStaff
    }
  })
  return Promise.resolve({ ok: true, items: items.slice(0, 50), total: items.length })
}

function adminLookupUserAsync(phone) {
  if (!isPlatformAdminUser()) {
    return Promise.resolve({ ok: false, message: "仅平台管理员可查询用户" })
  }
  phone = String(phone || "").trim()
  if (!/^1\d{10}$/.test(phone)) {
    return Promise.resolve({ ok: false, message: "请输入11位有效手机号" })
  }
  if (isCloudEnabled()) {
    return cloudStore.adminLookupUserRemote(phone).then(function(result) {
      if (!result || result.ok === false) {
        return { ok: false, message: (result && result.message) || "查询失败" }
      }
      return { ok: true, user: result.data && result.data.user ? result.data.user : null }
    }).catch(function(error) {
      return { ok: false, message: error.message || "查询失败" }
    })
  }
  var profile = wx.getStorageSync(userProfileKey) || null
  if (!profile || profile.phone !== phone) {
    return Promise.resolve({ ok: false, message: "本地模式仅可查询当前登录账号" })
  }
  return Promise.resolve({
    ok: true,
    user: {
      phone: profile.phone,
      contact: profile.contact || "",
      company: profile.company || "",
      role: profile.role || "",
      region: profile.region || "",
      accountStatus: profile.accountStatus || "active",
      certStatus: profile.certStatus || "",
      certLevel: profile.certLevel || "",
      staffRole: profile.staffRole || ""
    }
  })
}

function adminDisableAccountAsync(phone, reason) {
  if (!isPlatformAdminUser()) {
    return Promise.resolve({ ok: false, message: "仅平台管理员可禁用账号" })
  }
  phone = String(phone || "").trim()
  if (!/^1\d{10}$/.test(phone)) {
    return Promise.resolve({ ok: false, message: "请输入11位有效手机号" })
  }
  if (isCloudEnabled()) {
    return cloudStore.adminDisableAccountRemote(phone, reason).then(function(result) {
      if (!result || result.ok === false) {
        return { ok: false, message: (result && result.message) || "禁用失败" }
      }
      return {
        ok: true,
        takenDownCount: result.data ? (result.data.takenDownCount || 0) : 0
      }
    }).catch(function(error) {
      return { ok: false, message: error.message || "禁用失败" }
    })
  }
  return Promise.resolve({ ok: false, message: "禁用账号需开启云端模式" })
}

function adminEnableAccountAsync(phone) {
  if (!isPlatformAdminUser()) {
    return Promise.resolve({ ok: false, message: "仅平台管理员可解禁账号" })
  }
  phone = String(phone || "").trim()
  if (!/^1\d{10}$/.test(phone)) {
    return Promise.resolve({ ok: false, message: "请输入11位有效手机号" })
  }
  if (isCloudEnabled()) {
    return cloudStore.adminEnableAccountRemote(phone).then(function(result) {
      if (!result || result.ok === false) {
        return { ok: false, message: (result && result.message) || "解禁失败" }
      }
      return { ok: true }
    }).catch(function(error) {
      return { ok: false, message: error.message || "解禁失败" }
    })
  }
  return Promise.resolve({ ok: false, message: "解禁账号需开启云端模式" })
}

function rejectListingReview(listingId, reason) {
  if (isCloudEnabled()) {
    if (!isAdminLoggedIn()) {
      return Promise.reject(new Error("无运营权限"))
    }
    return cloudStore.adminReviewRemote(Object.assign({
      reviewType: "listing",
      action: "reject",
      id: listingId,
      reason: reason
    }, getAdminAuthPayload())).then(function() {
      return true
    })
  }
  var listing = getItem(listingId)
  removePublishedListing(listingId)
  if (listing && listing.submissionId) {
    appendSubmissionTimeline(
      listing.submissionId,
      "已关闭",
      reason || "未通过平台初审，已从公示池下架。",
      { reviewResult: "驳回", listingId: "" }
    )
  }
  return true
}

function approveSubmissionReview(submissionId) {
  if (isCloudEnabled()) {
    if (!isAdminLoggedIn()) {
      return Promise.reject(new Error("无运营权限"))
    }
    return cloudStore.adminReviewRemote(Object.assign({
      reviewType: "submission",
      action: "approve",
      id: submissionId
    }, getAdminAuthPayload())).then(function() {
      return getSubmission(submissionId)
    })
  }
  var submission = getSubmission(submissionId)
  var extra = { reviewResult: "通过" }
  var hint = "撮合经理已受理，将安排后续推荐或对接。"
  if (submission && submission.type === "connect" && submission.needsPlatformConnectReview) {
    hint = isResourceToDemandConnect(submission)
      ? "平台已批准对接，等待需求方确认是否愿意沟通。"
      : "平台已批准对接，等待资源方确认是否愿意沟通。"
    return appendSubmissionTimeline(submissionId, "待对方确认", hint, Object.assign({}, extra, {
      platformConnectApproved: true
    }))
  }
  if (submission && submission.type === "certify") {
    var level = submission.certLevel || "card"
    var levelConfig = getCertLevelConfig(level)
    hint = levelConfig.verifiedText + "已通过，" + levelConfig.verifiedHint
    saveUserProfile({
      certLevel: level,
      certStatus: "verified",
      certVerifiedAt: formatDate(new Date()),
      company: submission.company || "",
      creditCode: submission.creditCode || "",
      role: submission.role || "",
      region: submission.region || "",
      contact: submission.contact || "",
      phone: submission.phone || "",
      email: submission.email || "",
      website: submission.website || ""
    })
    return appendSubmissionTimeline(submissionId, "已认证", hint, extra)
  }
  return appendSubmissionTimeline(submissionId, "已推荐", hint, extra)
}

function rejectSubmissionReview(submissionId, reason) {
  if (isCloudEnabled()) {
    if (!isAdminLoggedIn()) {
      return Promise.reject(new Error("无运营权限"))
    }
    return cloudStore.adminReviewRemote(Object.assign({
      reviewType: "submission",
      action: "reject",
      id: submissionId,
      reason: reason
    }, getAdminAuthPayload())).then(function() {
      return getSubmission(submissionId)
    })
  }
  var submission = getSubmission(submissionId)
  var result = appendSubmissionTimeline(
    submissionId,
    "已关闭",
    reason || "未通过平台初审。",
    { reviewResult: "驳回" }
  )
  if (submission && submission.type === "certify") {
    if (submission.certLevel === "license" && getApprovedCardCert()) {
      saveUserProfile({
        certStatus: "verified",
        certLevel: "card"
      })
    } else {
      saveUserProfile({ certStatus: "rejected" })
    }
  }
  return result
}

function getConnectConfirmPrecheck(submissionId) {
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return { ok: false, message: "请先登录后再操作。" }
  }
  var submission = getSubmission(submissionId)
  if (!submission || submission.type !== "connect") {
    return { ok: false, message: "对接申请不存在或已从本地移除，请下拉刷新后重试。" }
  }
  if (!canActAsConnectRecipient(submission, profile.phone)) {
    return {
      ok: false,
      message: getConnectRecipientSideMode(submission) === "proxy"
        ? "该对接涉及平台代发商机，请使用运营账号在代发侧确认。"
        : (isResourceToDemandConnect(submission)
          ? "当前账号不是该需求方，无法确认。"
          : "当前账号不是该资源方，无法确认。")
    }
  }
  if (submission.status === "待平台审核") {
    return { ok: false, message: "平台审批通过后才可确认。" }
  }
  if (submission.status !== "待对方确认") {
    return {
      ok: false,
      message: "当前状态为「" + (getSubmissionDisplayStatus(submission) || submission.status || "未知") + "」，无法再次确认。"
    }
  }
  return { ok: true }
}

function confirmConnectByRecipient(submissionId) {
  var precheck = getConnectConfirmPrecheck(submissionId)
  if (!precheck.ok) {
    return Promise.resolve(precheck)
  }
  var submission = getSubmission(submissionId)
  if (isCloudEnabled()) {
    return cloudStore.confirmConnectByRecipientRemote(submissionId).then(function(result) {
      if (!result || result.ok === false) {
        return { ok: false, message: (result && result.message) || "确认失败" }
      }
      return { ok: true }
    }).catch(function(error) {
      return { ok: false, message: error.message || "确认失败" }
    })
  }
  var recipientRoleLabel = isResourceToDemandConnect(submission) ? "需求方" : "资源方"
  return Promise.resolve(appendSubmissionTimeline(
    submissionId,
    "待交换确认",
    recipientRoleLabel + "已同意对接并发起交换名片，等待申请方确认。",
    {
      recipientConfirmed: true,
      recipientConfirmedAt: formatDate(new Date()),
      recipientExchangeAgree: true,
      recipientExchangeAgreedAt: formatDate(new Date())
    }
  )).then(function() {
    return { ok: true }
  }).catch(function(error) {
    return { ok: false, message: error.message || "确认失败" }
  })
}

function cancelConnectByApplicant(submissionId, reason) {
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return Promise.resolve({ ok: false, message: "请先登录后再操作。" })
  }
  var submission = getSubmission(submissionId)
  if (!submission || submission.type !== "connect") {
    return Promise.resolve({ ok: false, message: "对接申请不存在" })
  }
  if (getConnectRole(submission, profile.phone) !== "applicant") {
    return Promise.resolve({ ok: false, message: "仅申请方可取消对接" })
  }
  if (!isApplicantWaitingForRecipient(submission)) {
    return Promise.resolve({ ok: false, message: "当前状态不可取消" })
  }
  return Promise.resolve(appendSubmissionTimeline(
    submissionId,
    "已关闭",
    reason || "申请方已取消对接申请。",
    { cancelledByApplicant: true, cancelledAt: formatDate(new Date()) }
  )).then(function() {
    return { ok: true }
  }).catch(function(error) {
    return { ok: false, message: error.message || "取消失败" }
  })
}

function rejectConnectByRecipient(submissionId, reason) {
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return Promise.resolve({ ok: false, message: "请先登录" })
  }
  var submission = getSubmission(submissionId)
  if (!submission || submission.type !== "connect") {
    return Promise.resolve({ ok: false, message: "对接申请不存在" })
  }
  if (!canActAsConnectRecipient(submission, profile.phone)) {
    return Promise.resolve({
      ok: false,
      message: getConnectRecipientSideMode(submission) === "proxy"
        ? "请使用运营账号在代发侧操作"
        : (isResourceToDemandConnect(submission) ? "仅需求方可拒绝" : "仅资源方可拒绝")
    })
  }
  if (submission.status !== "待对方确认") {
    return Promise.resolve({ ok: false, message: "当前状态不可操作" })
  }
  if (isCloudEnabled()) {
    return cloudStore.rejectConnectByRecipientRemote(submissionId, reason).then(function(result) {
      if (!result || result.ok === false) {
        return { ok: false, message: (result && result.message) || "操作失败" }
      }
      return { ok: true }
    }).catch(function(error) {
      return { ok: false, message: error.message || "操作失败" }
    })
  }
  return Promise.resolve(appendSubmissionTimeline(
    submissionId,
    "已关闭",
    reason || (isResourceToDemandConnect(submission) ? "需求方暂不合适对接。" : "资源方暂不合适对接。"),
    { reviewResult: "拒绝" }
  )).then(function() {
    return { ok: true }
  }).catch(function(error) {
    return { ok: false, message: error.message || "操作失败" }
  })
}

function getConnectExchangePrecheck(submissionId) {
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return { ok: false, message: "请先登录后再操作。" }
  }
  var submission = getSubmission(submissionId)
  if (!submission || submission.type !== "connect") {
    return { ok: false, message: "对接申请不存在或已从本地移除，请下拉刷新后重试。" }
  }
  var actions = getConnectRecordActions(submission, profile.phone)
  if (!actions || !actions.canExchange) {
    return { ok: false, message: "当前状态不可交换名片，请下拉刷新后重试。" }
  }
  if (!getConnectActionSideForViewer(submission, profile.phone)) {
    return { ok: false, message: "无权操作此对接" }
  }
  if (!isConnectInExchangePhase(submission)) {
    return { ok: false, message: "当前状态不可选择" }
  }
  return { ok: true }
}

function setConnectExchangeConsent(submissionId, agree) {
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return Promise.resolve({ ok: false, message: "请先登录后再操作。" })
  }
  var submission = getSubmission(submissionId)
  if (!submission || submission.type !== "connect") {
    return Promise.resolve({ ok: false, message: "对接申请不存在" })
  }
  var side = getConnectActionSideForViewer(submission, profile.phone)
  if (!side) {
    return Promise.resolve({ ok: false, message: "无权操作此对接" })
  }
  if (!isConnectInExchangePhase(submission)) {
    return Promise.resolve({ ok: false, message: "当前状态不可选择" })
  }
  if (isCloudEnabled()) {
    return cloudStore.agreeConnectExchangeRemote(submissionId, agree).then(function(result) {
      if (!result || result.ok === false) {
        return { ok: false, message: (result && result.message) || "操作失败" }
      }
      var data = result.data || {}
      return {
        ok: true,
        exchanged: !!data.exchanged,
        closed: !!data.closed,
        waiting: !!data.waiting
      }
    }).catch(function(error) {
      return { ok: false, message: error.message || "操作失败" }
    })
  }
  if (submission.status === "待对方确认" && isConnectRecipientResponded(submission)) {
    submission = Object.assign({}, submission, { status: "待交换确认" })
    var list = getAllSubmissionsRaw()
    for (var si = 0; si < list.length; si += 1) {
      if (list[si].id === submissionId) {
        list[si] = Object.assign({}, list[si], { status: "待交换确认" })
        wx.setStorageSync(submissionKey, list)
        break
      }
    }
  }

  var patch = {}
  if (side === "applicant") {
    patch.applicantExchangeAgree = agree
  } else {
    patch.recipientExchangeAgree = agree
  }

  if (!agree) {
    return Promise.resolve(appendSubmissionTimeline(
      submissionId,
      "已关闭",
      (side === "applicant" ? "申请方" : (isResourceToDemandConnect(submission) ? "需求方" : "资源方")) + "选择暂不交换名片，对接已关闭。",
      patch
    )).then(function() {
      return { ok: true, closed: true }
    }).catch(function(error) {
      return { ok: false, message: error.message || "操作失败" }
    })
  }

  var merged = Object.assign({}, submission, patch)
  if (merged.applicantExchangeAgree === true && merged.recipientExchangeAgree === true) {
    var applicantListing = merged.sourceListingId ? getItem(merged.sourceListingId) : null
    var applicantProfile = getListingPartyProfile(applicantListing)
    var applicantInfo = {
      company: applicantProfile.company || merged.company,
      contact: applicantProfile.contact || merged.contact,
      phone: applicantProfile.phone || merged.phone,
      role: applicantProfile.role || merged.role
    }
    var targetListing = getItem(merged.targetId)
    var recipientProfile = getListingPartyProfile(targetListing)
    var recipientInfo = {
      company: recipientProfile.company,
      contact: recipientProfile.contact,
      phone: recipientProfile.phone,
      role: recipientProfile.role
    }
    return Promise.resolve(appendSubmissionTimeline(
      submissionId,
      "已交换名片",
      "申请方已同意交换名片，双方联系方式已在记录中公示。",
      {
        applicantExchangeAgree: true,
        recipientExchangeAgree: true,
        disclosedContacts: {
          applicant: applicantInfo,
          recipient: recipientInfo
        },
        matchedAt: formatDate(new Date())
      }
    )).then(function() {
      return { ok: true, exchanged: true }
    }).catch(function(error) {
      return { ok: false, message: error.message || "操作失败" }
    })
  }

  var waitingHint = side === "applicant"
    ? "申请方已同意交换名片，等待接收方确认。"
    : ((isResourceToDemandConnect(submission) ? "需求方" : "资源方") + "已同意交换名片，等待申请方确认。")
  return Promise.resolve(appendSubmissionTimeline(
    submissionId,
    "待交换确认",
    waitingHint,
    patch
  )).then(function() {
    return { ok: true, waiting: true }
  }).catch(function(error) {
    return { ok: false, message: error.message || "操作失败" }
  })
}

function isConnectRecipientResponded(submission) {
  return connectStage.isConnectRecipientResponded(submission)
}

function isApplicantWaitingForRecipient(submission) {
  if (!submission || submission.type !== "connect") {
    return false
  }
  if (isConnectRecipientResponded(submission)) {
    return false
  }
  return submission.status === "待对方确认" || submission.status === "待平台审核"
}

function getConnectRecordActions(submission, phone) {
  if (!submission || submission.type !== "connect" || !phone) {
    return null
  }
  if (!isConnectSubmissionUnfinished(submission)) {
    return null
  }
  var role = getConnectRole(submission, phone)
  var recipientViewer = isConnectRecipientViewer(submission, phone)
  if (!role && !recipientViewer) {
    return null
  }
  // 接收方确认优先于申请方「等待回应」：同一用户既是资源方又是需求方时须能发起交换名片
  if (canActAsConnectRecipient(submission, phone)
    && submission.status === "待对方确认"
    && !isConnectRecipientResponded(submission)) {
    return {
      role: recipientViewer && getConnectRecipientSideMode(submission) === "proxy" && isStaffUser()
        ? "proxyStaff"
        : (role === "proxyStaff" ? "proxyStaff" : "recipient"),
      canConfirm: true,
      canReject: true
    }
  }
  var side = getConnectActionSideForViewer(submission, phone)
  var recipientAlreadyInitiated = submission.recipientExchangeAgree === true
  if (submission.status !== "待平台审核" && isConnectInExchangePhase(submission) && side) {
    if (side === "applicant" && submission.applicantExchangeAgree !== true) {
      if (submission.applicantExchangeAgree !== false) {
        return { role: "applicant", canExchange: true, canDecline: true }
      }
    }
    if (side === "recipient" && !recipientAlreadyInitiated && submission.recipientExchangeAgree !== true
      && submission.recipientExchangeAgree !== false) {
      return {
        role: role === "proxyStaff" ? "proxyStaff" : "recipient",
        canExchange: true,
        canDecline: true
      }
    }
  }
  if (role === "applicant") {
    var applicantMayReapply = !isDemandToResourceConnect(submission)
    if (isApplicantWaitingForRecipient(submission)) {
      return {
        role: role,
        canCancel: true,
        canReapply: applicantMayReapply
      }
    }
    if (applicantMayReapply && submission.status === "已关闭" && submission.cancelledByApplicant) {
      return { role: role, canReapply: true }
    }
  }
  if (role === "proxyStaff" && submission.status === "待平台审核" && submission.needsPlatformConnectReview) {
    return { role: role, canReview: true }
  }
  return { role: role }
}

function getConnectPendingBadgeClass(pendingSide) {
  return connectStage.getConnectPendingBadgeClass(pendingSide)
}

function getConnectPendingSideView(submission, viewerPhone) {
  var view = getConnectStageView(submission, viewerPhone)
  return {
    pendingSide: view.pendingSide,
    pendingLabel: view.pendingLabel,
    pendingHint: view.pendingHint,
    pendingBadgeClass: view.pendingBadgeClass
  }
}

function getConnectSubmissionsForListing(listingId) {
  if (!listingId) {
    return []
  }
  var profile = getUserProfile()
  var phone = profile ? profile.phone : ""
  var canViewAll = isListingPublisher(listingId)
    || canStaffManageProxyListing(listingId)
    || canStaffViewProxyListingConnects(listingId)
    || isAdminLoggedIn()
  var sourceList = canViewAll ? collectAllConnectCandidates() : getSubmissions()
  return sourceList.filter(function(item) {
    if (item.type !== "connect") {
      return false
    }
    return item.targetId === listingId || item.sourceListingId === listingId
  }).map(function(item) {
    return enrichLinkedConnectItem(item, listingId, phone)
  }).sort(function(a, b) {
    return (b.createdAt || "").localeCompare(a.createdAt || "")
  })
}

function getLinkedConnectPartyTitle(connect, listingId, viewerPhone) {
  var parties = buildConnectPartiesForView(connect, { viewerPhone: viewerPhone || "" })
  var isTargetListing = connect.targetId === listingId
  for (var i = 0; i < parties.length; i += 1) {
    var party = parties[i]
    if (isTargetListing && party.partyRole === "applicant") {
      return party.company ? party.company + " · " + party.title : party.title
    }
    if (!isTargetListing && party.partyRole === "recipient") {
      return party.company ? party.company + " · " + party.title : party.title
    }
  }
  if (isTargetListing) {
    return connect.sourceTitle || connect.targetTitle || "对接申请"
  }
  return connect.targetTitle || connect.sourceTitle || "对接申请"
}

function enrichLinkedConnectItem(connect, listingId, phone) {
  var stageView = getConnectStageView(connect, phone || "")
  var displayStatus = stageView.displayStatus
  var statusLabel = stageView.pendingLabel || displayStatus
  var statusBadgeClass = stageView.pendingLabel
    ? getConnectPendingBadgeClass(stageView.pendingBadgeClass)
    : getRecordStatusBadgeClass(displayStatus)
  return {
    id: connect.id,
    title: getLinkedConnectPartyTitle(connect, listingId, phone),
    displayStatus: displayStatus,
    statusLabel: statusLabel,
    statusBadgeClass: statusBadgeClass,
    relativeTime: formatRelativeTime(connect.createdAt),
    needsAction: stageView.needsAction,
    actionHint: stageView.pendingHint || "",
    pendingLabel: stageView.pendingLabel,
    pendingHint: stageView.pendingHint,
    pendingSide: stageView.pendingSide,
    pendingBadgeClass: stageView.pendingBadgeClass,
    summaryLine: connect.description || getRecordSummaryLine(connect)
  }
}

function getListingLinkedConnectStats(listingId) {
  var connects = getConnectSubmissionsForListing(listingId)
  var pendingCount = connects.filter(function(item) {
    return item.needsAction
  }).length
  return {
    count: connects.length,
    pending: pendingCount,
    connects: connects
  }
}

function getNoticeConnectList() {
  var byId = {}
  var profile = getUserProfile()
  var phone = profile ? profile.phone : ""
  getSubmissions().forEach(function(item) {
    if (item.type === "connect") {
      byId[item.id] = item
    }
  })
  collectAllConnectCandidates().forEach(function(item) {
    if (item.type !== "connect" || byId[item.id]) {
      return
    }
    if (isStaffWorkMode() && phone && getConnectRole(item, phone) === "proxyStaff") {
      byId[item.id] = item
    }
  })
  return Object.keys(byId).map(function(id) {
    return byId[id]
  })
}

function collectConnectNoticeActionItems(phone, options) {
  options = options || {}
  var includeStaffConnectActions = !!options.includeStaffConnectActions
  var includeUserConnectActions = options.includeUserConnectActions !== false
  var actionItems = []
  var seenIds = {}

  function pushAction(item) {
    if (!item || !item.id || seenIds[item.id]) {
      return
    }
    seenIds[item.id] = true
    actionItems.push(item)
  }

  getNoticeConnectList().forEach(function(item) {
    if (item.type !== "connect" || isProxyToProxyConnect(item)) {
      return
    }
    var role = getConnectRole(item, phone)
    if (includeStaffConnectActions && role === "proxyStaff") {
      var staffNotice = getConnectStageView(item, phone).noticeAction
      if (staffNotice) {
        pushAction({
          id: item.id,
          title: getRecordCardTitle(item),
          actionType: staffNotice.actionType,
          actionLabel: staffNotice.actionLabel
        })
      }
      return
    }
    if (!includeUserConnectActions || role === "proxyStaff") {
      return
    }
    var notice = getConnectStageView(item, phone).noticeAction
    if (!notice) {
      return
    }
    pushAction({
      id: item.id,
      title: getRecordCardTitle(item),
      actionType: notice.actionType,
      actionLabel: notice.actionLabel
    })
  })

  return actionItems
}

function getStaffPendingNotice() {
  if (!isStaffUser()) {
    return null
  }
  var profile = getUserProfile()
  var phone = profile ? profile.phone : ""
  var stats = getAdminHubStats()
  var connectItems = collectConnectNoticeActionItems(phone, {
    includeStaffConnectActions: true,
    includeUserConnectActions: false
  })
  var reviewCount = stats.pendingTotal
  var connectCount = connectItems.length
  var totalCount = reviewCount + connectCount
  if (totalCount === 0) {
    return null
  }
  var parts = []
  if (stats.pendingListings > 0) {
    parts.push(stats.pendingListings + " 条公示待审")
  }
  if (stats.pendingCertify > 0) {
    parts.push(stats.pendingCertify + " 条用户认证待审")
  }
  if (stats.pendingBusiness > 0) {
    parts.push(stats.pendingBusiness + " 条商机待审")
  }
  if (stats.pendingProxyConnect > 0) {
    parts.push(stats.pendingProxyConnect + " 条代发对接待审")
  }
  var confirmCount = connectItems.filter(function(item) {
    return item.actionType === "confirm"
  }).length
  var exchangeCount = connectItems.filter(function(item) {
    return item.actionType === "exchange"
  }).length
  if (confirmCount > 0) {
    parts.push(confirmCount + " 条代发商机待同意并发起交换")
  }
  if (exchangeCount > 0) {
    parts.push(exchangeCount + " 条代发商机待确认交换名片")
  }
  var summaryText = parts.length ? parts.join("，") + "，请尽快处理" : "请尽快处理"
  return {
    count: totalCount,
    reviewCount: reviewCount,
    connectCount: connectCount,
    items: connectItems,
    summary: summaryText,
    mode: "staff"
  }
}

function getStaffOpsPendingNotice() {
  return getStaffPendingNotice()
}

function getStaffConnectActionQueue() {
  if (!isStaffUser()) {
    return []
  }
  var profile = getUserProfile()
  var phone = profile ? profile.phone : ""
  return collectConnectNoticeActionItems(phone, {
    includeStaffConnectActions: true,
    includeUserConnectActions: false
  }).map(function(item) {
    var record = getSubmission(item.id)
    return {
      id: item.id,
      title: item.title || (record ? getRecordCardTitle(record) : "对接记录"),
      actionType: item.actionType,
      actionLabel: item.actionLabel,
      statusLabel: item.actionLabel,
      summary: record ? getRecordSummaryLine(record) : "",
      createdAt: record && record.createdAt ? formatRelativeTime(record.createdAt) : ""
    }
  })
}

function getPendingConnectNotice() {
  if (!isUserRegistered()) {
    return null
  }
  if (isStaffUser()) {
    return getStaffPendingNotice()
  }
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return null
  }
  var actionItems = collectConnectNoticeActionItems(profile.phone, {
    includeStaffConnectActions: false,
    includeUserConnectActions: true
  })
  if (!actionItems.length) {
    return null
  }
  var confirmCount = actionItems.filter(function(item) {
    return item.actionType === "confirm"
  }).length
  var exchangeCount = actionItems.filter(function(item) {
    return item.actionType === "exchange"
  }).length
  var progressCount = actionItems.filter(function(item) {
    return item.actionType === "progress"
  }).length
  var parts = []
  if (progressCount > 0) {
    parts.push(progressCount + " 条平台已通过")
  }
  if (confirmCount > 0) {
    parts.push(confirmCount + " 条待同意并发起交换")
  }
  if (exchangeCount > 0) {
    parts.push(exchangeCount + " 条待确认交换名片")
  }
  return {
    count: actionItems.length,
    items: actionItems,
    summary: parts.join("，") + "，请尽快处理以免错过商机"
  }
}

function isPlatformRejectedSubmission(submission) {
  return !!(submission
    && submission.status === "已关闭"
    && submission.reviewResult === "驳回"
    && !submission.cancelledByApplicant)
}

function getSubmissionRejectionNoticeToken(submission) {
  if (!isPlatformRejectedSubmission(submission)) {
    return ""
  }
  var timeline = submission.statusTimeline || []
  for (var i = timeline.length - 1; i >= 0; i -= 1) {
    var entry = timeline[i]
    if (entry && entry.status === "已关闭") {
      return submission.id + "::" + (entry.time || "") + "::" + (entry.hint || "")
    }
  }
  return submission.id + "::" + (submission.updatedAt || submission.createdAt || "")
}

function getRejectionNoticeSeenStore() {
  try {
    return wx.getStorageSync(rejectionNoticeSeenKey) || {}
  } catch (error) {
    return {}
  }
}

function isRejectionNoticeSeen(submission) {
  var token = getSubmissionRejectionNoticeToken(submission)
  if (!token) {
    return true
  }
  return !!getRejectionNoticeSeenStore()[token]
}

function markRejectionNoticeRead(submissionOrId) {
  var submission = typeof submissionOrId === "string"
    ? getSubmission(submissionOrId)
    : submissionOrId
  if (!submission) {
    return
  }
  var token = getSubmissionRejectionNoticeToken(submission)
  if (!token) {
    return
  }
  var store = getRejectionNoticeSeenStore()
  store[token] = Date.now()
  wx.setStorageSync(rejectionNoticeSeenKey, store)
  updateMineTabBadge()
}

function getSubmissionRejectionHint(submission) {
  var timeline = (submission && submission.statusTimeline) || []
  for (var i = timeline.length - 1; i >= 0; i -= 1) {
    var entry = timeline[i]
    if (entry && entry.status === "已关闭" && entry.hint) {
      return entry.hint
    }
  }
  return "未通过平台初审"
}

function collectUnreadRejectionNoticeItems() {
  if (!isUserRegistered() || isStaffUser()) {
    return []
  }
  return getSubmissions().filter(function(item) {
    return isPlatformRejectedSubmission(item) && !isRejectionNoticeSeen(item)
  }).map(function(item) {
    return {
      id: item.id,
      type: item.type,
      typeLabel: getSubmissionTypeLabel(item.type),
      title: getRecordCardTitle(item),
      hint: getSubmissionRejectionHint(item),
      recordUrl: item.type === "certify"
        ? getCertifyRecordUrl(item.id)
        : ("/pages/record/record?id=" + item.id),
      filter: getRecordFilterCategory(item.type)
    }
  })
}

function getPendingRejectionNotice() {
  if (!isUserRegistered() || isStaffUser()) {
    return null
  }
  var items = collectUnreadRejectionNoticeItems()
  if (!items.length) {
    return null
  }
  var summary = items.length === 1
    ? (items[0].title + "：" + items[0].hint)
    : (items.length + " 条申请未通过审核，请查看驳回说明")
  return {
    count: items.length,
    items: items,
    summary: summary,
    mode: "rejection"
  }
}

function getRejectionNoticeNavigateUrl(notice) {
  notice = notice || getPendingRejectionNotice()
  if (!notice || !notice.items || !notice.items.length) {
    return "/pages/records/records?recordStatus=rejected"
  }
  if (notice.items.length === 1) {
    return notice.items[0].recordUrl
  }
  var hasNonCert = notice.items.some(function(item) {
    return item.filter !== "certify"
  })
  if (!hasNonCert) {
    return "/pages/cert-records/cert-records"
  }
  return "/pages/records/records?recordStatus=rejected"
}

function updateMineTabBadge() {
  var count = 0
  var notice = getPendingConnectNotice()
  count += notice && notice.count ? notice.count : 0
  var rejectionNotice = getPendingRejectionNotice()
  count += rejectionNotice && rejectionNotice.count ? rejectionNotice.count : 0
  var tabIndex = 3
  try {
    if (count > 0) {
      wx.setTabBarBadge({
        index: tabIndex,
        text: count > 99 ? "99+" : String(count)
      })
    } else {
      wx.removeTabBarBadge({ index: tabIndex })
    }
  } catch (error) {
    console.warn("更新 Tab 角标失败", error)
  }
}

function switchUserAccount() {
  return logoutUser({ skipCloudRefresh: true })
}

function applyLoggedInProfile(profile, phone) {
  var sanitized = Object.assign({}, profile || {})
  delete sanitized.passwordHash
  delete sanitized.passwordSalt
  wx.setStorageSync(userProfileKey, sanitized)
  userAuth.saveSession(phone || sanitized.phone || "")
  adminModule.syncStaffSessionOnLogin()
}

function clearUserPersonalCache() {
  favorites.clearFavorites()
  clearShareIntent()
  wx.removeStorageSync(viewedResourcesKey)
  wx.removeStorageSync(viewedDemandsKey)
  wx.removeStorageSync(rejectionNoticeSeenKey)
}

function resetLogoutGlobalFlags() {
  try {
    var app = getApp()
    if (!app || !app.globalData) {
      return
    }
    app.globalData.filterIntent = null
    app.globalData.opsReviewTab = null
    app.globalData.opsConnectNeedsRefresh = false
    app.globalData.poolNeedsForceRefresh = true
  } catch (error) {
    // 非页面上下文
  }
}

function logoutUser(options) {
  options = options || {}
  try {
    exitAdminMode()
    userAuth.clearSession()
    clearUserPersonalCache()
    if (isCloudEnabled() && cloudStore.clearCloudLocalCache) {
      cloudStore.clearCloudLocalCache()
    } else {
      clearUserSessionCache()
      resetAllPlatformData()
    }
    markPoolNeedsForceRefresh()
    resetLogoutGlobalFlags()
    updateMineTabBadge()
  } catch (error) {
    console.warn("退出清理本机缓存失败", error)
  }
  if (options.skipCloudRefresh || !isCloudEnabled()) {
    if (isCloudEnabled() && cloudStore.fetchBothPublicListingsSilent) {
      cloudStore.fetchBothPublicListingsSilent()
    }
    return Promise.resolve({ ok: true })
  }
  return refreshAllPublicListings().then(function() {
    return { ok: true }
  }).catch(function(error) {
    return {
      ok: true,
      syncWarning: error && error.message ? error.message : "公开展示池刷新失败"
    }
  })
}

function getStats() {
  var resourceCount = getResources().length
  var demandCount = getDemands().length
  var submissionCount = getSubmissions().length
  var pendingCount = getAdminReviewQueue("all").length
  return [
    { label: "资源条目", value: String(resourceCount) },
    { label: "需求条目", value: String(demandCount) },
    { label: "提交记录", value: String(submissionCount) },
    { label: "待审核", value: String(pendingCount) }
  ]
}

function getBulletins() {
  return bulletins
}

function getProcessSteps() {
  return processSteps
}

function getCategories() {
  return categories
}

function getEnterpriseRegionOptions() {
  return enterpriseRegionOptions.slice()
}

function getEnterpriseRoleOptions() {
  return enterpriseRoleOptions.slice()
}

function getEnterpriseRoleDefault(side) {
  if (side === "supply") {
    return enterpriseRoleDefaults.supply
  }
  return enterpriseRoleDefaults.demand
}

function normalizeEnterpriseRole(role) {
  if (!role) {
    return ""
  }
  var value = String(role).trim()
  if (legacyRoleAliasMap[value]) {
    return legacyRoleAliasMap[value]
  }
  if (enterpriseRoleOptions.indexOf(value) > -1) {
    return value
  }
  return value
}

function isValidEnterpriseRole(role) {
  return enterpriseRoleOptions.indexOf(normalizeEnterpriseRole(role)) > -1
}

function getRegionOptions() {
  return regionFilterOptions.slice()
}

function normalizeEnterpriseRegion(region) {
  if (!region) {
    return ""
  }
  var value = String(region).trim()
  if (legacyRegionAliasMap[value] !== undefined) {
    return legacyRegionAliasMap[value]
  }
  if (enterpriseRegionOptions.indexOf(value) > -1) {
    return value
  }
  return value
}

function isValidEnterpriseRegion(region) {
  return enterpriseRegionOptions.indexOf(normalizeEnterpriseRegion(region)) > -1
}

function validatePublishContactFields(form, options) {
  options = options || {}
  form = form || {}
  if (options.isProxyMode) {
    if (!(form.company || "").trim()) {
      return "请填写客户企业名称"
    }
    if (!(form.contact || "").trim()) {
      return "请填写客户联系人"
    }
    return ""
  }
  if (options.needCompany !== false && !(form.company || "").trim()) {
    return "请填写企业名称"
  }
  if (!(form.contact || "").trim()) {
    return "请填写联系人"
  }
  if (!(form.phone || "").trim()) {
    return "请先完成手机号注册"
  }
  if ((form.region || "").trim() && !isValidEnterpriseRegion(form.region)) {
    return "请重新选择企业所在地"
  }
  if (form.role && !isValidEnterpriseRole(form.role)) {
    return "请重新选择企业角色"
  }
  return ""
}

function countPendingPublishReviews(submissions) {
  submissions = submissions || getSubmissions()
  return submissions.filter(function(item) {
    if (!item || item.type === "certify" || item.type === "connect") {
      return false
    }
    var displayStatus = getSubmissionDisplayStatus(item)
    return item.status === "待审核" || displayStatus === "待审核"
  }).length
}

function getSortOptions() {
  return sortOptions
}

function getPoolSortOptions() {
  return sortOptions.map(function(item) {
    return {
      value: item.value,
      label: item.label,
      shortLabel: item.value === "latest" ? "最新发布" : "完整度"
    }
  })
}

function countPoolDrawerFilters(filters, options) {
  options = options || {}
  var count = 0
  if (filters.activeRegion && filters.activeRegion !== "全部") {
    count++
  }
  if (filters.activeTime && filters.activeTime === "30d") {
    count++
  }
  if (filters.activeDeliveryKind && filters.activeDeliveryKind !== "all") {
    count++
  }
  if (options.includeBrowse && filters.activeBrowse && filters.activeBrowse !== "all") {
    count++
  }
  return count
}

function getPoolCertFilterOptions() {
  return C.poolCertFilterOptions
}

function getPoolTimeFilterOptions() {
  return C.poolTimeFilterOptions
}

function getPoolDeliveryKindFilterOptions() {
  return C.poolDeliveryKindFilterOptions
}

function getPoolFavoriteFilterOptions() {
  return C.poolFavoriteFilterOptions
}

function getResourceBrowseFilterOptions() {
  return C.resourceBrowseFilterOptions
}

function getDemandBrowseFilterOptions() {
  return C.resourceBrowseFilterOptions
}

function getPoolBrowseFilterOptions() {
  return C.resourceBrowseFilterOptions
}

function filterPoolViewItems(items, options) {
  return matching.filterPoolViewItems(items, options)
}

function getListingDisplayCertBadge(item) {
  if (!item) {
    return null
  }
  var level = resolveListingPublisherCertLevel(item)
  if (level !== "license") {
    return null
  }
  if (isStaffProxyListing(item)) {
    return getPublisherCertBadge("license")
  }
  return item.publisherCertBadge || getPublisherCertBadge("license")
}

function getListingProxyBadge(item) {
  if (!item || !isStaffProxyListing(item)) {
    return null
  }
  return {
    text: "平台代发",
    badgeClass: "proxy-publish"
  }
}

function attachListingDisplayBadges(prepared) {
  if (!prepared) {
    return prepared
  }
  return Object.assign({}, prepared, {
    displayProxyBadge: getListingProxyBadge(prepared),
    displayCertBadge: getListingDisplayCertBadge(prepared)
  })
}

function isFavoriteListing(listingId) {
  return favorites.isFavorite(listingId)
}

function toggleFavoriteListing(listingId) {
  if (!listingId) {
    return { ok: false, favorited: false }
  }
  if (!permissions.canFavoriteContent(isUserRegistered())) {
    return { ok: false, needLogin: true, favorited: false }
  }
  var result = favorites.toggleFavorite(listingId)
  if (result.ok && isCloudEnabled() && cloudStore.toggleFavoriteRemote) {
    cloudStore.toggleFavoriteRemote(listingId, result.favorited).catch(function(error) {
      console.warn("收藏同步云端失败", error)
    })
  }
  return result
}

function canShareListingContent() {
  return permissions.canShareContent(isUserRegistered())
}

function getFavoriteIds(pool) {
  return favorites.getFavoriteIds(pool)
}

function getFavoriteCount() {
  return favorites.getFavoriteCount()
}

function promptFavoriteLogin(pool) {
  var poolLabel = pool === "resource" || pool === "resources" ? "资源" : "需求"
  wx.showModal({
    title: "登录后可收藏",
    content: "收藏" + poolLabel + "后可在列表中快速筛选「我的收藏」。",
    confirmText: "去登录",
    cancelText: "取消",
    success: function(res) {
      if (res.confirm) {
        wx.navigateTo({
          url: buildLoginUrl("/pages/" + (poolLabel === "资源" ? "resources" : "demands") + "/" + (poolLabel === "资源" ? "resources" : "demands"))
        })
      }
    }
  })
}

function getSubmitFormPrefill(profile) {
  if (!profile) {
    return {}
  }
  var prefill = {}
  var fields = ["company", "role", "region", "contact", "phone"]
  fields.forEach(function(field) {
    if (profile[field]) {
      prefill[field] = profile[field]
    }
  })
  if (prefill.region) {
    prefill.region = normalizeEnterpriseRegion(prefill.region)
  }
  if (prefill.role) {
    prefill.role = normalizeEnterpriseRole(prefill.role)
  }
  return prefill
}

var _cachedMatchPools = {
  signature: "",
  resource: null,
  demand: null
}

function getMatchPoolCacheSignature() {
  return [
    getPublishedResources().length,
    getPublishedDemands().length,
    getStaffProxyListings().length,
    isStaffUser() ? "staff" : "user"
  ].join(":")
}

function buildBaseMatchCandidatePool(isResourceAnchor) {
  var raw = isResourceAnchor
    ? getPublishedDemands().concat(demands)
    : getPublishedResources().concat(resources)
  if (isStaffUser()) {
    getStaffProxyListings().forEach(function(item) {
      if (!item || !item.id) {
        return
      }
      var isOppositeSide = isResourceAnchor ? !isResource(item.id) : isResource(item.id)
      if (!isOppositeSide) {
        return
      }
      var exists = false
      for (var i = 0; i < raw.length; i += 1) {
        if (raw[i].id === item.id) {
          exists = true
          break
        }
      }
      if (!exists) {
        raw.push(item)
      }
    })
  }
  return matching.attachMatchMetaToListings(
    matching.applyQualityScores(raw.map(hydrateListingProductFields))
  )
}

function filterMatchCandidateListings(items, anchorListingId) {
  anchorListingId = anchorListingId || ""
  var profile = getUserProfile()
  return (items || []).filter(function(item) {
    if (!item || !item.id || isListingClosed(item) || item.id === anchorListingId) {
      return false
    }
    if (!isListingPubliclyVisible(item)) {
      if (!isStaffProxyListing(item) || !profile || !profile.phone || !proxyListingBelongsToStaff(item, profile)) {
        return false
      }
    }
    // 代发商机可参与运营撮合（含代发需求 ↔ 代发资源），不因运营账户下的 isOwnListing 被排除
    if (isStaffProxyListing(item)) {
      return true
    }
    if (isUserRegistered() && isListingPublisher(item.id)) {
      return false
    }
    if (isResource(anchorListingId) && !isResource(item.id)
      && hasConnectForResourceDemandPair(anchorListingId, item.id)) {
      return false
    }
    if (!isResource(anchorListingId) && isResource(item.id)
      && hasConnectForResourceDemandPair(item.id, anchorListingId)) {
      return false
    }
    return true
  })
}

function getMatchCandidatePool(anchorListingId) {
  var isResourceAnchor = isResource(anchorListingId)
  var cacheKey = isResourceAnchor ? "demand" : "resource"
  var signature = getMatchPoolCacheSignature()
  if (_cachedMatchPools.signature !== signature) {
    _cachedMatchPools.signature = signature
    _cachedMatchPools.resource = null
    _cachedMatchPools.demand = null
  }
  if (!_cachedMatchPools[cacheKey]) {
    _cachedMatchPools[cacheKey] = buildBaseMatchCandidatePool(isResourceAnchor)
  }
  var pool = filterMatchCandidateListings(_cachedMatchPools[cacheKey], anchorListingId)
  var anchor = hydrateListingProductFields(getItem(anchorListingId))
  if (anchor) {
    pool = matching.filterPoolByCompatibleListingType(anchor, pool, {
      isSourceResource: isResourceAnchor
    })
  }
  return pool
}

function hydrateListingProductFields(listing) {
  if (!listing) {
    return listing
  }
  if (listing.serverProduct && !matching.isPlaceholderValue(listing.serverProduct)) {
    return listing
  }
  var submission = listing.submissionId ? getSubmission(listing.submissionId) : null
  if (!submission || !submission.serverProduct || matching.isPlaceholderValue(submission.serverProduct)) {
    return listing
  }
  return Object.assign({}, listing, {
    serverProduct: submission.serverProduct
  })
}

function getListingProductSearchKeyword(listingId) {
  var listing = hydrateListingProductFields(getItem(listingId))
  if (!listing) {
    return ""
  }
  return matching.resolveListingProductName(listing)
}

function buildManualMatchSearchHaystack(entry) {
  return matching.buildListingSearchHaystack(entry)
}

function getRelatedMatches(id, limit) {
  var item = hydrateListingProductFields(getItem(id))
  if (!item || isListingClosed(item)) {
    return []
  }
  var pool = getMatchCandidatePool(id)
  return matching.buildRelatedMatches(item, pool, {
    limit: limit || 3,
    minScore: 40,
    isSourceResource: isResource(id)
  }).filter(function(entry) {
    if (!entry || isListingClosed(entry)) {
      return false
    }
    if (isResource(id) && !isResource(entry.id)
      && hasConnectForResourceDemandPair(id, entry.id)) {
      return false
    }
    if (!isResource(id) && isResource(entry.id)
      && hasConnectForResourceDemandPair(entry.id, id)) {
      return false
    }
    return true
  })
}

function getManualMatchPool(listingId, options) {
  options = options || {}
  var keyword = String(options.keyword || "").trim().toLowerCase()
  var limit = options.limit || 50
  var item = hydrateListingProductFields(getItem(listingId))
  if (!item || isListingClosed(item)) {
    return []
  }
  var pool = getMatchCandidatePool(listingId)
  var anchorMeta = matching.buildListingMatchMeta(item)
  var candidatePool = keyword
    ? pool
    : matching.filterPoolByAnchorProductMeta(anchorMeta, pool, {
      maxCandidates: Math.max(limit * 3, 60)
    })
  var filtered = candidatePool.filter(function(entry) {
    if (!entry || !entry.id || isListingClosed(entry) || entry.id === listingId) {
      return false
    }
    if (keyword) {
      if (buildManualMatchSearchHaystack(entry).indexOf(keyword) === -1) {
        return false
      }
    }
    return true
  })
  if (isResource(listingId)) {
    filtered = matching.sortResourceDemandMatchesByProductName(item, filtered)
  } else {
    filtered = matching.sortDemandResourceMatchesByProductName(item, filtered)
  }
  return filtered.slice(0, limit)
}

function buildManualMatchPickerItems(listingId, mode, options) {
  options = options || {}
  var selectedIds = options.selectedIds || []
  var keyword = String(options.keyword || "").trim().toLowerCase()
  if (mode === "ownerDemand") {
    var ownerCandidates = getOwnerDemandMatchResourceCandidates(listingId)
    if (keyword) {
      ownerCandidates = ownerCandidates.filter(function(entry) {
        return buildManualMatchSearchHaystack(entry).indexOf(keyword) > -1
      })
    }
    return enrichOwnerDemandMatchResourceOptions(
      listingId,
      ownerCandidates.slice(0, 50),
      selectedIds
    )
  }
  if (mode === "ownerResource") {
    var ownerResourceCandidates = getOwnerResourceMatchDemandCandidates(listingId)
    if (keyword) {
      ownerResourceCandidates = ownerResourceCandidates.filter(function(entry) {
        return buildManualMatchSearchHaystack(entry).indexOf(keyword) > -1
      })
    }
    return enrichOwnerResourceMatchDemandOptions(
      listingId,
      ownerResourceCandidates.slice(0, 50),
      selectedIds
    )
  }
  if (mode === "viewerDemand") {
    var demandAnchor = hydrateListingProductFields(getItem(listingId))
    var ownResources = getUserActiveResources().filter(function(entry) {
      if (!entry || !entry.id || isListingClosed(entry)) {
        return false
      }
      if (demandAnchor && !matching.isCompatibleListingTypePair(demandAnchor, entry, { isSourceResource: false })) {
        return false
      }
      if (!keyword) {
        return true
      }
      return buildManualMatchSearchHaystack(entry).indexOf(keyword) > -1
    })
    return enrichOwnerDemandMatchResourceOptions(
      listingId,
      prepareResourceListForView(ownResources),
      selectedIds
    )
  }
  if (mode === "viewerResource") {
    var resourceAnchor = hydrateListingProductFields(getItem(listingId))
    var ownDemands = getUserActiveDemands().filter(function(entry) {
      if (!entry || !entry.id || isListingClosed(entry)) {
        return false
      }
      if (resourceAnchor && !matching.isCompatibleListingTypePair(resourceAnchor, entry, { isSourceResource: true })) {
        return false
      }
      if (!keyword) {
        return true
      }
      return buildManualMatchSearchHaystack(entry).indexOf(keyword) > -1
    })
    return enrichViewerResourceMatchDemandOptions(
      listingId,
      prepareDemandListForView(ownDemands),
      selectedIds
    )
  }
  var raw = getManualMatchPool(listingId, options)
  var items = isResource(listingId)
    ? prepareDemandListForView(raw)
    : prepareResourceListForView(raw)
  if (mode === "staffResource" || mode === "ownerResource") {
    return enrichStaffProxyMatchOptions(listingId, items, selectedIds)
  }
  if (mode === "viewerResource") {
    return enrichViewerResourceMatchDemandOptions(listingId, items, selectedIds)
  }
  if (mode === "staffDemand") {
    return enrichStaffProxyMatchResourceOptions(listingId, items, selectedIds)
  }
  return items
}

function getMatchPickerRelatedBundle(listingId, expanded) {
  var defaultLimit = 3
  var fetchLimit = 20
  var allRelated = getRelatedMatches(listingId, fetchLimit)
  return {
    allRelated: allRelated,
    displayRelated: expanded ? allRelated : allRelated.slice(0, defaultLimit),
    total: allRelated.length,
    hasMore: allRelated.length > defaultLimit,
    expanded: !!expanded
  }
}

function sortItems(items, sortBy) {
  return matching.sortItems(items, sortBy)
}

function filterItems(items, options) {
  options = options || {}
  var prepared = items
  if (options.activeCert === "license") {
    prepared = (items || []).map(function(item) {
      if (!item) {
        return item
      }
      var level = resolveListingPublisherCertLevel(item)
      if (level === item.publisherCertLevel) {
        return item
      }
      return Object.assign({}, item, { publisherCertLevel: level })
    })
  }
  return matching.filterItems(prepared, options)
}

function connectInvolvesProxyListing(record, target, source) {
  if (!record || record.type !== "connect" || record.matchedByStaff || record.ownerInitiatedMatch) {
    return false
  }
  target = target || (record.targetId ? getItem(record.targetId) : null)
  source = source || (record.sourceListingId ? getItem(record.sourceListingId) : null)
  return isStaffProxyListing(target) || isStaffProxyListing(source)
}

function enrichConnectSubmission(record) {
  if (!record || record.type !== "connect") {
    return record
  }
  var target = record.targetId ? getItem(record.targetId) : null
  var source = record.sourceListingId ? getItem(record.sourceListingId) : null
  if (target) {
    record.targetOwnerPhone = target.actualOwnerPhone || target.ownerPhone || target.phone
      || getListingOwnerPhone(record.targetId) || record.targetOwnerPhone || ""
  }
  applyConnectProxyNotifyFields(record)
  if (connectInvolvesProxyListing(record, target, source)) {
    if (isProxyToProxyConnect(record)) {
      applyProxyToProxyAutoComplete(record)
    } else {
      record.needsPlatformConnectReview = true
      record.status = "待平台审核"
      record.statusTimeline = [{
        status: "待平台审核",
        time: formatDate(new Date()),
        hint: statusHints["待平台审核"]
      }]
    }
  }
  return record
}

function buildSubmissionRecord(payload) {
  var initialStatus = "待审核"
  var initialHint = statusHints["待审核"]
  if (payload.type === "connect") {
    initialStatus = "待对方确认"
    initialHint = statusHints["待对方确认"]
  }
  return Object.assign({
    id: idFactory.generateSubmissionId(payload.type),
    status: initialStatus,
    createdAt: formatDate(new Date()),
    statusTimeline: [
      {
        status: initialStatus,
        time: formatDate(new Date()),
        hint: initialHint
      }
    ]
  }, payload)
}

function saveSubmission(payload) {
  if (isCloudEnabled()) {
    throw new Error("云端模式请使用 createSubmissionFlowAsync 提交数据")
  }
  const list = wx.getStorageSync(submissionKey) || []
  const record = buildSubmissionRecord(payload)
  list.unshift(record)
  wx.setStorageSync(submissionKey, list)
  return record
}

function maybeApplyStaffSelfProxyPublish(record, listing, submitType) {
  if (!isPublishType(submitType) || !listing || !record) {
    return
  }
  if (!isStaffUser() || record.publishedByStaff || listing.publishedByStaff) {
    return
  }
  var staffProfile = getUserProfile()
  if (!staffProfile || !staffProfile.phone) {
    return
  }
  var ownerPhone = record.phone || staffProfile.phone
  applyProxyPublishFields(listing, record, staffProfile, ownerPhone)
}

function createSubmissionFlowAsync(payload, submitType, form) {
  if (isPublishType(submitType) && isUserPoolPublishBlocked()) {
    return Promise.reject(new Error("运营账户模式下请通过代发管理录入"))
  }
  if (payload.isListingReport && payload.type !== "match") {
    return Promise.reject(new Error("举报提交类型无效"))
  }
  if (isPublishType(submitType) && !isStaffUser() && !hasApprovedBusinessCert()) {
    return Promise.reject(new Error("提交需求/发布资源须先完成名片认证"))
  }
  if ((payload.type === "connect" || payload.type === "match")
    && !payload.isListingReport
    && !isStaffUser()
    && !hasApprovedBusinessCert()) {
    return Promise.reject(new Error("申请对接须先完成名片认证"))
  }
  if (payload.type === "connect" && payload.targetId) {
    var blockingConnect = findBlockingConnectForApply(payload)
    if (blockingConnect) {
      return Promise.reject(new Error(getBlockingConnectApplyMessage(payload, blockingConnect)))
    }
  }
  var record = buildSubmissionRecord(payload)
  if (payload.type === "connect") {
    enrichConnectSubmission(record)
  }
  var listing = null
  if (isPublishType(submitType)) {
    listing = submitType === "resource"
      ? buildResourceListing(form, record.id)
      : buildDemandListing(form, submitType, record.id)
    record.listingId = listing.id
    maybeApplyStaffSelfProxyPublish(record, listing, submitType)
    if (!shouldAutoApproveListing()) {
      record.statusTimeline = record.statusTimeline || []
      record.statusTimeline.push({
        status: "待审核",
        time: formatDate(new Date()),
        hint: form.publicDisplay === false
          ? "已提交，等待平台审核；未开启公开展示，审核通过后不会出现在资源/需求池。"
          : "已提交，等待平台审核；审核通过后才会在资源/需求池公开展示。"
      })
    }
  }

  if (isCloudEnabled()) {
    return cloudStore.createSubmissionRemote(record, listing, {
      autoApproveListing: shouldAutoApproveListing()
    }).then(function(result) {
      var savedRecord = result && (result.submission || result.record) ? (result.submission || result.record) : record
      return {
        record: savedRecord,
        listing: result && result.listing ? result.listing : null
      }
    })
  }

  var list = wx.getStorageSync(submissionKey) || []
  list.unshift(record)
  wx.setStorageSync(submissionKey, list)
  if (listing) {
    var key = submitType === "resource" ? publishedResourcesKey : publishedDemandsKey
    var pool = wx.getStorageSync(key) || []
    pool.unshift(listing)
    wx.setStorageSync(key, pool)
    if (shouldAutoApproveListing()) {
      applyListingApprovalLocal(listing.id, { auto: true })
      record = getSubmission(record.id) || record
      listing = getItem(listing.id) || listing
    }
  }
  return Promise.resolve({
    record: record,
    listing: listing
  })
}

function createProxySubmissionFlowAsync(payload, submitType, form, proxyMeta) {
  proxyMeta = proxyMeta || {}
  var staffProfile = proxyMeta.staffProfile || getUserProfile()
  var clientPhone = String(proxyMeta.clientPhone || payload.phone || "").trim()
  if (!staffProfile || !staffProfile.phone) {
    return Promise.reject(new Error("运营账号信息不完整"))
  }
  if (clientPhone && !/^1\d{10}$/.test(clientPhone)) {
    return Promise.reject(new Error("请填写正确的客户手机号"))
  }

  var record = buildSubmissionRecord(payload)
  var listing = null
  if (isPublishType(submitType)) {
    listing = submitType === "resource"
      ? buildResourceListing(form, record.id)
      : buildDemandListing(form, submitType, record.id)
    record.listingId = listing.id
    if (!shouldAutoApproveListing()) {
      record.statusTimeline = record.statusTimeline || []
      record.statusTimeline.push({
        status: "待审核",
        time: formatDate(new Date()),
        hint: form.publicDisplay === false
          ? "平台运营代发，等待初审；未开启公开展示，通过后不会进入公开展示池。"
          : "平台运营代发，等待初审；通过后进入公开展示池。"
      })
    }
  }
  applyProxyPublishFields(listing, record, staffProfile, clientPhone)

  if (isCloudEnabled()) {
    return cloudStore.createProxySubmissionRemote(record, listing, {
      autoApproveListing: shouldAutoApproveListing(),
      clientPhone: clientPhone,
      staffPhone: staffProfile.phone
    }).then(function(result) {
      return {
        record: result && result.submission ? result.submission : record,
        listing: result && result.listing ? result.listing : listing
      }
    })
  }

  var list = getAllSubmissionsRaw()
  list.unshift(record)
  wx.setStorageSync(submissionKey, list)
  if (listing) {
    var key = submitType === "resource" ? publishedResourcesKey : publishedDemandsKey
    var pool = wx.getStorageSync(key) || []
    pool.unshift(listing)
    wx.setStorageSync(key, pool)
    if (shouldAutoApproveListing()) {
      applyListingApprovalLocal(listing.id, { auto: true })
      record = getSubmission(record.id) || record
      listing = getItem(listing.id) || listing
    }
  }
  return Promise.resolve({
    record: record,
    listing: listing
  })
}

function getAllSubmissionsRaw() {
  return wx.getStorageSync(submissionKey) || []
}

function repairConnectSubmissionsInStorage() {
  var list = getAllSubmissionsRaw()
  var changed = false
  var next = list.map(function(item) {
    if (item.type !== "connect") {
      return item
    }
    var result = repairConnectSubmissionRecord(item)
    if (result.changed) {
      changed = true
      syncStaffGlobalConnectCacheForConnect(result.submission)
      return result.submission
    }
    return item
  })
  if (changed) {
    wx.setStorageSync(submissionKey, next)
  }
  return changed
}

function getSubmissions() {
  repairConnectSubmissionsInStorage()
  var list = getAllSubmissionsRaw()
  if (!userAuth.isLoggedIn()) {
    return []
  }
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return []
  }
  return list.filter(function(item) {
    return submissionBelongsToUser(item, profile)
  })
}

function submissionBelongsToUser(submission, profile) {
  if (!submission || !profile) {
    return false
  }
  var openid = profile.openid || getMyOpenid()
  var phone = profile.phone || ""
  if (submission.type === "connect") {
    if (openid) {
      if (submission.ownerOpenid === openid) {
        return true
      }
      if (submission.applicantProxyStaffOpenid === openid || submission.recipientProxyStaffOpenid === openid) {
        return true
      }
    }
    return !!phone && !!getConnectRole(submission, phone)
  }
  if (isStaffWorkMode()) {
    if (submission.publishedByStaff && phone && submission.proxyStaffPhone === phone) {
      return true
    }
    if (isCloudEnabled() && openid && submission.publishedByStaff
      && submission.proxyStaffOpenid === openid) {
      return true
    }
    return false
  }
  if (submission.publishedByStaff) {
    return false
  }
  if (openid && submission.ownerOpenid === openid) {
    return true
  }
  if (phone && submission.ownerPhone && submission.ownerPhone === phone) {
    return true
  }
  if (phone && submission.phone && submission.phone === phone) {
    return true
  }
  return false
}

function clearUserSessionCache() {
  wx.removeStorageSync(userProfileKey)
  wx.removeStorageSync(submissionKey)
}

/** 登录/注册前清空上一账号的本机缓存，避免同机切换账号后数据串号 */
function clearAccountLocalCacheBeforeAuth() {
  try {
    exitAdminMode()
    userAuth.clearSession()
    clearUserPersonalCache()
    if (isCloudEnabled() && cloudStore.clearCloudLocalCache) {
      cloudStore.clearCloudLocalCache()
    } else {
      clearUserSessionCache()
      resetAllPlatformData()
    }
    markPoolNeedsForceRefresh()
    resetLogoutGlobalFlags()
  } catch (error) {
    console.warn("切换账号清理本机缓存失败", error)
  }
}

function getSubmissionWithoutRebuild(id) {
  if (!id) {
    return null
  }
  var list = getAllSubmissionsRaw()
  for (var i = 0; i < list.length; i += 1) {
    if (list[i].id === id) {
      return list[i]
    }
  }
  if (isCloudEnabled() && isAdminLoggedIn()) {
    var adminList = wx.getStorageSync(adminAllPendingSubmissionsKey) || []
    for (var j = 0; j < adminList.length; j += 1) {
      if (adminList[j].id === id) {
        return adminList[j]
      }
    }
  }
  return null
}

function rebuildProxySubmissionFromListing(listing) {
  if (!listing || !listing.submissionId) {
    return null
  }
  return {
    id: listing.submissionId,
    listingId: listing.id,
    type: isResource(listing.id) ? "resource" : "demand",
    company: listing.clientCompany || "",
    contact: listing.clientContact || "",
    phone: listing.actualOwnerPhone || listing.ownerPhone || "",
    role: listing.clientRole || "",
    clientCompany: listing.clientCompany || "",
    clientContact: listing.clientContact || "",
    clientRole: listing.clientRole || "",
    ownerPhone: listing.ownerPhone || listing.actualOwnerPhone || "",
    actualOwnerPhone: listing.actualOwnerPhone || listing.ownerPhone || "",
    publishedByStaff: true,
    proxyStaffPhone: listing.proxyStaffPhone || "",
    proxyStaffOpenid: listing.proxyStaffOpenid || ""
  }
}

function getSubmission(id) {
  var submission = getSubmissionWithoutRebuild(id)
  if (submission) {
    if (submission.type === "connect") {
      applyConnectProxyNotifyFields(submission)
      var repairResult = repairConnectSubmissionRecord(submission)
      if (repairResult.changed) {
        var list = getAllSubmissionsRaw()
        var repairIndex = -1
        for (var ri = 0; ri < list.length; ri += 1) {
          if (list[ri].id === id) {
            repairIndex = ri
            break
          }
        }
        if (repairIndex > -1) {
          list[repairIndex] = repairResult.submission
          wx.setStorageSync(submissionKey, list)
        }
        syncStaffGlobalConnectCacheForConnect(repairResult.submission)
        return repairResult.submission
      }
    }
    return submission
  }
  if (isCloudEnabled() && isStaffWorkMode()) {
    var proxyListings = (wx.getStorageSync(publishedResourcesKey) || [])
      .concat(wx.getStorageSync(publishedDemandsKey) || [])
    for (var k = 0; k < proxyListings.length; k += 1) {
      var listing = proxyListings[k]
      if (!listing || listing.submissionId !== id || !isStaffProxyListing(listing)) {
        continue
      }
      if (!canStaffManageProxyListing(listing.id)) {
        continue
      }
      return rebuildProxySubmissionFromListing(listing)
    }
  }
  return null
}

function getStatusHint(status) {
  return statusHints[status] || "平台正在跟进这条商机。"
}

var disclaimerVersion = require("../legalContent").disclaimerVersion

var connectSuccessRiskItems = [
  "平台仅协助商机对接与信息展示，不参与线下签约、资金往来及交付履约，不对双方交易结果作任何担保。",
  "请自行核实对方企业资质、资源真实性与商务条款，线下沟通前建议留存书面记录。",
  "警惕虚假承诺、诱导转账、冒名对接等行为；如有异常请及时向平台反馈并保留证据。"
]

function getConnectSuccessRiskNotice() {
  return {
    title: "风险提示",
    items: connectSuccessRiskItems.slice()
  }
}

function canViewSubmissionRecord(submission, profile) {
  if (!submission) {
    return false
  }
  if (profile && profile.phone && submissionBelongsToUser(submission, profile)) {
    return true
  }
  if (isStaffUser() && isAdminLoggedIn()) {
    var adminList = wx.getStorageSync(adminAllPendingSubmissionsKey) || []
    for (var i = 0; i < adminList.length; i += 1) {
      if (adminList[i].id === submission.id) {
        return true
      }
    }
  }
  return false
}

function canViewConnectDisclosedContacts(submission, viewerPhone) {
  if (!submission || submission.type !== "connect") {
    return false
  }
  if (!isUserRegistered()) {
    return false
  }
  var profile = getUserProfile()
  var phone = viewerPhone || (profile ? profile.phone : "")
  if (!phone || !canViewSubmissionRecord(submission, profile)) {
    return false
  }
  if (!getConnectRole(submission, phone)) {
    return false
  }
  return !!(submission.disclosedContacts || submission.status === "已交换名片")
}

function getConnectDisclosedPartyViews(submission, viewerPhone) {
  if (!canViewConnectDisclosedContacts(submission, viewerPhone)) {
    return null
  }
  var contacts = submission.disclosedContacts || buildConnectDisclosedContacts(submission)
  if (!contacts) {
    return null
  }
  var isResourceConnect = isResourceToDemandConnect(submission)
  if (isResourceConnect) {
    return {
      demand: contacts.recipient,
      resource: contacts.applicant
    }
  }
  return {
    demand: contacts.applicant,
    resource: contacts.recipient
  }
}

function getListingReportStore() {
  try {
    return wx.getStorageSync(listingReportsKey) || {}
  } catch (error) {
    return {}
  }
}

function hasUserReportedListingLocal(listingId, phone) {
  if (!listingId || !phone) {
    return false
  }
  return !!getListingReportStore()[phone + "::" + listingId]
}

function markUserReportedListingLocal(listingId, phone) {
  if (!listingId || !phone) {
    return
  }
  var store = getListingReportStore()
  store[phone + "::" + listingId] = Date.now()
  wx.setStorageSync(listingReportsKey, store)
}

function hasPendingListingReport(listingId, phone) {
  if (!listingId || !phone) {
    return false
  }
  if (hasUserReportedListingLocal(listingId, phone)) {
    return true
  }
  return getSubmissions().some(function(item) {
    return !!(item
      && item.isListingReport
      && item.reportListingId === listingId
      && (item.phone === phone || item.ownerPhone === phone)
      && item.status !== "已关闭"
      && item.reviewResult !== "驳回")
  })
}

function getConnectSuccessNextSteps(submission, disclosedPartyViews, viewerPhone) {
  if (!disclosedPartyViews || !canViewConnectDisclosedContacts(submission, viewerPhone)) {
    return []
  }
  var profile = getUserProfile()
  var myPhone = viewerPhone || (profile ? profile.phone : "")
  var steps = []
  var demandPhone = disclosedPartyViews.demand && disclosedPartyViews.demand.phone
  var resourcePhone = disclosedPartyViews.resource && disclosedPartyViews.resource.phone
  if (demandPhone && demandPhone !== myPhone) {
    steps.push({
      key: "call-demand",
      icon: "📞",
      title: "联系需求方",
      hint: disclosedPartyViews.demand.company || "需求方",
      phone: demandPhone,
      action: "call"
    })
  }
  if (resourcePhone && resourcePhone !== myPhone) {
    steps.push({
      key: "call-resource",
      icon: "📞",
      title: "联系资源方",
      hint: disclosedPartyViews.resource.company || "资源方",
      phone: resourcePhone,
      action: "call"
    })
  }
  steps.push({
    key: "copy-both",
    icon: "📋",
    title: "复制双方联系方式",
    hint: "便于记录到企业微信或邮件",
    action: "copyAll"
  })
  steps.push({
    key: "follow-records",
    icon: "📁",
    title: "查看我的对接记录",
    hint: "后续可在记录中回看本次对接",
    action: "records"
  })
  return steps
}

function getHomeIntentCategories() {
  var config = require("../config")
  if (config.enableHomeIntentShortcuts === false) {
    return []
  }
  return (categories || []).map(function(item) {
    return {
      name: item.name,
      icon: item.icon,
      action: item.action,
      pool: item.pool || "",
      filterType: item.action === "filter"
        ? (item.filterType !== undefined ? item.filterType : (item.type || ""))
        : "",
      listingType: item.listingType || "",
      submitType: item.action === "submit"
        ? (item.submitType || item.type || "resource")
        : ""
    }
  })
}

function buildHomeFeaturedCard(item) {
  if (!item || !item.id) {
    return null
  }
  var isRes = isResource(item.id)
  var layout = buildListingViewLayout(item, isRes)
  return {
    id: item.id,
    isResource: isRes,
    poolLabel: isRes ? "资源" : "需求",
    title: item.title || "",
    type: item.type || "",
    poolFacts: layout.poolFacts || [],
    poolTimeLabel: item.poolTimeLabel || buildPoolTimeLabel(item),
    certBadge: item.publisherCertLevel === "license"
      ? "执照认证"
      : (item.publisherCertLevel === "card" ? "名片认证" : "")
  }
}

function getHomeFeaturedListings(limit) {
  var config = require("../config")
  var maxItems = limit
  if (maxItems === undefined || maxItems === null) {
    maxItems = config.homeFeaturedLimit
  }
  maxItems = Number(maxItems)
  if (!maxItems || maxItems <= 0) {
    return []
  }
  var merged = getResources().concat(getDemands()).filter(function(item) {
    return item && item.id && !isListingClosed(item)
  })
  merged.sort(function(a, b) {
    var scoreDiff = (b.matchScore || 0) - (a.matchScore || 0)
    if (scoreDiff !== 0) {
      return scoreDiff
    }
    return (b.publishedAt || b.createdAt || "").localeCompare(a.publishedAt || a.createdAt || "")
  })
  return merged.slice(0, maxItems).map(buildHomeFeaturedCard).filter(Boolean)
}

function getListingVerificationView(listing, isResourceSide) {
  if (!listing) {
    return null
  }
  var certLevel = listing.publisherCertLevel || ""
  var certLabel = certLevel === "license"
    ? "营业执照认证"
    : (certLevel === "card" ? "名片认证" : "未认证")
  var verification = listing.verification || "已发布"
  var rows = [
    { label: "平台状态", value: verification === "待审核" ? "审核中" : (verification === "已关闭" ? "已下架" : "已公示") },
    { label: "认证等级", value: certLabel }
  ]
  if (listing.publishedAt) {
    rows.push({ label: "上架时间", value: listing.publishedAt })
  }
  if (listing.publishedByStaff) {
    rows.push({ label: "录入方式", value: "平台代发" })
  }
  return {
    title: "平台核验",
    rows: rows
  }
}

var listingReportReasons = [
  "信息虚假或夸大",
  "重复发布/垃圾信息",
  "涉嫌欺诈或冒名",
  "联系方式无效",
  "其他违规"
]

function getListingReportReasonOptions() {
  return listingReportReasons.slice()
}

function submitListingReportAsync(listingId, reason, detail) {
  if (!isUserRegistered()) {
    return Promise.reject(new Error("请先登录后再举报"))
  }
  if (isStaffUser()) {
    return Promise.reject(new Error("运营账号不可提交举报"))
  }
  var listing = getItem(listingId)
  if (!listing || isListingClosed(listing)) {
    return Promise.reject(new Error("商机不存在或已下架"))
  }
  if (isListingPublisher(listingId)) {
    return Promise.reject(new Error("不能举报自己发布的商机"))
  }
  var profile = getUserProfile()
  var reasonText = String(reason || "").trim()
  if (!reasonText) {
    return Promise.reject(new Error("请选择举报原因"))
  }
  if (listingReportReasons.indexOf(reasonText) === -1) {
    return Promise.reject(new Error("举报原因无效"))
  }
  if (hasPendingListingReport(listingId, profile.phone)) {
    return Promise.reject(new Error("您已举报过该商机"))
  }
  var payload = {
    type: "match",
    title: "商机举报：" + (listing.title || listingId),
    description: [
      "举报类型：商机举报",
      "举报商机：" + listingId,
      "商机标题：" + (listing.title || ""),
      "举报原因：" + reasonText,
      detail ? ("补充说明：" + String(detail).trim()) : ""
    ].filter(Boolean).join("\n"),
    phone: profile.phone || "",
    company: profile.company || "",
    contact: profile.contact || "",
    reportListingId: listingId,
    reportReason: reasonText,
    isListingReport: true
  }
  if (isCloudEnabled()) {
    return cloudStore.createSubmissionRemote(buildSubmissionRecord(payload), null, {
      autoApproveListing: false
    }).then(function(result) {
      var saved = result && (result.submission || result.record) ? (result.submission || result.record) : buildSubmissionRecord(payload)
      var list = wx.getStorageSync(submissionKey) || []
      list.unshift(saved)
      wx.setStorageSync(submissionKey, list)
      markUserReportedListingLocal(listingId, profile.phone)
      return saved
    })
  }
  return Promise.resolve(saveSubmission(payload)).then(function(saved) {
    markUserReportedListingLocal(listingId, profile.phone)
    return saved
  })
}

function getSubmissionRejectionResubmitGuide(submission) {
  if (!isPlatformRejectedSubmission(submission)) {
    return null
  }
  var hint = getSubmissionRejectionHint(submission)
  var tips = [
    "请根据驳回说明修改信息后重新提交",
    "确保企业名称、联系方式与认证材料一致",
    "资源/需求描述尽量写清型号、规模、交期与预算"
  ]
  var action = null
  var actionText = ""
  if (submission.type === "resource") {
    action = "submitResource"
    actionText = "重新发布资源"
  } else if (isDemandSubmitType(submission.type)) {
    action = "submitDemand"
    actionText = submission.type === "server" ? "重新提交整机需求" : (submission.type === "room" ? "重新提交项目需求" : "重新提交需求")
  } else if (submission.type === "certify") {
    action = "certify"
    actionText = "重新提交认证"
  }
  return {
    title: "审核未通过",
    hint: hint,
    tips: tips,
    action: action,
    actionText: actionText
  }
}

function isUserRegistered() {
  if (!userAuth.isLoggedIn()) {
    return false
  }
  var profile = getUserProfile()
  if (!profile) {
    return false
  }
  if (!profile.disclaimerAccepted) {
    return false
  }
  if (!profile.phone) {
    return false
  }
  if (!profile.phoneVerified) {
    return false
  }
  if (profile.registered === true || profile.registeredAt) {
    return true
  }
  return false
}

function hasFullProfile() {
  var profile = getUserProfile()
  if (!profile) {
    return false
  }
  return !!(profile.company && profile.contact)
}

var certLevelOptions = [
  {
    value: "card",
    title: "名片认证",
    subtitle: "上传个人名片，快速完成基础认证",
    badge: "名片认证",
    badgeShort: "名片",
    badgeClass: "cert-card",
    listBadgeClass: "publisher-card",
    pendingText: "名片认证审核中",
    verifiedText: "名片认证",
    verifiedHint: "已完成名片认证，可申请对接真实商机",
    uploadLabel: "上传个人名片",
    uploadTip: "请上传清晰的个人名片照片，需包含姓名、企业与联系方式",
    imageField: "cardImage",
    requiresCreditCode: false,
    requiresRegionRole: false,
    benefits: [
      "申请对接真实商机",
      "展示名片认证标签"
    ]
  },
  {
    value: "license",
    title: "营业执照认证",
    subtitle: "上传营业执照，获得最高等级企业认证",
    badge: "营业执照认证",
    badgeShort: "执照",
    badgeClass: "cert-license",
    listBadgeClass: "publisher-license",
    pendingText: "营业执照认证审核中",
    verifiedText: "营业执照认证",
    verifiedHint: "已完成营业执照认证，获得优先推荐与企业信任标签",
    uploadLabel: "上传营业执照",
    uploadTip: "请上传清晰的营业执照照片，信息需与填写企业名称一致",
    imageField: "licenseImage",
    requiresCreditCode: true,
    requiresRegionRole: true,
    benefits: [
      "资源池/需求池优先推荐",
      "展示营业执照认证标签",
      "撮合经理优先跟进对接"
    ]
  }
]

function getCertLevelOptions() {
  return certLevelOptions
}

function getCertLevelConfig(level) {
  for (var i = 0; i < certLevelOptions.length; i += 1) {
    if (certLevelOptions[i].value === level) {
      return certLevelOptions[i]
    }
  }
  return certLevelOptions[0]
}

function isCloudMediaId(url) {
  return !!(cloudStore && cloudStore.isCloudFileId && cloudStore.isCloudFileId(url))
}

function isLocalCertImagePath(url) {
  return !!(cloudStore && cloudStore.isLocalMediaPath && cloudStore.isLocalMediaPath(url))
}

function validateCertImagesForSubmit(form, certLevel) {
  if (!isCloudEnabled()) {
    return { ok: true }
  }
  var imagePath = certLevel === "license" ? form.licenseImage : form.cardImage
  if (!imagePath) {
    return { ok: false, message: "请上传认证材料" }
  }
  if (isLocalCertImagePath(imagePath)) {
    return {
      ok: false,
      message: "认证图片未上传至云端，请重新选择图片并等待上传完成后再提交"
    }
  }
  if (!isCloudMediaId(imagePath)) {
    return {
      ok: false,
      message: "认证图片格式异常，请重新上传"
    }
  }
  return { ok: true }
}

function saveCertImage(tempFilePath, certType) {
  if (isCloudEnabled() && cloudStore.uploadCertImage) {
    return cloudStore.uploadCertImage(tempFilePath, certType)
  }
  return new Promise(function(resolve, reject) {
    if (!tempFilePath) {
      reject(new Error("未选择图片"))
      return
    }
    var fs = wx.getFileSystemManager()
    var ext = tempFilePath.indexOf(".png") > -1 ? "png" : "jpg"
    var basePath = wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : ""
    if (!basePath) {
      resolve(tempFilePath)
      return
    }
    var filePath = basePath + "/cert_" + certType + "_" + Date.now() + "." + ext
    fs.saveFile({
      tempFilePath: tempFilePath,
      filePath: filePath,
      success: function(res) {
        resolve(res.savedFilePath || filePath)
      },
      fail: function() {
        resolve(tempFilePath)
      }
    })
  })
}

function isCertApproved(cert) {
  return !!(cert && (cert.status === "已认证" || cert.status === "已推荐" || cert.status === "已发布"))
}

function isCertPending(cert) {
  if (!cert) {
    return false
  }
  var status = cert.status || ""
  return status === "待审核" || status === "认证中" || status === "待跟进"
}

/** 该认证申请是否已满足（已通过或账号已具备同级认证），无需再进运营待审/个人待办 */
function isCertAlreadySatisfiedForSubmission(submission) {
  if (!submission || submission.type !== "certify") {
    return false
  }
  var local = getSubmissionWithoutRebuild(submission.id)
  if (local && isCertApproved(local)) {
    return true
  }
  if (!isCertPending(submission)) {
    return true
  }
  var level = submission.certLevel || "card"
  var phone = submission.ownerPhone || submission.phone || ""
  if (!phone) {
    return false
  }
  var approvedBySubmissions = getApprovedCertLevelForPhone(phone)
  if (approvedBySubmissions === "license" || (level === "card" && approvedBySubmissions === "card")) {
    return true
  }
  var profile = getUserProfile()
  if (profile && profile.phone === phone && profile.certStatus === "verified") {
    if (profile.certLevel === "license" || (level === "card" && profile.certLevel === "card")) {
      return true
    }
  }
  return false
}

function isCertReviewStillNeeded(submission) {
  if (!submission || submission.type !== "certify") {
    return true
  }
  return !isCertAlreadySatisfiedForSubmission(submission)
}

function hasPendingCertApplication(options) {
  options = options || {}
  if (getApprovedCertLevel()) {
    return false
  }
  var certs = getCertifySubmissions()
  for (var i = 0; i < certs.length; i++) {
    if (!isCertPending(certs[i])) {
      continue
    }
    if (!isCertReviewStillNeeded(certs[i])) {
      continue
    }
    if (options.level && certs[i].certLevel !== options.level) {
      continue
    }
    return true
  }
  if (certs.length === 0) {
    var profile = getUserProfile()
    if (profile && profile.certStatus === "pending" && !getApprovedCertLevel()) {
      return true
    }
    return false
  }
  return false
}

function getLatestCertSubmission() {
  var certs = getSubmissions().filter(function(item) {
    return item.type === "certify"
  })
  if (certs.length === 0) {
    return null
  }
  certs.sort(function(a, b) {
    return (b.createdAt || "").localeCompare(a.createdAt || "")
  })
  for (var i = 0; i < certs.length; i += 1) {
    if (isCertPending(certs[i]) && isCertReviewStillNeeded(certs[i])) {
      return certs[i]
    }
  }
  var approved = certs.filter(function(item) {
    return isCertApproved(item)
  })
  if (approved.length > 0) {
    var licenseCert = null
    for (var j = 0; j < approved.length; j += 1) {
      if (approved[j].certLevel === "license") {
        licenseCert = approved[j]
        break
      }
    }
    return licenseCert || approved[0]
  }
  return certs[0]
}

function getUserCertLevel() {
  return getApprovedCertLevel()
}

function getPublisherCertBadge(level) {
  if (!level) {
    return null
  }
  var config = getCertLevelConfig(level)
  return {
    level: level,
    text: config.badgeShort,
    fullText: config.badge,
    badgeClass: config.listBadgeClass
  }
}

function isCertifiedUser() {
  return !!getUserCertLevel()
}

function getUserAccessLevel() {
  if (!isUserRegistered()) {
    return "guest"
  }
  var certLevel = getUserCertLevel()
  if (certLevel === "license") {
    return "verified"
  }
  if (certLevel === "card") {
    return "standard"
  }
  return "basic"
}

function hasLicenseCertification() {
  return getUserCertLevel() === "license"
}

function canViewResourceAttachments(options) {
  options = options || {}
  return permissions.canViewResourceAttachmentsForListing({
    isStaffProxyView: options.isStaffProxyView,
    isPublisher: options.isPublisher || options.isListingPublisher || options.isOwnListing,
    isListingPublisher: options.isListingPublisher || options.isPublisher || options.isOwnListing,
    hasLicenseCert: hasLicenseCertification()
  })
}

function getListingAttachments(item, options) {
  if (!item || !item.submissionId) {
    return {
      hasAttachments: false,
      canView: false,
      attachments: []
    }
  }
  var submission = getSubmission(item.submissionId)
  var rawAttachments = submission && submission.attachments ? submission.attachments : []
  var canView = canViewResourceAttachments(options)
  return {
    hasAttachments: rawAttachments.length > 0,
    canView: canView,
    attachments: canView ? rawAttachments : []
  }
}

function promptLicenseCertification() {
  var cert = getLatestCertSubmission()
  var pending = isCertPending(cert) && cert && cert.certLevel === "license"
  wx.showModal({
    title: pending ? "营业执照认证审核中" : "需完成营业执照认证",
    content: pending
      ? "你的营业执照认证正在审核，通过后即可查看资源附件。"
      : "查看资源附件需先完成营业执照认证，审核通过后即可查看。",
    confirmText: pending ? "查看进度" : "去认证",
    cancelText: "取消",
    success: function(res) {
      if (res.confirm) {
        var url = pending ? getCertifyPageUrl() : "/pages/certify/certify?level=license"
        wx.navigateTo({ url: url })
      }
    }
  })
}

function canViewFullListing() {
  return isUserRegistered()
}

function hasApprovedBusinessCert() {
  if (!isUserRegistered()) {
    return false
  }
  var certLevel = getUserCertLevel()
  return certLevel === "card" || certLevel === "license"
}

function canApplyConnect() {
  if (isStaffUser()) {
    return false
  }
  return isUserRegistered() && hasApprovedBusinessCert()
}

function promptStaffCannotApplyConnect() {
  wx.showModal({
    title: "运营账号无法申请对接",
    content: "运营账号不能以个人身份申请对接。请通过代发管理替客户发起匹配，或让客户使用普通账号登录后操作。",
    confirmText: "去代发管理",
    cancelText: "知道了",
    success: function(res) {
      if (res.confirm) {
        wx.navigateTo({
          url: "/pages/ops-proxy/ops-proxy",
          fail: function() {
            wx.switchTab({ url: "/pages/mine/mine" })
          }
        })
      }
    }
  })
}

function requiresCardCertification(type) {
  return certGate.requiresBusinessCert(certGate.submitTypeToCertAction(type))
}

function getCertGateActionLabel(type) {
  if (type === "connect") {
    return "申请对接"
  }
  if (type === "match") {
    return "申请人工撮合"
  }
  if (type === "resource") {
    return "发布资源"
  }
  return "提交需求"
}

function canSubmitListing() {
  return hasApprovedBusinessCert()
}

function isDemandSubmitType(type) {
  return type === "demand" || type === "server" || type === "room"
}

function getListingCertGateTitle(type, pending) {
  if (pending) {
    return "名片认证审核中"
  }
  return getCertGateActionLabel(type || "demand") === "发布资源"
    ? "发布资源需名片认证"
    : "提交需求需名片认证"
}

function getListingCertGateContent(type, pending) {
  type = type || "demand"
  var actionLabel = getCertGateActionLabel(type)
  if (pending) {
    return "平台将在 1-3 个工作日内完成审核，审核通过后即可" + actionLabel + "。"
  }
  return "首次" + actionLabel + "须先完成名片认证（约 1-3 个工作日审核）。"
}

/** 发布需求/资源时的名片认证门禁文案（含审核中状态） */
function getListingCertGateCopy(type) {
  type = type || "demand"
  var pending = hasPendingCertApplication()
  var actionLabel = getCertGateActionLabel(type)
  if (pending) {
    return {
      pending: true,
      bannerTitle: "名片认证审核中",
      bannerText: "平台将在 1-3 个工作日内完成审核。审核通过后即可" + actionLabel + "。",
      actionText: "查看认证进度",
      submitText: "认证审核中，查看进度"
    }
  }
  return {
    pending: false,
    bannerTitle: "请先完成名片认证",
    bannerText: getListingCertGateContent(type, false),
    actionText: "去认证",
    submitText: "先完成名片认证"
  }
}

function ensureConnectAccess(options) {
  options = options || {}
  if (isStaffUser()) {
    promptStaffCannotApplyConnect()
    return false
  }
  if (!isUserRegistered()) {
    promptRegistration(options)
    return false
  }
  if (!hasApprovedBusinessCert()) {
    promptBusinessCertification(Object.assign({
      action: certGate.CertAction.CONNECT
    }, options))
    return false
  }
  return true
}

function ensureMatchAccess(options) {
  options = options || {}
  if (isStaffUser()) {
    promptStaffCannotApplyConnect()
    return false
  }
  if (!isUserRegistered()) {
    promptRegistration(options)
    return false
  }
  if (!hasApprovedBusinessCert()) {
    promptBusinessCertification(Object.assign({
      action: certGate.CertAction.MATCH
    }, options))
    return false
  }
  return true
}

function isUserPoolPublishBlocked() {
  return isStaffUser()
}

function promptStaffUseProxyPublish(options) {
  options = options || {}
  wx.showModal({
    title: "请使用代发录入",
    content: "运营账号不能在资源池/需求池以个人身份发布。请进入「运营工作台 → 代发管理」替客户录入。",
    confirmText: "去代发管理",
    cancelText: "知道了",
    success: function(res) {
      if (res.confirm) {
        wx.navigateTo({
          url: options.redirect || "/pages/ops-proxy/ops-proxy",
          fail: function() {
            wx.switchTab({ url: "/pages/mine/mine" })
          }
        })
      }
    }
  })
}

function ensureSubmitListingAccess(type, options) {
  if (certGate.isListingPublishType(type) && isUserPoolPublishBlocked()) {
    promptStaffUseProxyPublish(options)
    return false
  }
  if (!certGate.requiresBusinessCert(certGate.submitTypeToCertAction(type))) {
    return true
  }
  if (!isUserRegistered()) {
    return false
  }
  if (canSubmitListing()) {
    return true
  }
  promptBusinessCertification(Object.assign({
    action: certGate.CertAction.SUBMIT_LISTING,
    listingType: type
  }, options || {}))
  return false
}

function promptBusinessCertification(options) {
  options = options || {}
  var action = certGate.normalizeCertAction(options)
  if (!certGate.canPromptBusinessCert(action)) {
    return false
  }
  if (hasApprovedBusinessCert()) {
    return false
  }
  var now = Date.now()
  if (promptBusinessCertification._lastShownAt && now - promptBusinessCertification._lastShownAt < 800) {
    return false
  }
  promptBusinessCertification._lastShownAt = now
  var cert = getLatestCertSubmission()
  var pending = isCertPending(cert)
  var hasRedirect = !!options.redirect
  var isListingGate = action === certGate.CertAction.SUBMIT_LISTING
  var listingType = options.listingType || "demand"
  var actionLabel = getCertGateActionLabel(
    isListingGate
      ? listingType
      : (action === certGate.CertAction.MATCH ? "match" : (action === certGate.CertAction.CONNECT ? "connect" : "demand"))
  )
  var title = isListingGate
    ? getListingCertGateTitle(listingType, pending)
    : (pending ? "企业认证审核中" : "请先完成企业认证")
  var content = isListingGate
    ? getListingCertGateContent(listingType, pending)
    : (pending
      ? "平台将在 1-3 个工作日内完成审核，通过后即可" + actionLabel + "。"
      : "首次" + actionLabel + "须先完成企业认证（约 1-3 个工作日审核）。请先完成认证后再继续。")
  var cancelText = hasRedirect
    ? (pending ? "知道了" : "稍后再说")
    : "取消"
  wx.showModal({
    title: title,
    content: content,
    confirmText: pending ? "查看进度" : "去认证",
    cancelText: cancelText,
    success: function(res) {
      if (res.confirm) {
        if (pending) {
          var pendingCert = getPendingCertSubmission() || cert
          if (pendingCert && pendingCert.id) {
            wx.navigateTo({ url: getCertifyRecordUrl(pendingCert.id) })
          } else {
            wx.navigateTo({ url: "/pages/cert-records/cert-records" })
          }
        } else {
          wx.navigateTo({
            url: getCertifyPageUrl(options.redirect)
          })
        }
      }
      if (typeof options.onDismiss === "function") {
        options.onDismiss(res)
      }
    }
  })
  return true
}

/** @deprecated 请使用 ensureSubmitListingAccess / ensureConnectAccess / promptBusinessCertification */
function promptCardCertification(options) {
  options = options || {}
  var action = certGate.normalizeCertAction(options)
  return promptBusinessCertification(Object.assign({}, options, {
    action: action || certGate.CertAction.SUBMIT_LISTING
  }))
}

function getMatchPercent(score) {
  return matching.getMatchPercent(score)
}

function enrichListingForDisplay(item) {
  if (!item) {
    return item
  }
  var pct = getMatchPercent(item.matchScore)
  var patch = { poolTimeLabel: buildPoolTimeLabel(item) }
  if (isResource(item.id)) {
    patch.type = C.normalizeResourceType(item.type)
  } else if (item.id && item.id.indexOf("UDEM-") === 0) {
    patch.type = C.normalizeDemandType(item.type)
  } else if (item.id && item.id.indexOf("DEM-") === 0) {
    patch.type = C.normalizeDemandType(item.type)
  }
  var displayType = patch.type || item.type
  if (isServerListingType(displayType) && item.scale && !isPlaceholderValue(item.scale)) {
    patch.scale = normalizeListingScaleForServer(item.scale, displayType)
  }
  if (isResource(item.id) && isServerListingType(displayType)) {
    patch.title = resolveServerResourceDisplayTitle(Object.assign({}, item, patch, { type: displayType }))
  } else if (item.id && !isResource(item.id)) {
    patch.title = resolveDemandDisplayTitle(Object.assign({}, item, patch, { type: displayType }))
  }
  if (pct !== null) {
    patch.matchPercent = pct
  }
  return Object.assign({}, item, patch)
}

function getUserLevelBadge() {
  var level = getUserAccessLevel()
  if (level === "guest") {
    return { text: "访客", badgeClass: "guest" }
  }
  if (level === "verified") {
    var cert = getUserCertSummary()
    return {
      text: "已认证 · " + (cert.role || "企业用户"),
      badgeClass: "verified"
    }
  }
  if (level === "standard") {
    return { text: "已登录 · 名片认证", badgeClass: "logged" }
  }
  if (hasFullProfile()) {
    return { text: "已登录 · 资料已完善", badgeClass: "logged" }
  }
  return { text: "已登录 · 资料待完善", badgeClass: "logged" }
}

function getUserPermissions() {
  return permissions.buildPermissionRows(getUserAccessLevel())
}

function getMineBusinessSummary() {
  var submissions = getSubmissions()
  if (!submissions.length) {
    return "需求、资源、对接等全部记录"
  }
  var demandCount = 0
  var resourceCount = 0
  var connectCount = 0
  var pendingCount = 0
  var exchangedCount = 0
  submissions.forEach(function(item) {
    if (item.type === "demand" || item.type === "server" || item.type === "room") {
      demandCount += 1
    }
    if (item.type === "resource") {
      resourceCount += 1
    }
    if (item.type === "connect") {
      connectCount += 1
      if (item.status === "已交换名片") {
        exchangedCount += 1
      }
    }
    if (item.status === "待审核") {
      pendingCount += 1
    }
  })
  var parts = []
  if (demandCount > 0) {
    parts.push("需求 " + demandCount)
  }
  if (resourceCount > 0) {
    parts.push("资源 " + resourceCount)
  }
  if (connectCount > 0) {
    parts.push("对接 " + connectCount)
  }
  if (exchangedCount > 0) {
    parts.push("已交换名片 " + exchangedCount)
  }
  if (pendingCount > 0) {
    parts.push("待审 " + pendingCount)
  }
  if (!parts.length) {
    return "需求、资源、对接等全部记录"
  }
  return parts.join(" · ")
}

function getMineCertBadgeClass(status) {
  if (status === "license_verified" || status === "card_verified") {
    return "done"
  }
  if (status === "pending") {
    return "pending"
  }
  if (status === "rejected") {
    return "rejected"
  }
  return status || "none"
}

function getListingVerifySteps(item, isResource) {
  if (!item) {
    return []
  }
  var steps = isResource
    ? ["已发布", "平台初审", "资源核验", "可对接"]
    : ["已发布", "平台审核", "可对接"]
  var status = item.verification || "待审核"
  var doneCount = 1
  var currentIndex = 1
  if (status === "待审核") {
    doneCount = 1
    currentIndex = 1
  } else if (status.indexOf("初审") > -1 || status.indexOf("已初审") > -1) {
    doneCount = isResource ? 2 : 2
    currentIndex = isResource ? 2 : 2
  } else if (status === "已关闭") {
    doneCount = 1
    currentIndex = 1
  } else {
    doneCount = steps.length - 1
    currentIndex = steps.length - 1
  }
  return steps.map(function(label, index) {
    var state = "pending"
    if (index < doneCount) {
      state = "done"
    } else if (index === currentIndex) {
      state = "current"
    }
    return {
      label: label,
      state: state,
      dotText: state === "done" ? "✓" : String(index + 1)
    }
  })
}

function findViewerConnectForListing(listingId) {
  var profile = getUserProfile()
  if (!profile || !profile.phone || !listingId) {
    return null
  }
  var phone = profile.phone
  var matches = getSubmissions().filter(function(item) {
    if (item.type !== "connect") {
      return false
    }
    if (item.targetId !== listingId && item.sourceListingId !== listingId) {
      return false
    }
    return !!getConnectRole(item, phone)
  })
  for (var i = 0; i < matches.length; i += 1) {
    if (isActiveConnectSubmission(matches[i])) {
      return matches[i]
    }
  }
  return null
}

function isAuthorizedConnectParty(listingId) {
  var connect = findViewerConnectForListing(listingId)
  if (!connect) {
    return false
  }
  if (connect.status === "待平台审核") {
    return false
  }
  if (!isActiveConnectSubmission(connect)) {
    return false
  }
  return true
}

function isPlatformAdminUser() {
  return adminModule.isPlatformAdminUser()
}

function isStaffListingOversight(listingId, options) {
  options = options || {}
  if (!isStaffUser() || !isStaffWorkMode()) {
    return false
  }
  if (options.fromShare || isShareDetailLanding(listingId, options)) {
    return false
  }
  return true
}

function isPlatformAdminPublisherOversight(listingId, options) {
  return isPlatformAdminResourcePublisherOversight(listingId, options)
}

function isPlatformAdminResourcePublisherOversight(listingId, options) {
  return isStaffPublisherOversight(listingId, options) && isPlatformAdminUser()
}

/** 运营账号（非分享落地）在公开展示池浏览时的监管上下文（不含发布方隐私） */
function isStaffPublisherOversight(listingId, options) {
  options = options || {}
  if (!isStaffListingOversight(listingId, options)) {
    return false
  }
  if (!listingId) {
    return false
  }
  var listing = getItem(listingId)
  if (listing && isStaffProxyListing(listing)) {
    return false
  }
  return true
}

function canViewListingPublisherInfo(listingId, options) {
  options = options || {}
  if (!listingId) {
    return false
  }
  if (!userAuth.isLoggedIn()) {
    return false
  }
  var listing = getItem(listingId)
  var isPublisher = !!(options.isListingPublisher || isListingPublisher(listingId))
  var platformAdminOversight = (options.forPlatformAdmin || options.forAdmin)
    && isPlatformAdminPublisherOversight(listingId, options)
  var deps = {
    isGuest: !isUserRegistered(),
    isLoggedIn: userAuth.isLoggedIn(),
    isPublisher: isPublisher,
    isStaffProxyView: !!(options.isStaffProxyView || canStaffManageProxyListing(listingId)),
    isPlatformAdmin: isPlatformAdminUser(),
    platformAdminOversight: platformAdminOversight,
    isAuthorizedConnectParty: isAuthorizedConnectParty(listingId)
  }
  if (!permissions.canShowPublisherBlockOnDetail(deps)) {
    return false
  }
  if (listing && isStaffProxyListing(listing) && !isPublisher && !deps.isAuthorizedConnectParty && !platformAdminOversight) {
    return false
  }
  return true
}

function canViewResourcePublisherName(listingId, options) {
  return canViewListingPublisherInfo(listingId, options)
}

function buildResourcePoolMeta(item, showPublisher) {
  var parts = []
  if (showPublisher && item.maskedCompany) {
    parts.push(item.maskedCompany)
  }
  if (item.region) {
    parts.push(item.region)
  }
  if (item.scale) {
    parts.push(item.scale)
  }
  return parts.join(" · ")
}

var LISTING_SUMMARY_LABELS = { "需求说明": true, "资源描述": true, "补充说明": true }
var LISTING_TYPE_LABELS = { "需求类型": true, "资源类型": true }
var LISTING_METRIC_FIELD_LABELS = {
  "企业所在地": true,
  "交货地址": true,
  "需求规模": true,
  "资源规模": true,
  "采购台数": true,
  "可供应台数": true,
  "数量": true,
  "预算范围": true,
  "预算": true,
  "价格说明": true,
  "报价": true,
  "期望开始": true,
  "期望交货": true,
  "租期/周期": true,
  "交货周期": true,
  "交期": true,
  "地点": true
}

function getListingRegionLabel(item) {
  if (item && (isServerListingType(item.type) || isPartsListingType(item.type))) {
    return isPartsListingType(item.type) ? "地点" : "地点"
  }
  return "企业所在地"
}

function getListingScaleLabel(item, isResource) {
  if (item && (isServerListingType(item.type) || isPartsListingType(item.type))) {
    return "数量"
  }
  return isResource ? "资源规模" : "需求规模"
}

function getListingMoneyLabel(isResource, item) {
  if (item && (isServerListingType(item.type) || isPartsListingType(item.type))) {
    return isResource ? "报价" : "预算"
  }
  return isResource ? "价格说明" : "预算范围"
}

function getListingCycleLabel(item, isResource) {
  if (item && (isServerListingType(item.type) || isPartsListingType(item.type))) {
    return "交期"
  }
  if (isResource) {
    return "租期/周期"
  }
  return "期望开始"
}

function getListingScaleIcon(item) {
  if (item && (isServerListingType(item.type) || isPartsListingType(item.type))) {
    return "📦"
  }
  return "📐"
}

function buildServerListingDetailRows(item, isResource, options) {
  options = options || {}
  if (!item || (!isServerListingType(item.type) && !isPartsListingType(item.type))) {
    return []
  }
  var rows = []
  if (item.details && item.details.length) {
    rows = item.details.slice()
  } else {
    var legacyForm = {
      listingType: item.type,
      serverProduct: item.serverProduct || "",
      specModel: item.specModel || "",
      configSpec: item.configSpec || "",
      configDetail: item.configDetail || "",
      warranty: item.warranty || "",
      scale: isServerListingType(item.type)
        ? normalizeListingScaleForServer(item.scale || "", "算力整机")
        : (item.scale || ""),
      price: item.price || "",
      budget: item.budget || "",
      deliveryTime: item.cycle || "",
      startTime: item.cycle || "",
      procurementRegion: item.region || "",
      region: item.region || "",
      serverPayment: item.serverPayment || "",
      serverProcess: item.serverProcess || "",
      serverBrand: item.serverBrand || "",
      description: item.summary || "",
      role: ""
    }
    rows = isResource
      ? buildResourceDetails(legacyForm)
      : buildDemandDetails(legacyForm, item.type)
  }
  return rows.filter(function(row) {
    if (!row || !row.value || matching.isPlaceholderValue(row.value)) {
      return false
    }
    if (!options.includePublisherSpecFields && listingSanitize.LISTING_PUBLISHER_SENSITIVE_SPEC_LABELS[row.label]) {
      return false
    }
    if (LISTING_TYPE_LABELS[row.label]) {
      return false
    }
    if (row.label === "企业角色") {
      return false
    }
    return true
  }).map(function(row) {
    return { label: row.label, value: row.value }
  })
}

function buildListingKeyMetrics(item, isResource) {
  if (!item) {
    return []
  }
  if (isServerListingType(item.type)) {
    var serverMetrics = []
    if (item.scale && !matching.isPlaceholderValue(item.scale)) {
      serverMetrics.push({ label: getListingScaleLabel(item, isResource), value: item.scale, icon: getListingScaleIcon(item) })
    }
    var serverMoney = isResource ? item.price : item.budget
    if (serverMoney && !matching.isPlaceholderValue(serverMoney)) {
      serverMetrics.push({ label: getListingMoneyLabel(isResource, item), value: serverMoney, icon: "💰" })
    }
    if (item.cycle && !matching.isPlaceholderValue(item.cycle)) {
      serverMetrics.push({ label: getListingCycleLabel(item, isResource), value: item.cycle, icon: "⏱" })
    } else if (item.region && !matching.isPlaceholderValue(item.region)) {
      serverMetrics.push({ label: getListingRegionLabel(item), value: item.region, icon: "📍" })
    }
    return serverMetrics.slice(0, 3)
  }
  if (isPartsListingType(item.type)) {
    var partsMetrics = []
    if (item.scale && !matching.isPlaceholderValue(item.scale)) {
      partsMetrics.push({ label: getListingScaleLabel(item, isResource), value: item.scale, icon: getListingScaleIcon(item) })
    }
    var partsMoney = isResource ? item.price : item.budget
    if (partsMoney && !matching.isPlaceholderValue(partsMoney)) {
      partsMetrics.push({ label: getListingMoneyLabel(isResource, item), value: partsMoney, icon: "💰" })
    }
    if (item.cycle && !matching.isPlaceholderValue(item.cycle)) {
      partsMetrics.push({ label: getListingCycleLabel(item, isResource), value: item.cycle, icon: "⏱" })
    } else if (item.region && !matching.isPlaceholderValue(item.region)) {
      partsMetrics.push({ label: getListingRegionLabel(item), value: item.region, icon: "📍" })
    }
    return partsMetrics.slice(0, 3)
  }
  var metrics = []
  if (item.region && !matching.isPlaceholderValue(item.region)) {
    metrics.push({ label: getListingRegionLabel(item), value: item.region, icon: "📍" })
  }
  if (item.scale && !matching.isPlaceholderValue(item.scale)) {
    metrics.push({ label: getListingScaleLabel(item, isResource), value: item.scale, icon: getListingScaleIcon(item) })
  }
  var money = isResource ? item.price : item.budget
  if (money && !matching.isPlaceholderValue(money)) {
    metrics.push({ label: getListingMoneyLabel(isResource, item), value: money, icon: "💰" })
  } else if (item.cycle && !matching.isPlaceholderValue(item.cycle)) {
    metrics.push({ label: getListingCycleLabel(item, isResource), value: item.cycle, icon: "⏱" })
  }
  return metrics.slice(0, 3)
}

function buildPoolFacts(item, options) {
  options = options || {}
  return buildListingKeyMetrics(item, !!options.isResource).map(function(metric) {
    return { icon: metric.icon, text: metric.value, label: metric.label }
  })
}

function buildListingSpecRows(item, isResource, options) {
  options = options || {}
  if (!item || !item.details || !item.details.length) {
    return []
  }
  var skipLabels = {}
  buildListingKeyMetrics(item, isResource).forEach(function(metric) {
    skipLabels[metric.label] = true
  })
  Object.keys(LISTING_METRIC_FIELD_LABELS).forEach(function(label) {
    skipLabels[label] = true
  })
  skipLabels["企业所在地"] = true
  skipLabels["交货地址"] = true
  if (isServerListingType(item.type) || isPartsListingType(item.type)) {
    skipLabels["交付方式"] = true
    skipLabels["配置说明"] = true
    skipLabels["配置要求"] = true
    skipLabels["可供应台数"] = true
    skipLabels["采购台数"] = true
    skipLabels["价格说明"] = true
    skipLabels["预算范围"] = true
    skipLabels["期望交货"] = true
    skipLabels["交货周期"] = true
    skipLabels["配件名称"] = true
    skipLabels["规格型号"] = true
  }
  return item.details.filter(function(row) {
    if (!row || !row.value || matching.isPlaceholderValue(row.value)) {
      return false
    }
    if (!options.includePublisherSpecFields && listingSanitize.LISTING_PUBLISHER_SENSITIVE_SPEC_LABELS[row.label]) {
      return false
    }
    if (LISTING_TYPE_LABELS[row.label]) {
      return false
    }
    if (LISTING_SUMMARY_LABELS[row.label]) {
      return false
    }
    if (skipLabels[row.label]) {
      return false
    }
    return true
  }).map(function(row) {
    return { label: row.label, value: row.value }
  })
}

function getListingSummaryFromDetails(item) {
  if (!item || !item.details || !item.details.length) {
    return ""
  }
  var labels = ["需求说明", "资源描述", "补充说明"]
  for (var i = 0; i < item.details.length; i += 1) {
    var row = item.details[i]
    if (!row || labels.indexOf(row.label) < 0) {
      continue
    }
    var value = String(row.value || "").trim()
    if (value && !matching.isPlaceholderValue(value)) {
      return value
    }
  }
  return ""
}

function resolveListingSummaryForDetail(item) {
  if (!item) {
    return ""
  }
  var fromDetails = getListingSummaryFromDetails(item)
  if (fromDetails) {
    return fromDetails
  }
  var summary = String(item.summary || "").trim()
  if (item.submissionId) {
    var submission = getSubmission(item.submissionId)
    var subDesc = submission && String(submission.description || "").trim()
    if (subDesc && (!summary || subDesc.length > summary.length)) {
      return subDesc
    }
  }
  return summary
}

function extractListingHeroSummary(specRows, item, summaryLine) {
  if (summaryLine) {
    return summaryLine
  }
  var poolSummary = buildPoolSummaryLine(item, 120)
  if (poolSummary) {
    return poolSummary
  }
  var remarkLabels = ["备注", "需求说明", "资源描述", "补充说明"]
  for (var i = 0; i < (specRows || []).length; i += 1) {
    var row = specRows[i]
    if (row && remarkLabels.indexOf(row.label) > -1 && row.value && !matching.isPlaceholderValue(row.value)) {
      return row.value
    }
  }
  return ""
}

function normalizeListingCompareText(text) {
  return String(text || "")
    .replace(/[\s，,、。；;：:【】\[\]()（）\-·]/g, "")
    .toLowerCase()
}

function isSimilarListingText(a, b) {
  var na = normalizeListingCompareText(a)
  var nb = normalizeListingCompareText(b)
  if (!na || !nb) {
    return false
  }
  if (na === nb) {
    return true
  }
  var shorter = na.length < nb.length ? na : nb
  var longer = na.length < nb.length ? nb : na
  if (longer.indexOf(shorter) > -1 && shorter.length >= 4) {
    return longer.length - shorter.length <= Math.max(8, shorter.length * 0.35)
  }
  return false
}

function collectListingKnownDisplayTexts(item, specRows) {
  var texts = []
  function push(val) {
    var value = String(val || "").trim()
    if (value && !matching.isPlaceholderValue(value)) {
      texts.push(value)
    }
  }
  if (!item) {
    return texts
  }
  push(item.title)
  push(item.summary)
  push(item.scale)
  push(item.price)
  push(item.budget)
  push(item.cycle)
  push(item.region)
  push(item.serverProduct)
  push(item.specModel)
  ;(specRows || []).forEach(function(row) {
    push(row && row.value)
  })
  return texts
}

function isDeliveryKindTag(tag) {
  var value = String(tag || "").trim()
  if (!value) {
    return false
  }
  var options = C.poolDeliveryKindFilterOptions || []
  for (var i = 0; i < options.length; i += 1) {
    if (options[i] && options[i].value === value) {
      return true
    }
  }
  return false
}

function enrichSpecRowsWithDeliveryKindTag(specRows, item) {
  if (!specRows || !specRows.length || !item) {
    return specRows
  }
  var fallbackKind = String(item.deliveryKind || "").trim() || getServerDeliveryKind(item.cycle)
  if (!fallbackKind) {
    return specRows
  }
  return specRows.map(function(row) {
    if (!row || row.label !== "交期") {
      return row
    }
    var parsed = parseServerDeliveryTime(row.value)
    var kind = parsed.deliveryKind || fallbackKind
    var detail = parsed.deliveryTimeDetail
    if (!detail && parsed.deliveryKind) {
      detail = parsed.deliveryKind === String(row.value || "").trim() ? "" : String(row.value || "").trim()
    } else if (!parsed.deliveryKind) {
      detail = String(row.value || "").trim()
      if (detail === kind) {
        detail = ""
      }
    }
    return Object.assign({}, row, {
      value: detail,
      deliveryKindTag: kind
    })
  })
}

function filterRedundantDisplayTags(tags, item, specRows) {
  var known = collectListingKnownDisplayTexts(item, specRows)
  return (tags || []).filter(function(tag) {
    if (!tag) {
      return false
    }
    for (var i = 0; i < known.length; i += 1) {
      if (isSimilarListingText(tag, known[i])) {
        return false
      }
    }
    return true
  })
}

function resolveDetailHeroSummary(item, specRows, summaryLine, options) {
  options = options || {}
  var heroSummary = extractListingHeroSummary(specRows, item, summaryLine)
  if (!heroSummary || !options.forDetail) {
    return heroSummary
  }
  var known = collectListingKnownDisplayTexts(item, specRows)
  for (var i = 0; i < known.length; i += 1) {
    if (isSimilarListingText(heroSummary, known[i])) {
      return ""
    }
  }
  return heroSummary
}

function buildListingViewLayout(item, isResource, options) {
  options = options || {}
  if (!item) {
    return {
      layoutMode: "general",
      poolFacts: [],
      keyMetrics: [],
      specRows: [],
      displayTags: [],
      summaryLine: "",
      heroSummary: "",
      poolSummaryLine: "",
      heroSectionTitle: "整体说明",
      hideHeroTime: false,
      specSectionTitle: "补充信息"
    }
  }
  var isServerListing = isServerListingType(item.type)
  var isPartsListing = isPartsListingType(item.type)
  var isStructuredListing = isServerListing || isPartsListing
  var forDetail = !!options.forDetail
  var layoutMode = isStructuredListing && forDetail ? "structured" : "general"
  var keyMetrics = buildListingKeyMetrics(item, isResource)
  var specRows = isStructuredListing
    ? buildServerListingDetailRows(item, isResource, options)
    : buildListingSpecRows(item, isResource, options)
  var displayTags = getResourcePoolDisplayTags(item)
  if (forDetail) {
    displayTags = filterRedundantDisplayTags(displayTags, item, specRows)
  }
  var summaryLine = resolveListingSummaryForDetail(item)
  if (isStructuredListing && specRows.length > 0) {
    summaryLine = ""
  }
  var heroSummary = resolveDetailHeroSummary(item, specRows, summaryLine, options)
  var displaySpecRows = heroSummary
    ? specRows.filter(function(row) {
      var remarkLabels = ["备注", "需求说明", "资源描述", "补充说明"]
      return !(row && remarkLabels.indexOf(row.label) > -1 && row.value === heroSummary)
    })
    : specRows
  if (forDetail && isStructuredListing) {
    displayTags = displayTags.filter(function(tag) {
      return !isDeliveryKindTag(tag)
    })
    if (isResource) {
      displaySpecRows = enrichSpecRowsWithDeliveryKindTag(displaySpecRows, item)
    }
  }
  var poolFacts = layoutMode === "structured"
    ? []
    : buildPoolFacts(item, { isResource: isResource })
  return {
    layoutMode: layoutMode,
    poolFacts: poolFacts,
    keyMetrics: layoutMode === "structured" ? [] : keyMetrics,
    specRows: displaySpecRows,
    displayTags: displayTags,
    summaryLine: summaryLine,
    heroSummary: heroSummary,
    poolSummaryLine: buildPoolSummaryLine(item, 40),
    heroSectionTitle: forDetail ? "商机概览" : "整体说明",
    hideHeroTime: forDetail,
    specSectionTitle: isServerListing ? (isResource ? "算力整机明细" : "需求明细") : (isPartsListing ? "配件明细" : "补充信息")
  }
}

function buildPoolSummaryLine(item, maxLen) {
  maxLen = maxLen || 52
  var text = (item.summary || "").trim()
  if (!text) {
    return ""
  }
  if (text.length > maxLen) {
    return text.slice(0, maxLen) + "..."
  }
  return text
}

function buildListingPublicCopyText(item, isResource, options) {
  options = options || {}
  if (!item) {
    return ""
  }
  var listingId = options.listingId || item.id || ""
  var layout = buildListingViewLayout(item, isResource, {
    includePublisherSpecFields: false,
    forDetail: true
  })
  var lines = []
  var sideLabel = isResource ? "资源" : "需求"
  var headline = "【" + sideLabel + "】" + (item.type || "商机")
  if (item.title) {
    headline += " · " + item.title
  }
  lines.push(headline)
  if (listingId) {
    lines.push("编号：" + listingId)
  }
  if (layout.poolFacts && layout.poolFacts.length) {
    layout.poolFacts.forEach(function(fact) {
      if (!fact || !fact.text) {
        return
      }
      lines.push((fact.label || "") + (fact.label ? "：" : "") + fact.text)
    })
  } else if (layout.keyMetrics && layout.keyMetrics.length) {
    layout.keyMetrics.forEach(function(metric) {
      if (metric && metric.label && metric.value) {
        lines.push(metric.label + "：" + metric.value)
      }
    })
  }
  if (layout.displayTags && layout.displayTags.length) {
    lines.push("标签：" + layout.displayTags.join("、"))
  }
  if (layout.heroSummary) {
    lines.push(layout.heroSummary)
  }
  var specRows = listingSanitize.filterPublisherSensitiveDetailRows(layout.specRows || [])
  specRows.forEach(function(row) {
    if (!row || !row.value) {
      return
    }
    var value = row.deliveryKindTag
      ? (row.deliveryKindTag + (row.value ? " " + row.value : ""))
      : row.value
    lines.push(row.label + "：" + value)
  })
  var poolTimeLabel = fmt.formatBeijingDateTime(resolveListingDisplayTime(item))
  if (poolTimeLabel) {
    lines.push("发布时间：" + poolTimeLabel)
  }
  return lines.join("\n").trim()
}

function buildPoolTimeLabel(item) {
  var displayTime = resolveListingDisplayTime(item)
  if (!displayTime) {
    return "近期"
  }
  var relative = fmt.formatRelativeTime(displayTime)
  if (relative && relative.indexOf("刚刚") > -1) {
    return "刚刚"
  }
  if (relative && relative.indexOf("前") > -1) {
    return relative
  }
  if (relative && relative.length <= 12) {
    return relative
  }
  return String(displayTime).slice(0, 10)
}

function resolveListingDisplayTime(item) {
  if (!item) {
    return ""
  }
  if (item.submissionId) {
    var submission = getSubmission(item.submissionId)
    if (submission && submission.statusTimeline && submission.statusTimeline.length) {
      for (var i = submission.statusTimeline.length - 1; i >= 0; i -= 1) {
        var entry = submission.statusTimeline[i]
        if (entry && entry.status === "已发布" && entry.time) {
          return entry.time
        }
      }
    }
  }
  var publishedAt = item.publishedAt || ""
  if (publishedAt && !fmt.isDateOnlyString(publishedAt)) {
    return publishedAt
  }
  if (item.submissionId) {
    var publishedSubmission = getSubmission(item.submissionId)
    if (publishedSubmission && publishedSubmission.createdAt) {
      return publishedSubmission.createdAt
    }
  }
  if (item.createdAt) {
    return item.createdAt
  }
  return publishedAt
}

function countActivePoolFilters(filters, options) {
  options = options || {}
  var count = 0
  if (filters.activeRegion && filters.activeRegion !== "全部") {
    count++
  }
  if (filters.activeCert && filters.activeCert !== "all") {
    count++
  }
  if (filters.activeTime && filters.activeTime !== "all") {
    count++
  }
  if (filters.activeFavorite && filters.activeFavorite !== "all") {
    count++
  }
  if (options.includeBrowse && filters.activeBrowse && filters.activeBrowse !== "all") {
    count++
  }
  return count
}

function getListingPublisherInfo(item, options) {
  options = options || {}
  if (!item || !userAuth.isLoggedIn()) {
    return null
  }
  if (options.isStaffProxyView || canStaffManageProxyListing(item.id)) {
    return null
  }
  var isListingResource = isResource(item.id)
  var isPublisher = !!(options.isListingPublisher || isListingPublisher(item.id))
  var canShowPublisher = canViewListingPublisherInfo(item.id, Object.assign({}, options, {
    isListingPublisher: isPublisher
  }))
  if (!canShowPublisher) {
    return null
  }
  var platformAdminOversight = (options.forPlatformAdmin || options.forAdmin)
    && isPlatformAdminPublisherOversight(item.id, options)
  if (isStaffProxyListing(item) && !isPublisher && !isAuthorizedConnectParty(item.id) && !platformAdminOversight) {
    return null
  }
  var party = options.partyOverride || getListingPartyProfile(item)
  if (isStaffProxyListing(item) && !party.company && !party.contact && !party.phone) {
    return null
  }
  var connect = findViewerConnectForListing(item.id)
  var exchanged = !!(connect && isConnectContactsExchanged(connect))
  var showFullContact = permissions.canShowPublisherFullContact({
    isPublisher: isPublisher,
    isPlatformAdmin: isPlatformAdminUser(),
    platformAdminOversight: platformAdminOversight,
    contactsExchanged: exchanged
  })
  if (isStaffProxyListing(item) && !platformAdminOversight) {
    showFullContact = isPublisher || exchanged
  }
  var company = party.company || (isListingResource ? "认证资源方" : "认证需求方")
  if (!party.company) {
    company = "已登记企业"
  }
  if (!showFullContact) {
    company = item.maskedCompany || fmt.maskCompany(party.company) || company
    if (company && party.company && company === party.company) {
      company = item.maskedCompany || fmt.maskCompany(party.company) || "已登记企业"
    }
  }
  var contact = showFullContact ? (party.contact || "") : ""
  var phoneDisplay = showFullContact ? (party.phone || "") : ""
  var avatarText = company ? company.slice(0, 1) : (isListingResource ? "资" : "需")
  var intro = ""
  if (showFullContact) {
    var submission = item.submissionId ? getSubmission(item.submissionId) : null
    if (submission && submission.description) {
      intro = submission.description
    } else if (item.summary) {
      intro = item.summary
    }
    if (intro.length > 72) {
      intro = intro.slice(0, 72) + "..."
    }
  }
  return {
    company: company,
    contact: contact,
    maskedPhone: phoneDisplay,
    phoneDisplay: phoneDisplay,
    contactRevealed: showFullContact && !isPublisher,
    avatarText: avatarText,
    intro: intro,
    badge: getListingDisplayCertBadge(item),
    publisherMasked: !showFullContact
  }
}

function shouldFetchStaffListingPublisher(item, options) {
  options = options || {}
  if (!item || !item.id || !isCloudEnabled()) {
    return false
  }
  return isPlatformAdminPublisherOversight(item.id, options)
}

function shouldFetchPlatformAdminResourcePublisher(item, options) {
  return shouldFetchStaffListingPublisher(item, options)
}

function publisherInfoNeedsCloudFetch(publisherInfo) {
  if (!publisherInfo) {
    return true
  }
  if (publisherInfo.publisherMasked) {
    return true
  }
  var company = String(publisherInfo.company || "").trim()
  if (!company || company === "已登记企业" || company === "认证资源方" || company === "认证需求方") {
    return true
  }
  if (company.indexOf("*") >= 0) {
    return true
  }
  return !publisherInfo.contact && !publisherInfo.phoneDisplay
}

function fetchStaffListingPublisherInfoAsync(listingId, options) {
  options = options || {}
  if (!listingId || !isCloudEnabled() || !cloudStore.fetchStaffListingPublisherInfoRemote) {
    return Promise.resolve(null)
  }
  if (!isPlatformAdminPublisherOversight(listingId, options)) {
    return Promise.resolve(null)
  }
  return cloudStore.fetchStaffListingPublisherInfoRemote(listingId).then(function(result) {
    if (!result || !result.data || !result.data.publisher) {
      return null
    }
    var item = getItem(listingId)
    if (!item) {
      item = { id: listingId }
    }
    var party = result.data.publisher
    var publisherInfo = getListingPublisherInfo(item, Object.assign({}, options, {
      partyOverride: party,
      forPlatformAdmin: true
    }))
    if (publisherInfo && result.data.description && !publisherInfo.intro) {
      var intro = String(result.data.description || "").trim()
      if (intro.length > 72) {
        intro = intro.slice(0, 72) + "..."
      }
      publisherInfo.intro = intro
    }
    return publisherInfo
  }).catch(function(error) {
    console.warn("拉取发布方企业信息失败", error)
    return null
  })
}

function fetchPlatformAdminResourcePublisherInfoAsync(listingId, options) {
  return fetchStaffListingPublisherInfoAsync(listingId, options)
}

function getListingInfoGrid(item, isResource) {
  if (!item) {
    return []
  }
  if (item.details && item.details.length > 0) {
    return item.details.map(function(row) {
      if (!row || !row.value || isPlaceholderValue(row.value)) {
        return null
      }
      return { label: row.label, value: row.value }
    }).filter(Boolean)
  }
  var grid = []
  pushDetailRow(grid, isResource ? "资源类型" : "需求类型", item.type)
  pushDetailRow(grid, getListingRegionLabel(item), item.city || item.region)
  pushDetailRow(grid, getListingScaleLabel(item, isResource), item.scale)
  if (isResource) {
    pushDetailRow(grid, getListingCycleLabel(item, isResource), item.cycle)
    pushDetailRow(grid, getListingMoneyLabel(true, item), item.price)
  } else {
    pushDetailRow(grid, getListingMoneyLabel(false, item), item.budget)
    pushDetailRow(grid, getListingCycleLabel(item, isResource), item.cycle)
  }
  pushDetailRow(grid, "场景", item.scene)
  return grid.filter(function(row) {
    return row.value
  })
}

function getConnectFlowTimeline(record, viewerPhone) {
  if (!record || record.type !== "connect") {
    return []
  }
  return getConnectStageView(record, viewerPhone).flowTimeline
}

function getPasswordStrength(password) {
  if (!password) {
    return { text: "", width: 0, level: 0 }
  }
  var score = 0
  if (password.length >= userAuth.MIN_PASSWORD_LEN) {
    score += 1
  }
  if (password.length >= 10) {
    score += 1
  }
  if (/[A-Za-z]/.test(password) && /\d/.test(password)) {
    score += 1
  }
  if (/[^A-Za-z0-9]/.test(password)) {
    score += 1
  }
  var presets = [
    { text: "密码过短", width: 20, level: 1 },
    { text: "弱 · 至少 " + userAuth.MIN_PASSWORD_LEN + " 位且含字母与数字", width: 33, level: 1 },
    { text: "中等 · 建议 10 位以上", width: 66, level: 2 },
    { text: "强", width: 100, level: 3 }
  ]
  return presets[Math.min(score, presets.length - 1)]
}

function parseSubmissionDate(createdAt) {
  if (!createdAt) {
    return null
  }
  var normalized = String(createdAt).replace(/-/g, "/")
  var date = new Date(normalized)
  return isNaN(date.getTime()) ? null : date
}

function formatRelativeTime(createdAt) {
  var date = parseSubmissionDate(createdAt)
  if (!date) {
    return createdAt || ""
  }
  var diffMs = Date.now() - date.getTime()
  if (diffMs < 60 * 1000) {
    return "刚刚"
  }
  var minutes = Math.floor(diffMs / (60 * 1000))
  if (minutes < 60) {
    return minutes + " 分钟前"
  }
  var hours = Math.floor(diffMs / (60 * 60 * 1000))
  if (hours < 24) {
    return hours + " 小时前"
  }
  var days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  if (days < 7) {
    return days + " 天前"
  }
  return createdAt.split(" ")[0] || createdAt
}

function getRecordFilterCategory(type) {
  if (type === "connect") {
    return "connect"
  }
  if (type === "resource") {
    return "resource"
  }
  if (type === "certify") {
    return "certify"
  }
  if (isDemandSubmitType(type) || type === "match") {
    return "demand"
  }
  return "other"
}

function getMineCategoryStats() {
  var submissions = getSubmissions()
  var profile = getUserProfile()
  var viewerPhone = profile ? profile.phone : ""
  var stats = {
    connect: { count: 0, pending: 0, actionPending: 0 },
    resource: { count: 0, pending: 0, active: 0 },
    demand: { count: 0, pending: 0, active: 0 },
    certify: { count: 0, pending: 0 }
  }
  submissions.forEach(function(item) {
    var category = getRecordFilterCategory(item.type)
    if (!stats[category]) {
      return
    }
    stats[category].count += 1
    if (category === "connect") {
      var stageView = getConnectStageView(item, viewerPhone)
      if (stageView.isInProgress) {
        stats.connect.pending += 1
      }
      return
    }
    var displayStatus = getSubmissionDisplayStatus(item)
    if (displayStatus === "待审核" || displayStatus === "认证中") {
      stats[category].pending += 1
    }
    if ((category === "resource" || category === "demand") && displayStatus === "已发布") {
      stats[category].active += 1
    }
    if (isPlatformRejectedSubmission(item) && !isRejectionNoticeSeen(item)) {
      stats[category].rejectedUnread = (stats[category].rejectedUnread || 0) + 1
    }
  })
  var connectNotice = getPendingConnectNotice()
  if (connectNotice) {
    stats.connect.actionPending = connectNotice.count
  }
  return stats
}

function getCertifySubmissions() {
  var profile = getUserProfile()
  if (!profile || !profile.phone) {
    return []
  }
  return getAllSubmissionsRaw().filter(function(item) {
    return item.type === "certify" && submissionBelongsToUser(item, profile)
  })
}

function getCertifyRecordUrl(submissionId) {
  return "/pages/cert-record/cert-record?id=" + submissionId
}

function getCertReviewTimeline(record) {
  if (!record) {
    return []
  }
  var status = getSubmissionDisplayStatus(record)
  var isApproved = status === "已认证"
  var isClosed = status === "已关闭"
  var isPending = status === "认证中" || status === "待审核"
  return [
    {
      status: "已提交",
      hint: "认证材料已提交，等待平台审核",
      time: record.createdAt || "",
      dotState: "done"
    },
    {
      status: "平台审核中",
      hint: isApproved ? "平台已完成审核" : "撮合经理将在 1-3 个工作日内完成审核",
      time: isPending ? "预计 1-3 个工作日" : "",
      dotState: isApproved || isClosed ? "done" : "pending"
    },
    {
      status: "认证结果",
      hint: isApproved
        ? "已通过，可展示认证标签并参与优先推荐"
        : (isClosed ? "未通过，可重新提交认证" : "等待审核结果"),
      time: isApproved || isClosed ? (record.updatedAt || "") : "",
      dotState: isApproved ? "done" : (isClosed ? "current" : "muted")
    }
  ]
}

function getCertifyDetailRows(record) {
  if (!record) {
    return []
  }
  var rows = []
  function push(label, value) {
    if (value) {
      rows.push({ label: label, value: value })
    }
  }
  var levelConfig = getCertLevelConfig(record.certLevel || "card")
  push("认证类型", levelConfig.title)
  push("企业名称", record.company)
  push("统一社会信用代码", record.creditCode)
  if (levelConfig.requiresRegionRole) {
    push("企业角色", normalizeEnterpriseRole(record.role) || record.role)
    push("企业所在地", record.region)
  }
  push("联系人", record.contact)
  push("手机号", record.phone)
  push("邮箱", record.email)
  push("官网", record.website)
  return rows
}

function enrichCertifyForRecordsList(item) {
  var displayStatus = getSubmissionDisplayStatus(item)
  var levelConfig = getCertLevelConfig(item.certLevel || "card")
  return Object.assign({}, item, {
    displayStatus: displayStatus,
    statusHint: getSubmissionDisplayHint(item),
    statusBadgeClass: getRecordStatusBadgeClass(displayStatus),
    cardTitle: item.title || levelConfig.title,
    summaryLine: [item.company, levelConfig.requiresRegionRole ? item.region : ""].filter(Boolean).join(" · ") || item.description || "",
    relativeTime: formatRelativeTime(item.createdAt),
    miniTimeline: getCertReviewTimeline(item).map(function(step) {
      return { label: step.status, dotState: step.dotState }
    }),
    certLevelName: levelConfig.title
  })
}

function getMineCategorySummary(category) {
  var stats = getMineCategoryStats()
  var stat = stats[category]
  if (!stat || !stat.count) {
    var emptyMap = {
      connect: "申请对接与资源匹配",
      resource: "暂无资源发布",
      demand: "暂无需求提交",
      certify: "认证进度见「资料与认证」页"
    }
    return emptyMap[category] || "暂无记录"
  }
  if (category === "resource" || category === "demand") {
    var parts = [
      "总发布 " + stat.count + " 条",
      "发布中 " + (stat.active || 0) + " 条"
    ]
    if (stat.pending > 0) {
      parts.push(stat.pending + " 待审核")
    }
    if (stat.rejectedUnread > 0) {
      parts.push(stat.rejectedUnread + " 条驳回待查看")
    }
    return parts.join(" · ")
  }
  var labelMap = {
    connect: "对接记录",
    resource: "资源发布",
    demand: "需求提交",
    certify: "认证申请"
  }
  var parts = [stat.count + " 条" + (labelMap[category] || "记录")]
  if (category === "connect" && stat.actionPending > 0) {
    parts.push(stat.actionPending + " 待您处理")
  } else if (stat.pending > 0) {
    parts.push(stat.pending + " 待处理")
  }
  if (stat.rejectedUnread > 0) {
    parts.push(stat.rejectedUnread + " 条驳回待查看")
  }
  return parts.join(" · ")
}

function getRecordTypeTag(item) {
  if (!item) {
    return { label: "商机", tagClass: "" }
  }
  if (item.type === "connect") {
    return { label: "对接申请", tagClass: "warning" }
  }
  if (item.type === "resource") {
    return { label: "资源", tagClass: "resource" }
  }
  if (isDemandSubmitType(item.type)) {
    return { label: "需求", tagClass: "demand" }
  }
  if (item.type === "certify") {
    return { label: "企业认证", tagClass: "" }
  }
  if (item.type === "match") {
    return { label: "人工撮合", tagClass: "warning" }
  }
  return { label: "商机", tagClass: "" }
}

function getRecordStatusBadgeClass(displayStatus) {
  if (!displayStatus) {
    return "status-pending"
  }
  if (displayStatus === "已发布" || displayStatus === "已认证" || displayStatus === "已推荐" || displayStatus === "已交换名片" || displayStatus === "已成交") {
    return "status-approved"
  }
  if (displayStatus === "已关闭" || displayStatus === "已流失") {
    return "status-closed"
  }
  return "status-pending"
}

function getRecordCardTitle(item) {
  if (!item) {
    return ""
  }
  if (item.type === "connect") {
    var target = item.targetTitle || item.title || "资源"
    return "申请对接 · " + target
  }
  return item.title || item.company || "商机申请"
}

function getRecordSummaryLine(item) {
  if (!item) {
    return ""
  }
  if (item.type === "connect") {
    if (isResourceToDemandConnect(item)) {
      if (item.sourceTitle) {
        return "关联资源：" + item.sourceTitle
      }
      if (item.targetTitle) {
        return "匹配需求：" + item.targetTitle
      }
    } else {
      if (item.sourceTitle) {
        return "关联需求：" + item.sourceTitle
      }
      if (item.targetTitle) {
        return "对接资源：" + item.targetTitle
      }
    }
    return item.description || ""
  }
  var parts = []
  if (item.region) {
    parts.push(item.region)
  }
  if (item.scale) {
    parts.push(item.scale)
  }
  if (item.budget) {
    parts.push("预算 " + item.budget)
  } else if (item.price) {
    parts.push(item.price)
  }
  if (item.deliveryTime) {
    parts.push(item.deliveryTime)
  } else if (item.startTime) {
    parts.push(item.startTime)
  }
  if (parts.length > 0) {
    return parts.join(" · ")
  }
  return item.description || item.company || ""
}

function getConnectResourceParty(item, viewerPhone) {
  if (!item || item.type !== "connect") {
    return null
  }
  var parties = buildConnectPartiesForView(item, { viewerPhone: viewerPhone || "" })
  for (var i = 0; i < parties.length; i += 1) {
    var party = parties[i]
    var isResourceSide = isResourceToDemandConnect(item)
      ? party.partyRole === "applicant"
      : party.partyRole === "recipient"
    if (!isResourceSide) {
      continue
    }
    var title = party.company ? party.company + " · " + party.title : party.title
    return {
      side: "资源方",
      title: title
    }
  }
  return null
}

function getRecordMiniTimeline(item, viewerPhone) {
  if (!item) {
    return []
  }
  if (item.type === "connect") {
    return getConnectStageView(item, viewerPhone).miniTimeline
  }
  var status = getSubmissionDisplayStatus(item)
  if (status === "已发布" || status === "已推荐" || status === "已认证") {
    return [{ compact: true, text: "已提交 → 已审核 → 已发布" }]
  }
  if (status === "已关闭" || status === "已流失") {
    return [{ compact: true, text: "已提交 → 已关闭" }]
  }
  return [
    { label: "已提交", dotState: "done" },
    { label: "平台审核中", dotState: "pending" },
    { label: "上架推荐", dotState: "muted" }
  ]
}

function getRecordPublishTimeline(record, viewerPhone) {
  if (!record) {
    return []
  }
  if (record.type === "certify") {
    return getCertReviewTimeline(record)
  }
  if (record.type === "connect") {
    return getConnectFlowTimeline(record, viewerPhone)
  }
  var status = getSubmissionDisplayStatus(record)
  var isPublished = status === "已发布" || status === "已推荐" || status === "已认证"
  var isClosed = status === "已关闭" || status === "已流失"
  var poolLabel = record.type === "resource" ? "资源池" : "需求池"
  var listing = record.listingId ? getItem(record.listingId) : null
  var isPrivate = isListingPrivateDisplay(listing, record)
  var closedTime = record.closedAt || ""
  if (!closedTime && record.statusTimeline && record.statusTimeline.length) {
    for (var i = record.statusTimeline.length - 1; i >= 0; i -= 1) {
      if (record.statusTimeline[i].status === "已关闭") {
        closedTime = record.statusTimeline[i].time || ""
        break
      }
    }
  }
  if (isClosed) {
    var wasPublished = false
    if (record.statusTimeline) {
      record.statusTimeline.forEach(function(entry) {
        if (entry.status === "已发布" || entry.status === "已推荐") {
          wasPublished = true
        }
      })
    }
    if (isPublished === false && wasPublished) {
      isPublished = true
    }
    return [
      {
        status: "已提交",
        hint: (record.type === "resource" ? "资源" : "需求") + "已提交",
        time: record.createdAt || "",
        dotState: "done"
      },
      {
        status: "平台审核中",
        hint: wasPublished ? "平台已完成初审" : "提交后等待平台审核",
        time: "",
        dotState: "done"
      },
      {
        status: "上架推荐",
        hint: wasPublished
          ? "曾在" + poolLabel + "公开展示"
          : "关闭前未进入" + poolLabel,
        time: "",
        dotState: wasPublished ? "done" : "muted"
      },
      {
        status: "已关闭",
        hint: "已从" + poolLabel + "下架，他人无法再查看或对接",
        time: closedTime,
        dotState: "current"
      }
    ]
  }
  return [
    {
      status: "已提交",
      hint: (record.type === "resource" ? "资源" : "需求") + "已提交，等待平台审核",
      time: record.createdAt || "",
      dotState: "done"
    },
    {
      status: "平台审核中",
      hint: isPublished
        ? "平台已完成初审"
        : (isPrivate
          ? "审核通过后不会出现在" + poolLabel + "（未开启公开展示）"
          : "审核通过后才会在" + poolLabel + "公开展示"),
      time: isPublished || isClosed ? "" : "预计 1-2 个工作日",
      dotState: isPublished || isClosed ? "done" : "pending"
    },
    {
      status: "上架推荐",
      hint: isPublished
        ? (isPrivate
          ? "未开启公开展示，仅你可在提交记录中查看"
          : "已进入" + poolLabel + "，系统开始匹配")
        : (isPrivate
          ? "审核通过后不会进入" + poolLabel + "（未开启公开展示）"
          : "审核通过后进入" + poolLabel + "推荐"),
      time: isPublished && !isPrivate ? (record.publishedAt || (listing && listing.publishedAt) || "") : "",
      dotState: isPublished && !isPrivate ? "done" : (isPublished ? "current" : "muted")
    }
  ]
}

function canCloseRecordFromList(item) {
  if (!item || !item.listingId) {
    return false
  }
  if (item.type !== "resource" && !isDemandSubmitType(item.type)) {
    return false
  }
  var listing = getItem(item.listingId)
  return isListingPublisher(item.listingId) && listing && !isListingClosed(listing)
}

function canCloseListing(listingId) {
  if (!listingId) {
    return false
  }
  var listing = getItem(listingId)
  if (!listing || isListingClosed(listing)) {
    return false
  }
  return isListingPublisher(listingId) || canStaffManageProxyListing(listingId)
}

function getRecordDetailRows(record) {
  if (!record || record.type === "connect") {
    return []
  }
  var rows = []
  var isServer = isServerListingType(record.listingType)
  function push(label, value) {
    if (value) {
      rows.push({ label: label, value: value })
    }
  }
  push("类型", record.listingType)
  push("企业", record.company)
  push("角色", record.role)
  if (record.type !== "resource") {
    push("地区", record.region)
  }
  if (isServer) {
    push("产品", record.serverProduct)
    push("规格", getServerConfigText(record))
    push("地点", record.procurementRegion)
    push("品牌偏好", record.serverBrand)
    push("质保", record.warranty)
    push("支付", record.serverPayment)
    push("流程", record.serverProcess)
    push("数量", record.scale)
    push("交期", record.deliveryTime || record.startTime)
    if (record.type === "resource") {
      push("报价", record.price)
    } else {
      push("预算", record.budget)
    }
    push("备注", record.description)
  } else {
    push("规模", record.scale)
    push("期望交货", record.deliveryTime)
    push("预算", record.budget)
    push("价格", record.price)
    push("型号/规格", record.specModel)
    push("租期/周期", record.cycle)
    push("网络/配套", record.networkSpec)
    push("数据中心", record.idcName || record.dcName)
    push("机房等级", record.idcLevel)
    push("单柜功率", record.cabinetPower)
    push("带宽", record.bandwidth)
    push("建设规模", record.projectScale)
    push("服务范围", record.serviceScope)
    push("交付方式", record.delivery)
    push("期望开始", record.startTime)
  }
  push("联系人", record.contact)
  push("手机号", record.phone)
  if (record.listingId && (record.type === "resource" || isDemandSubmitType(record.type))) {
    var listing = getItem(record.listingId)
    push("对外公开展示", isListingPrivateDisplay(listing, record) ? "未开启" : "已开启")
  }
  push("认证等级", record.certLevelName)
  push("信用代码", record.creditCode)
  push("对接资源", record.targetTitle)
  push("己方需求", record.sourceTitle)
  return rows
}

function enrichSubmissionForRecordsList(item, typeNames) {
  typeNames = typeNames || {}
  var displayStatus = getSubmissionDisplayStatus(item)
  var typeTag = getRecordTypeTag(item)
  var profile = getUserProfile()
  var viewerPhone = profile ? profile.phone : ""
  var connectParty = getConnectResourceParty(item, viewerPhone)
  var linkedStats = item.listingId && (item.type === "resource" || isDemandSubmitType(item.type))
    ? getListingLinkedConnectStats(item.listingId)
    : { count: 0, pending: 0, connects: [] }
  var linkedSummary = ""
  if (linkedStats.count > 0) {
    linkedSummary = linkedStats.count + " 条关联对接"
    if (linkedStats.pending > 0) {
      linkedSummary += " · " + linkedStats.pending + " 待我方处理"
    }
  }
  var statusHint = item.type === "connect"
    ? getConnectDisplayHint(item, viewerPhone)
    : getSubmissionDisplayHint(item)
  var pendingView = item.type === "connect"
    ? getConnectPendingSideView(item, viewerPhone)
    : { pendingSide: "none", pendingLabel: "", pendingHint: "", pendingBadgeClass: "" }
  var connectStatusLabel = pendingView.pendingLabel || displayStatus
  var connectStatusBadgeClass = pendingView.pendingLabel
    ? getConnectPendingBadgeClass(pendingView.pendingBadgeClass)
    : getRecordStatusBadgeClass(displayStatus)
  var publicDisplayView = getRecordPublicDisplayView(item)
  return Object.assign({}, item, {
    filterCategory: getRecordFilterCategory(item.type),
    typeName: typeNames[item.type] || "商机申请",
    displayStatus: displayStatus,
    statusHint: statusHint,
    statusBadgeClass: item.type === "connect" ? connectStatusBadgeClass : getRecordStatusBadgeClass(displayStatus),
    connectStatusLabel: connectStatusLabel,
    connectStatusBadgeClass: connectStatusBadgeClass,
    connectPendingLabel: pendingView.pendingLabel,
    connectPendingHint: pendingView.pendingHint,
    connectPendingSide: pendingView.pendingSide,
    connectPendingBadgeClass: pendingView.pendingBadgeClass,
    typeTagLabel: typeTag.label,
    typeTagClass: typeTag.tagClass,
    cardTitle: getRecordCardTitle(item),
    summaryLine: getRecordSummaryLine(item),
    relativeTime: formatRelativeTime(item.createdAt),
    miniTimeline: getRecordMiniTimeline(item, viewerPhone),
    connectResourceParty: connectParty,
    canClose: canCloseRecordFromList(item),
    detailButtonText: item.type === "connect" ? "查看申请" : "记录详情",
    canViewListing: !!getRecordListViewListingButtonText(item),
    viewListingButtonText: getRecordListViewListingButtonText(item),
    closeButtonText: getRecordListCloseButtonText(item),
    linkedConnectCount: linkedStats.count,
    linkedConnectPending: linkedStats.pending,
    linkedConnectSummary: linkedSummary,
    linkedConnects: linkedStats.connects,
    showPublicDisplayStatus: publicDisplayView.show,
    publicDisplayLabel: publicDisplayView.label,
    publicDisplayBadgeClass: publicDisplayView.badgeClass
  })
}

function prepareListingForView(item, options) {
  var enriched = enrichListingForDisplay(item)
  if (!enriched) {
    return enriched
  }
  return sanitizeListingForViewer(enriched, options)
}

function prepareListingListForView(items) {
  return (items || []).map(function(item) {
    var prepared = prepareListingForView(item)
    if (!prepared) {
      return prepared
    }
    var isPublisher = isListingPublisher(item.id)
    return Object.assign({}, prepared, {
      isOwnListing: isPublisher,
      isPublisher: isPublisher,
      isFavorited: favorites.isFavorite(prepared.id)
    }, attachListingDisplayBadges(prepared))
  })
}

function getViewedResourceIds() {
  var list = wx.getStorageSync(viewedResourcesKey) || []
  return Array.isArray(list) ? list : []
}

function markResourceViewed(resourceId) {
  if (!resourceId || !isResource(resourceId)) {
    return
  }
  var list = getViewedResourceIds()
  if (list.indexOf(resourceId) > -1) {
    return
  }
  list.unshift(resourceId)
  if (list.length > 500) {
    list = list.slice(0, 500)
  }
  wx.setStorageSync(viewedResourcesKey, list)
}

function isResourceViewed(resourceId) {
  return getViewedResourceIds().indexOf(resourceId) > -1
}

function getViewedDemandIds() {
  var list = wx.getStorageSync(viewedDemandsKey) || []
  return Array.isArray(list) ? list : []
}

function markDemandViewed(demandId) {
  if (!demandId || isResource(demandId)) {
    return
  }
  var list = getViewedDemandIds()
  if (list.indexOf(demandId) > -1) {
    return
  }
  list.unshift(demandId)
  if (list.length > 500) {
    list = list.slice(0, 500)
  }
  wx.setStorageSync(viewedDemandsKey, list)
}

function isDemandViewed(demandId) {
  return getViewedDemandIds().indexOf(demandId) > -1
}

function getResourcePoolDisplayTags(item) {
  var tags = (item && item.tags) || []
  var skip = {}
  if (item && item.type) {
    skip[item.type] = true
  }
  if (item && item.region) {
    skip[item.region] = true
  }
  if (item && item.city) {
    skip[item.city] = true
  }
  skip["用户发布"] = true
  skip["批量采购"] = true
  if (isStaffProxyListing(item)) {
    skip["平台代发"] = true
  }
  return tags.filter(function(tag) {
    return tag && !skip[tag]
  }).slice(0, 3)
}

function enrichResourcePoolItem(item) {
  var isPublisher = isListingPublisher(item && item.id)
  var prepared = prepareListingForView(item, { isListingPublisher: isPublisher })
  if (!prepared) {
    return null
  }
  var connect = isUserRegistered() ? findViewerConnectForListing(prepared.id) : null
  var viewed = isResourceViewed(prepared.id)
  var browseStatus = ""
  var browseStatusClass = ""
  if (connect) {
    browseStatus = "已申请"
    browseStatusClass = "applied"
  } else if (viewed) {
    browseStatus = "已查看"
    browseStatusClass = "viewed"
  }
  var poolConnectAction = !isPublisher && !isStaffUser()
  return Object.assign({}, prepared, {
    isOwnListing: isPublisher,
    isPublisher: isPublisher,
    browseStatus: browseStatus,
    browseStatusClass: browseStatusClass,
    hasConnectApplied: !!connect,
    connectRecordId: connect ? connect.id : "",
    isFavorited: favorites.isFavorite(prepared.id),
    poolFacts: buildPoolFacts(prepared, { isResource: true }),
    poolSummaryLine: buildPoolSummaryLine(prepared),
    poolTimeLabel: buildPoolTimeLabel(prepared),
    showConnectAction: poolConnectAction
  }, attachListingDisplayBadges(prepared))
}

function prepareResourceListForView(items) {
  return (items || []).map(enrichResourcePoolItem).filter(Boolean)
}

function enrichDemandPoolItem(item) {
  var isPublisher = isListingPublisher(item && item.id)
  var prepared = prepareListingForView(item, { isListingPublisher: isPublisher })
  if (!prepared) {
    return null
  }
  var connect = isUserRegistered() ? findViewerConnectForListing(prepared.id) : null
  var viewed = isDemandViewed(prepared.id)
  var browseStatus = ""
  var browseStatusClass = ""
  if (connect) {
    browseStatus = "已申请"
    browseStatusClass = "applied"
  } else if (viewed) {
    browseStatus = "已查看"
    browseStatusClass = "viewed"
  }
  return Object.assign({}, prepared, {
    isOwnListing: isPublisher,
    isPublisher: isPublisher,
    browseStatus: browseStatus,
    browseStatusClass: browseStatusClass,
    hasConnectApplied: !!connect,
    connectRecordId: connect ? connect.id : "",
    showMatchAction: !isPublisher && !isStaffUser(),
    isFavorited: favorites.isFavorite(prepared.id),
    poolFacts: buildPoolFacts(prepared, { isResource: false }),
    poolSummaryLine: buildPoolSummaryLine(prepared),
    poolTimeLabel: buildPoolTimeLabel(prepared)
  }, attachListingDisplayBadges(prepared))
}

function prepareDemandListForView(items) {
  return (items || []).map(enrichDemandPoolItem).filter(Boolean)
}

function canApplyConnectToListing(listingId) {
  if (!listingId || !isResource(listingId) || isStaffUser() || !canApplyConnect()) {
    return false
  }
  var listing = getItem(listingId)
  return !!listing && !isListingPublisher(listingId) && !isListingClosed(listing)
}

function canMatchToDemandListing(listingId) {
  if (!listingId || isResource(listingId) || isStaffUser() || !canApplyConnect()) {
    return false
  }
  var listing = getItem(listingId)
  return !!listing && !isListingPublisher(listingId) && !isListingClosed(listing)
}

function getMatchSubmitUrl(listingId, title) {
  if (!listingId || isResource(listingId)) {
    return ""
  }
  var url = "/pages/submit/submit?type=connect&direction=resource_to_demand&targetId=" + listingId
  if (title) {
    url += "&title=" + encodeURIComponent(title)
  }
  return url
}

function getUserDisplayName() {
  var profile = getUserProfile()
  if (!isUserRegistered()) {
    return "访客用户"
  }
  if (profile.contact) {
    return profile.contact
  }
  if (profile.company) {
    return profile.company
  }
  return maskPhone(profile.phone)
}

function requiresRegistration(type) {
  return isDemandSubmitType(type) || type === "resource" || type === "connect"
}

function getRegistrationPromptContent(type) {
  if (type === "resource") {
    return "发布资源需先登录账号。"
  }
  if (isDemandSubmitType(type)) {
    return "提交需求需先登录账号。"
  }
  return "请先登录账号。"
}

function getDisclaimerContent() {
  return require("../legalContent").getDisclaimerContent()
}

function buildLegalPageUrl(type, options) {
  return require("../legalContent").buildLegalPageUrl(type, options)
}

function buildRegisterUrl(redirect) {
  var url = "/pages/login/login?tab=register"
  if (redirect) {
    url += "&redirect=" + encodeURIComponent(redirect)
  }
  return url
}

/** 拉取云端 openid 绑定状态，再决定进入登录/注册或停留当前页 */
function resolveAuthGateFromCloud() {
  if (!isCloudEnabled()) {
    var localProfile = getUserProfile() || {}
    return Promise.resolve({
      registered: isUserRegistered(),
      boundPhone: localProfile.phone || "",
      allowRegister: !localProfile.phone
    })
  }
  return cloudStore.validateDeviceSessionRemote({ silent: true, applySession: false }).then(function(result) {
    var profile = result && result.data && result.data.userProfile ? result.data.userProfile : null
    var boundPhone = profile && profile.phone ? profile.phone : ""
    return {
      registered: isUserRegistered(),
      boundPhone: boundPhone,
      allowRegister: !boundPhone
    }
  }).catch(function() {
    var fallbackProfile = getUserProfile() || {}
    var fallbackPhone = fallbackProfile.phone || ""
    return {
      registered: isUserRegistered(),
      boundPhone: fallbackPhone,
      allowRegister: !fallbackPhone
    }
  })
}

function navigateAuthGate(options) {
  options = options || {}
  var targetTab = options.tab === "register" ? "register" : "login"
  var redirect = options.redirect || ""
  return resolveAuthGateFromCloud().then(function(gate) {
    if (gate.registered) {
      return { action: "stay", gate: gate }
    }
    if (targetTab === "register" && gate.boundPhone) {
      return {
        action: "login",
        gate: gate,
        message: "当前微信已绑定手机号，请使用绑定号码登录"
      }
    }
    if (targetTab === "register" && gate.allowRegister) {
      return { action: "register", gate: gate }
    }
    return { action: "login", gate: gate }
  })
}

function buildLoginUrl(redirect) {
  var url = "/pages/login/login"
  if (redirect) {
    url += "?redirect=" + encodeURIComponent(redirect)
  }
  return url
}

var loginGateActions = {
  "submit-demand": {
    title: "提交需求需要登录",
    text: "登录并完成名片认证后，可填写算力整机/算力租赁/机房需求，平台 24 小时内推荐匹配资源方。",
    redirect: "/pages/submit/submit?type=demand"
  },
  "submit-resource": {
    title: "发布资源需要登录",
    text: "登录并完成名片认证后，可发布算力整机、算力租赁等资源，进入平台推荐池。",
    redirect: "/pages/submit/submit?type=resource"
  },
  "submit-room": {
    title: "提交机房需求需要登录",
    text: "登录并完成名片认证后，可提交找机房/建机房需求，平台将匹配 IDC 或 EPC 服务商。",
    redirect: "/pages/submit/submit?type=room"
  },
  "submit-match": {
    title: "人工撮合需要登录",
    text: "登录后申请人工撮合，平台经理将协助推进双方约谈。",
    redirect: "/pages/submit/submit?type=match"
  },
  resources: {
    title: "此操作需要登录",
    text: "浏览资源与需求无需登录。登录后可提交需求、发布资源并申请对接。",
    redirect: "/pages/resources/resources"
  },
  connect: {
    title: "申请对接需要登录",
    text: "登录并完成名片认证后，即可申请与资源方/需求方对接。",
    redirect: "/pages/home/home"
  },
  "share-resource": {
    title: "登录后继续申请对接",
    text: "你正在查看好友分享的资源。登录并完成名片认证后可申请对接；新用户注册约 1 分钟完成。",
    redirect: "/pages/home/home"
  },
  certify: {
    title: "企业认证需要登录",
    text: "登录后上传名片或营业执照，获得认证标签与优先推荐。",
    redirect: "/pages/certify/certify"
  },
  default: {
    title: "此功能需要登录",
    text: "登录后可继续操作。注册仅需手机号与密码，约 1 分钟完成。",
    redirect: "/pages/home/home"
  }
}

function inferLoginGateActionFromRedirect(redirect) {
  if (!redirect) {
    return "default"
  }
  if (redirect.indexOf("/pages/detail/detail") > -1 && redirect.indexOf("from=share") > -1) {
    return "share-resource"
  }
  if (redirect.indexOf("type=connect") > -1 || redirect.indexOf("/pages/resource-connect/") > -1) {
    return "connect"
  }
  if (redirect.indexOf("type=room") > -1) {
    return "submit-room"
  }
  if (redirect.indexOf("type=match") > -1) {
    return "submit-match"
  }
  if (redirect.indexOf("type=server") > -1 || redirect.indexOf("type=demand") > -1) {
    return "submit-demand"
  }
  if (redirect.indexOf("type=resource") > -1) {
    return "submit-resource"
  }
  if (redirect.indexOf("/resources/resources") > -1) {
    return "resources"
  }
  if (redirect.indexOf("/certify/certify") > -1) {
    return "certify"
  }
  return "default"
}

function getLoginGateConfig(action, redirect) {
  var cfg = loginGateActions[action] || loginGateActions.default
  if (redirect) {
    return Object.assign({}, cfg, { redirect: redirect })
  }
  return Object.assign({}, cfg)
}

function shouldShowLoginGateContext(options) {
  options = options || {}
  var redirect = options.redirect || ""
  var action = options.action || inferLoginGateActionFromRedirect(redirect)
  if (!action || action === "default") {
    return false
  }
  if (options.action) {
    return true
  }
  if (!redirect) {
    return false
  }
  var pathOnly = redirect.split("?")[0]
  var proactivePaths = [
    "/pages/mine/mine",
    "/pages/home/home",
    "/pages/onboard/onboard"
  ]
  if (proactivePaths.indexOf(pathOnly) > -1 && redirect.indexOf("?") === -1) {
    return false
  }
  return true
}

var loginHeroCopyByAction = {
  "submit-demand": {
    login: { title: "欢迎回来", sub: "登录后即可提交算力、算力整机或机房需求" },
    register: { title: "创建账号", sub: "注册后即可提交需求，约 1 分钟完成" }
  },
  "submit-resource": {
    login: { title: "欢迎回来", sub: "登录后即可发布算力整机、算力租赁等资源" },
    register: { title: "创建账号", sub: "注册后即可发布资源，约 1 分钟完成" }
  },
  "submit-room": {
    login: { title: "欢迎回来", sub: "登录后即可提交找机房或建机房需求" },
    register: { title: "创建账号", sub: "注册后即可提交机房需求" }
  },
  "submit-match": {
    login: { title: "欢迎回来", sub: "登录后即可申请人工撮合服务" },
    register: { title: "创建账号", sub: "注册后即可申请人工撮合" }
  },
  resources: {
    login: { title: "欢迎回来", sub: "登录后可浏览资源池并查看资源详情" },
    register: { title: "创建账号", sub: "注册后即可查看资源池" }
  },
  connect: {
    login: { title: "欢迎回来", sub: "登录并完成名片认证后即可申请对接" },
    register: { title: "创建账号", sub: "注册并完成名片认证后即可申请对接" }
  },
  "share-resource": {
    login: { title: "欢迎回来", sub: "登录后可继续申请与资源方对接" },
    register: { title: "创建账号", sub: "注册后即可继续查看分享的资源" }
  },
  certify: {
    login: { title: "欢迎回来", sub: "登录后即可上传名片或营业执照" },
    register: { title: "创建账号", sub: "注册后即可进行企业认证" }
  }
}

function getLoginHeroCopy(action, userTab, hasContext) {
  var isRegister = userTab === "register"
  if (!hasContext) {
    return {
      heroTitle: isRegister ? "创建账号" : "欢迎回来",
      heroSub: isRegister
        ? "填写基本信息，即可开始使用平台"
        : "登录后可浏览更多资源，名片认证后可申请对接"
    }
  }
  var actionCopy = loginHeroCopyByAction[action]
  if (actionCopy) {
    var tabCopy = isRegister ? actionCopy.register : actionCopy.login
    return {
      heroTitle: tabCopy.title,
      heroSub: tabCopy.sub
    }
  }
  return {
    heroTitle: isRegister ? "创建账号" : "欢迎回来",
    heroSub: isRegister
      ? "填写基本信息，注册后自动回到刚才页面"
      : "登录后继续刚才的操作"
  }
}

function buildLoginGateUrl(options) {
  return buildAuthUrl(options)
}

function buildAuthUrl(options) {
  options = options || {}
  var action = options.action || inferLoginGateActionFromRedirect(options.redirect || "")
  var url = "/pages/login/login?action=" + encodeURIComponent(action)
  if (options.tab) {
    url += "&tab=" + encodeURIComponent(options.tab)
  }
  if (options.redirect) {
    url += "&redirect=" + encodeURIComponent(options.redirect)
  }
  return url
}

function promptRegistration(options) {
  options = options || {}
  if (isUserRegistered()) {
    return true
  }
  wx.navigateTo({
    url: buildAuthUrl(options)
  })
  return false
}

var userIntentOptions = [
  {
    value: "demand",
    title: "我要找算力",
    text: "提交需求，平台 24 小时内推荐匹配资源方",
    action: "/pages/submit/submit?type=demand"
  },
  {
    value: "supply",
    title: "我要供算力",
    text: "发布资源，进入待审公示池等待对接",
    action: "/pages/submit/submit?type=resource"
  },
  {
    value: "browse",
    title: "我先逛逛",
    text: "浏览资源与需求，稍后再决定发布什么",
    action: "/pages/home/home"
  }
]

function needsOnboarding() {
  if (!isUserRegistered()) {
    return false
  }
  if (isStaffUser()) {
    return false
  }
  var profile = getUserProfile()
  if (profile && profile.onboardingCompleted) {
    return false
  }
  if (getSubmissions().length > 0 || hasFullProfile() || getLatestCertSubmission()) {
    return false
  }
  return true
}

function getUserIntentOptions() {
  return userIntentOptions
}

function completeOnboarding(intent) {
  return saveUserProfile({
    onboardingCompleted: true,
    userIntent: intent || "browse",
    onboardingCompletedAt: formatDate(new Date())
  })
}

function getIntentAction(intent) {
  for (var i = 0; i < userIntentOptions.length; i += 1) {
    if (userIntentOptions[i].value === intent) {
      return userIntentOptions[i].action
    }
  }
  return "/pages/home/home"
}

function navigateToPath(url) {
  var tabPaths = [
    "/pages/home/home",
    "/pages/resources/resources",
    "/pages/demands/demands",
    "/pages/mine/mine"
  ]
  var path = url.split("?")[0]
  if (tabPaths.indexOf(path) > -1) {
    wx.switchTab({ url: path })
    return
  }
  wx.redirectTo({ url: url })
}

function saveShareIntent(intent) {
  if (!intent || !intent.listingId) {
    return
  }
  wx.setStorageSync(shareIntentKey, {
    listingId: intent.listingId,
    action: intent.action || "view",
    isResource: intent.isResource !== false,
    title: intent.title || "",
    source: intent.source || "share",
    savedAt: Date.now()
  })
}

function getShareIntent() {
  return wx.getStorageSync(shareIntentKey) || null
}

function clearShareIntent() {
  wx.removeStorageSync(shareIntentKey)
}

function isHomeGuideDismissed(dismissKey) {
  if (!dismissKey) {
    return false
  }
  var store = wx.getStorageSync(homeGuideDismissKey) || {}
  return !!store[dismissKey]
}

function dismissHomeGuide(dismissKey) {
  if (!dismissKey) {
    return
  }
  var store = wx.getStorageSync(homeGuideDismissKey) || {}
  store[dismissKey] = Date.now()
  wx.setStorageSync(homeGuideDismissKey, store)
}

function isShareDetailLanding(listingId, options) {
  options = options || {}
  if (options.from === "ops-proxy" || options.from === "staff-proxy") {
    return false
  }
  if (options.from === "share") {
    return true
  }
  if (listingId && canStaffManageProxyListing(listingId)) {
    return false
  }
  var intent = getShareIntent()
  if (intent && intent.listingId === listingId && intent.source === "share") {
    return true
  }
  return false
}

/** 代发客户信息仅允许从代发管理/代发提交落地，分享与公开展示池一律不展示 */
function isStaffProxyDetailLanding(options) {
  options = options || {}
  var from = options.from || ""
  if (from === "share" || from === "ops-connect" || from === "connect-preview") {
    return false
  }
  return from === "ops-proxy" || from === "staff-proxy"
}

function buildConnectListingPreviewUrl(connectId, listingId, options) {
  options = options || {}
  if (!connectId || !listingId) {
    return ""
  }
  var url = "/pages/detail/detail?id=" + encodeURIComponent(listingId)
    + "&connectId=" + encodeURIComponent(connectId)
    + "&from=connect-preview"
  if (options.connectFrom === "ops") {
    url += "&connectFrom=ops"
  }
  return url
}

function getConnectPreviewBackUrl(connectId, options) {
  options = options || {}
  if (!connectId) {
    return ""
  }
  if (options.connectFrom === "ops") {
    return "/pages/ops-connect-detail/ops-connect-detail?id=" + encodeURIComponent(connectId)
  }
  return "/pages/record/record?id=" + encodeURIComponent(connectId)
}

function getConnectPreviewContext(connectId) {
  if (!connectId) {
    return null
  }
  var connect = getSubmission(connectId)
  if (!connect || connect.type !== "connect") {
    return null
  }
  return {
    connectId: connectId,
    title: connect.title || connect.cardTitle || "对接记录",
    direction: isResourceToDemandConnect(connect) ? "资源匹配需求" : "需求申请资源"
  }
}

function canShowStaffProxyDetailOnDetailPage(listingId, options) {
  if (!listingId || !canStaffManageProxyListing(listingId)) {
    return false
  }
  if (isShareDetailLanding(listingId, options)) {
    return false
  }
  return true
}

function getDetailPageUrl(listingId, options) {
  options = options || {}
  var url = "/pages/detail/detail?id=" + listingId
  if (options.from) {
    url += "&from=" + encodeURIComponent(options.from)
  } else if (options.fromShare) {
    url += "&from=share"
  }
  return url
}

function getConnectSubmitUrl(listingId, title) {
  var url = "/pages/resource-connect/resource-connect?targetId=" + listingId
  if (title) {
    url += "&title=" + encodeURIComponent(title)
  }
  return url
}

function getConnectApplyUrl(connectSubmission) {
  if (!connectSubmission || connectSubmission.type !== "connect" || !connectSubmission.targetId) {
    return ""
  }
  var title = connectSubmission.targetTitle || ""
  if (connectSubmission.connectDirection === "resource_to_demand") {
    return "/pages/submit/submit?type=connect&direction=resource_to_demand&targetId="
      + connectSubmission.targetId
      + (title ? "&title=" + encodeURIComponent(title) : "")
  }
  return getConnectSubmitUrl(connectSubmission.targetId, title)
}

function appendRedirectToUrl(url, redirect) {
  if (!redirect) {
    return url
  }
  return url + (url.indexOf("?") > -1 ? "&" : "?") + "redirect=" + encodeURIComponent(redirect)
}

function resolveShareResumeUrl() {
  var intent = getShareIntent()
  if (!intent || !intent.listingId) {
    return ""
  }
  return getDetailPageUrl(intent.listingId, { fromShare: true })
}

function navigateAfterRegister(url) {
  if (url) {
    navigateToPath(url)
    return
  }
  var shareUrl = resolveShareResumeUrl()
  if (shareUrl) {
    navigateToPath(shareUrl)
    return
  }
  if (needsOnboarding()) {
    wx.redirectTo({ url: "/pages/onboard/onboard" })
    return
  }
  wx.switchTab({ url: "/pages/mine/mine" })
}

function getNextStepGuide() {
  if (!isUserRegistered()) {
    return {
      title: "登录后即可使用",
      hint: "使用手机号和密码登录，可查看资源；名片认证后可提交需求与发布资源",
      actionText: "去登录",
      action: "login"
    }
  }

  if (needsOnboarding()) {
    return {
      title: "选择你的目标",
      hint: "告诉我们你想找算力还是供算力，方便推荐下一步操作",
      actionText: "开始选择",
      action: "onboard"
    }
  }

  var profile = getUserProfile()
  var submissions = getSubmissions()

  if (hasPendingCertApplication()) {
    var pendingCert = getPendingCertSubmission() || getLatestCertSubmission()
    var pendingLevel = pendingCert && pendingCert.certLevel ? pendingCert.certLevel : "card"
    var approvedLevel = getApprovedCertLevel()
    return {
      title: pendingLevel === "license" ? "营业执照认证审核中" : "企业信息审核中",
      hint: pendingLevel === "license" && approvedLevel === "card"
        ? "名片认证仍然有效，审核通过后将升级为营业执照认证"
        : "你的企业认证正在审核，请查看已提交的认证信息",
      actionText: "查看认证",
      action: "certifyRecord",
      certRecordId: pendingCert && isCertPending(pendingCert) ? pendingCert.id : ""
    }
  }

  var pendingConnect = getPendingConnectNotice()
  if (pendingConnect && pendingConnect.count > 0) {
    return {
      title: "有对接待您处理",
      hint: pendingConnect.summary,
      actionText: "去处理",
      action: "records",
      filter: "connect"
    }
  }

  var pendingRejection = getPendingRejectionNotice()
  if (pendingRejection && pendingRejection.count > 0) {
    return {
      title: "有申请未通过审核",
      hint: pendingRejection.summary,
      actionText: "查看详情",
      action: "rejectionNotice"
    }
  }

  var pendingBusinessCount = countPendingPublishReviews(submissions)

  if (pendingBusinessCount > 0) {
    return {
      title: "平台正在初审",
      hint: "你有 " + pendingBusinessCount + " 条提交待审核，撮合经理将在 24 小时内联系",
      actionText: "查看进度",
      action: "records"
    }
  }

  if (!hasFullProfile()) {
    return {
      title: "完善企业资料",
      hint: "填写企业名称与联系信息",
      actionText: "去完善",
      action: "certify"
    }
  }

  var cert = getLatestCertSubmission()
  var certLevel = getUserCertLevel()
  if (!cert) {
    return {
      title: "提交名片认证",
      hint: "首次提交需求/资源须先完成名片认证，平台约 1-3 个工作日审核",
      actionText: "去认证",
      action: "certify"
    }
  }

  if (certLevel === "card" && !getPendingCertSubmission("license")) {
    return {
      title: "升级营业执照认证",
      hint: "升级后可获得优先推荐与营业执照认证标签",
      actionText: "去升级",
      action: "certify",
      dismissKey: "licenseUpgrade"
    }
  }

  if (profile.userIntent === "demand" && submissions.length === 0) {
    return {
      title: "提交你的第一条需求",
      hint: "填写结构化需求后，平台将推荐 3 家匹配资源方",
      actionText: "提交需求",
      action: "submitDemand"
    }
  }

  if (profile.userIntent === "supply" && submissions.length === 0) {
    return {
      title: "发布你的第一条资源",
      hint: "填写资源信息后进入公示池，等待需求方申请对接",
      actionText: "发布资源",
      action: "submitResource"
    }
  }

  return {
    title: "继续探索商机",
    hint: "浏览资源池和需求池，找到匹配对象后可申请对接",
    actionText: "去浏览",
    action: "browse"
  }
}

function validateRegisterForm(form) {
  var phoneSource = form.phoneSource || "manual"
  if (!form.contact || !String(form.contact).trim()) {
    return { ok: false, message: "请填写您的姓名" }
  }
  if (!form.phone) {
    return {
      ok: false,
      message: phoneSource === "wechat" ? "请先通过微信授权手机号" : "请填写11位手机号"
    }
  }
  if (!form.phoneVerified) {
    return {
      ok: false,
      message: phoneSource === "wechat" ? "手机号需通过微信官方授权获取" : "请填写有效手机号"
    }
  }
  if (!/^1\d{10}$/.test(String(form.phone))) {
    return { ok: false, message: "请输入11位有效手机号" }
  }
  if (!form.disclaimerAccepted || !form.termsAccepted || !form.privacyAccepted) {
    return { ok: false, message: "请先阅读并同意用户服务协议、隐私政策及免责申明" }
  }
  var pwdCheck = userAuth.validatePasswordMatch(form.password, form.confirmPassword)
  if (!pwdCheck.ok) {
    return pwdCheck
  }
  return { ok: true }
}

function buildRegisteredProfilePatch(form) {
  var phoneSource = form.phoneSource || "manual"
  var legal = require("../legalContent")
  var now = formatDate(new Date())
  var patch = {
    contact: String(form.contact || "").trim(),
    phone: form.phone,
    phoneVerified: true,
    phoneSource: phoneSource,
    registered: true,
    disclaimerAccepted: true,
    disclaimerVersion: disclaimerVersion,
    disclaimerAcceptedAt: now,
    termsAccepted: true,
    termsVersion: form.termsVersion || legal.termsVersion,
    termsAcceptedAt: now,
    privacyAccepted: true,
    privacyVersion: form.privacyVersion || legal.privacyVersion,
    privacyAcceptedAt: now,
    registeredAt: now
  }
  return patch
}

function applyRegisteredProfileLocal(form) {
  var patch = buildRegisteredProfilePatch(form)
  wx.setStorageSync(userProfileKey, patch)
  return patch
}

function registerUser(form) {
  var validation = validateRegisterForm(form)
  if (!validation.ok) {
    return validation
  }
  if (isCloudEnabled()) {
    return { ok: false, message: "云端模式请使用 registerUserAsync 注册" }
  }
  if (userAuth.findLocalUserByPhone(form.phone)) {
    return { ok: false, message: "该手机号已注册，请直接登录" }
  }
  clearAccountLocalCacheBeforeAuth()
  var pwd = userAuth.createLocalPasswordRecord(form.password)
  userAuth.saveLocalUser(Object.assign({}, buildRegisteredProfilePatch(form), {
    passwordSalt: pwd.passwordSalt,
    passwordHash: pwd.passwordHash
  }))
  applyRegisteredProfileLocal(form)
  userAuth.saveSession(form.phone)
  return { ok: true }
}

function registerUserAsync(form, options) {
  options = options || {}
  var validation = validateRegisterForm(form)
  if (!validation.ok) {
    return Promise.resolve(validation)
  }
  if (!isCloudEnabled()) {
    return Promise.resolve(registerUser(form))
  }
  var legal = require("../legalContent")
  return cloudStore.registerUserRemote({
    contact: String(form.contact || "").trim(),
    phone: form.phone,
    phoneVerified: form.phoneVerified,
    phoneSource: form.phoneSource || "manual",
    disclaimerAccepted: form.disclaimerAccepted,
    disclaimerVersion: disclaimerVersion,
    termsAccepted: form.termsAccepted,
    termsVersion: form.termsVersion || legal.termsVersion,
    privacyAccepted: form.privacyAccepted,
    privacyVersion: form.privacyVersion || legal.privacyVersion,
    password: form.password
  }).then(function() {
    userAuth.saveSession(form.phone)
    schedulePostAuthCloudSync()
    return { ok: true }
  }).catch(function(error) {
    if (error && error.alreadyBound) {
      return {
        ok: false,
        alreadyBound: true,
        message: error.message || "当前微信已绑定手机号，请使用绑定号码登录"
      }
    }
    return { ok: false, message: error.message || "云端注册失败" }
  })
}

function loginUserAsync(form, options) {
  options = options || {}
  var phone = (form.phone || "").trim()
  var password = form.password || ""
  if (!phone || !password) {
    return Promise.resolve({ ok: false, message: "请输入手机号和密码" })
  }
  if (!/^1\d{10}$/.test(phone)) {
    return Promise.resolve({ ok: false, message: "请输入11位有效手机号" })
  }
  if (isCloudEnabled()) {
    return cloudStore.loginUserRemote({
      phone: phone,
      password: password
    }).then(function() {
      userAuth.saveSession(phone)
      schedulePostAuthCloudSync()
      return { ok: true }
    }).catch(function(error) {
      return { ok: false, message: error.message || "登录失败" }
    })
  }
  var user = userAuth.findLocalUserByPhone(phone)
  if (!user) {
    return Promise.resolve({ ok: false, message: "账号不存在，请先注册" })
  }
  if (!userAuth.verifyLocalPassword(password, user.passwordSalt, user.passwordHash)) {
    return Promise.resolve({ ok: false, message: "手机号或密码不正确" })
  }
  clearAccountLocalCacheBeforeAuth()
  applyLoggedInProfile(user, phone)
  return Promise.resolve({ ok: true })
}

function validateChangePasswordForm(form) {
  if (!form.oldPassword) {
    return { ok: false, message: "请输入原密码" }
  }
  if (!form.newPassword || !form.confirmPassword) {
    return { ok: false, message: "请填写新密码" }
  }
  var pwdCheck = userAuth.validatePasswordMatch(form.newPassword, form.confirmPassword)
  if (!pwdCheck.ok) {
    return pwdCheck
  }
  if (String(form.oldPassword) === String(form.newPassword)) {
    return { ok: false, message: "新密码不能与原密码相同" }
  }
  return { ok: true }
}

function changePasswordAsync(form) {
  var validation = validateChangePasswordForm(form)
  if (!validation.ok) {
    return Promise.resolve(validation)
  }
  if (!isUserRegistered()) {
    return Promise.resolve({ ok: false, message: "请先登录" })
  }
  if (isCloudEnabled()) {
    return cloudStore.changePasswordRemote({
      oldPassword: form.oldPassword,
      newPassword: form.newPassword
    }).then(function() {
      return { ok: true }
    }).catch(function(error) {
      return { ok: false, message: error.message || "修改密码失败" }
    })
  }
  var phone = userAuth.getSessionPhone()
  if (!phone) {
    return Promise.resolve({ ok: false, message: "请先登录" })
  }
  var user = userAuth.findLocalUserByPhone(phone)
  if (!user) {
    return Promise.resolve({ ok: false, message: "账号不存在，请重新登录" })
  }
  if (!userAuth.verifyLocalPassword(form.oldPassword, user.passwordSalt, user.passwordHash)) {
    return Promise.resolve({ ok: false, message: "原密码不正确" })
  }
  var pwd = userAuth.createLocalPasswordRecord(form.newPassword)
  userAuth.saveLocalUser(Object.assign({}, user, {
    passwordSalt: pwd.passwordSalt,
    passwordHash: pwd.passwordHash
  }))
  return Promise.resolve({ ok: true })
}

function navigateAfterLogin(url) {
  if (url) {
    navigateToPath(url)
    return
  }
  var shareUrl = resolveShareResumeUrl()
  if (shareUrl) {
    navigateToPath(shareUrl)
    return
  }
  if (isStaffUser()) {
    wx.switchTab({ url: "/pages/mine/mine" })
    return
  }
  if (needsOnboarding()) {
    wx.redirectTo({ url: "/pages/onboard/onboard" })
    return
  }
  wx.switchTab({ url: "/pages/mine/mine" })
}

function saveUserProfile(profile) {
  if (isCloudEnabled()) {
    return cloudStore.updateProfileRemote(profile).then(function() {
      return getUserProfile() || {}
    })
  }
  var current = getUserProfile() || {}
  var next = Object.assign({}, current, profile)
  wx.setStorageSync(userProfileKey, next)
  return Promise.resolve(next)
}

function getCertifyPageUrl(redirect) {
  if (getUserCertLevel()) {
    return appendRedirectToUrl("/pages/certify/certify?view=1", redirect)
  }
  var summary = getUserCertSummary()
  var base = "/pages/certify/certify"
  if (summary.status === "pending") {
    base = "/pages/certify/certify?view=1"
  } else if (summary.status === "card_verified" || summary.status === "license_verified") {
    base = "/pages/certify/certify?view=1"
  } else if (summary.canUpgrade) {
    base = "/pages/certify/certify?level=license"
  } else if (summary.status === "rejected") {
    base = "/pages/certify/certify"
  } else if (summary.canCertify) {
    base = "/pages/certify/certify"
  } else {
    base = "/pages/certify/certify?view=1"
  }
  return appendRedirectToUrl(base, redirect)
}

function getUserProfile() {
  return wx.getStorageSync(userProfileKey) || null
}

function getUserCertSummary() {
  var profile = getUserProfile()
  var cert = getLatestCertSubmission()
  var certLevel = getUserCertLevel()
  var levelConfig = certLevel ? getCertLevelConfig(certLevel) : null
  var base = {
    company: profile && profile.company ? profile.company : "",
    role: profile && profile.role ? normalizeEnterpriseRole(profile.role) : "",
    region: profile && profile.region ? profile.region : "",
    contact: profile && profile.contact ? profile.contact : "",
    phone: profile && profile.phone ? profile.phone : "",
    creditCode: profile && profile.creditCode ? profile.creditCode : "",
    certLevel: certLevel,
    certifyRecord: cert,
    canCertify: true,
    needRegister: false,
    canUpgrade: false
  }

  if (!isUserRegistered()) {
    return Object.assign({}, base, {
      status: "guest",
      statusText: "访客用户",
      statusHint: "登录后可浏览资源与需求；申请对接、提交需求或发布资源需完成名片认证；营业执照认证通过后可查看资源附件",
      canCertify: false,
      needRegister: true
    })
  }

  if (!hasFullProfile() && !cert) {
    if (profile && profile.certStatus === "pending") {
      return Object.assign({}, base, {
        status: "pending",
        statusText: "认证中",
        statusHint: "平台将在 1-3 个工作日内完成审核，期间可查看已提交的认证信息",
        canCertify: false,
        certMenuLabel: "查看认证",
        submittedAt: profile.certSubmittedAt || ""
      })
    }
    return Object.assign({}, base, {
      status: "basic",
      statusText: base.contact ? "已注册" : "已注册",
      statusHint: "完成名片认证后可申请对接、提交需求或发布资源，并获得认证标签与优先推荐",
      canCertify: true,
      needRegister: false
    })
  }

  if (!cert) {
    if (profile && profile.certStatus === "pending") {
      return Object.assign({}, base, {
        status: "pending",
        statusText: "认证中",
        statusHint: "平台将在 1-3 个工作日内完成审核，期间可查看已提交的认证信息",
        canCertify: false,
        certMenuLabel: "查看认证",
        submittedAt: profile.certSubmittedAt || ""
      })
    }
    return Object.assign({}, base, {
      status: "unverified",
      statusText: "未认证",
      statusHint: "已保存基础资料，提交认证后可参与优先推荐",
      canCertify: true,
      certMenuLabel: "企业认证"
    })
  }

  if (isCertPending(cert)) {
    var pendingLevel = cert.certLevel || "card"
    var approvedLevel = getApprovedCertLevel()
    return Object.assign({}, base, {
      status: "pending",
      statusText: pendingLevel === "license" ? "执照认证中" : "名片认证中",
      statusHint: pendingLevel === "license" && approvedLevel === "card"
        ? "营业执照认证审核中，名片认证权限仍然有效；通过后升级为营业执照认证"
        : "平台将在 1-3 个工作日内完成审核，期间可查看已提交的认证信息",
      canCertify: false,
      certMenuLabel: "查看认证",
      submittedAt: cert.createdAt,
      certLevel: approvedLevel || pendingLevel,
      canUpgrade: approvedLevel === "card" && pendingLevel !== "license"
    })
  }

  if (isCertApproved(cert)) {
    var approvedConfig = getCertLevelConfig(cert.certLevel || "card")
    var approvedStatus = cert.certLevel === "license" ? "license_verified" : "card_verified"
    return Object.assign({}, base, {
      status: approvedStatus,
      statusText: approvedConfig.verifiedText,
      statusHint: approvedConfig.verifiedHint,
      canCertify: false,
      certMenuLabel: "查看认证",
      canUpgrade: cert.certLevel === "card" && !getPendingCertSubmission("license"),
      certLevel: cert.certLevel || "card",
      verifiedAt: cert.statusTimeline && cert.statusTimeline.length
        ? cert.statusTimeline[cert.statusTimeline.length - 1].time
        : cert.createdAt
    })
  }

  if (cert.status === "已关闭" || cert.status === "已流失") {
    return Object.assign({}, base, {
      status: "rejected",
      statusText: "认证未通过",
      statusHint: "可修改资料后重新提交认证申请",
      canCertify: true,
      submittedAt: cert.createdAt
    })
  }

  return Object.assign({}, base, {
    status: "pending",
    statusText: "认证处理中",
    statusHint: "平台正在跟进你的认证申请",
    canCertify: false,
    submittedAt: cert.createdAt
  })
}

function getUserMineStats() {
  var submissions = getSubmissions()
  var resourceCount = 0
  var demandCount = 0
  var publishCount = 0

  submissions.forEach(function(item) {
    if (item.type === "resource") {
      resourceCount += 1
    }
    if (item.type === "demand" || item.type === "server") {
      demandCount += 1
    }
    if (item.listingId) {
      publishCount += 1
    }
  })

  return {
    resourceCount: resourceCount,
    demandCount: demandCount,
    recordCount: submissions.length,
    publishCount: publishCount
  }
}

function maskPhone(phone) {
  if (!phone || phone.length < 7) {
    return phone || "未填写"
  }
  return phone.slice(0, 3) + "****" + phone.slice(-4)
}

function resetAllPlatformData() {
  wx.removeStorageSync(submissionKey)
  wx.removeStorageSync(userProfileKey)
  wx.removeStorageSync(publishedResourcesKey)
  wx.removeStorageSync(publishedDemandsKey)
  wx.removeStorageSync(userCloudOwnListingsKey)
  wx.removeStorageSync(adminModule.adminSessionKey)
  wx.removeStorageSync(adminModule.adminModeKey)
  wx.removeStorageSync(viewedResourcesKey)
  wx.removeStorageSync(viewedDemandsKey)
  favorites.clearFavorites()
}

function ensureBlankPlatform() {
  if (isCloudEnabled()) {
    return false
  }
  var currentVersion = wx.getStorageSync(platformInitKey)
  if (currentVersion === platformBlankVersion) {
    return false
  }
  resetAllPlatformData()
  wx.setStorageSync(platformInitKey, platformBlankVersion)
  return true
}

function clearLocalData() {
  if (isCloudEnabled()) {
    userAuth.clearSession()
    exitAdminMode()
    clearUserPersonalCache()
    if (cloudStore.clearCloudLocalCache) {
      cloudStore.clearCloudLocalCache()
    }
    markPoolNeedsForceRefresh()
    resetLogoutGlobalFlags()
    updateMineTabBadge()
    return refreshAllPublicListings().then(function() {
      return { ok: true }
    }).catch(function(error) {
      return { ok: true, syncWarning: error.message || "缓存已清除，云端拉取失败" }
    })
  }
  resetAllPlatformData()
  clearShareIntent()
  userAuth.clearSession()
  exitAdminMode()
  markPoolNeedsForceRefresh()
  resetLogoutGlobalFlags()
  updateMineTabBadge()
  return Promise.resolve({ ok: true })
}

function formatDate(date) {
  function pad(value) {
    return value < 10 ? "0" + value : "" + value
  }
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes())
}

function requestConnectSubscribe(options) {
  return subscribeMessage.requestConnectSubscribe(options)
}

function getSubscribeSetupHint() {
  return subscribeMessage.getSetupHint()
}

module.exports = {
  getResources,
  getDemands,
  getItem,
  resolveListingForDetail,
  isResource,
  getStats,
  getBulletins,
  getProcessSteps,
  getCategories,
  getEnterpriseRegionOptions,
  getEnterpriseRoleOptions,
  getEnterpriseRoleDefault,
  getRegionOptions,
  normalizeEnterpriseRegion,
  normalizeEnterpriseRole,
  isValidEnterpriseRegion,
  validatePublishContactFields,
  countPendingPublishReviews,
  isValidEnterpriseRole,
  getSortOptions,
  getPoolSortOptions,
  countPoolDrawerFilters,
  getPoolCertFilterOptions,
  getPoolTimeFilterOptions,
  getPoolDeliveryKindFilterOptions,
  getPoolFavoriteFilterOptions,
  getResourceBrowseFilterOptions,
  getDemandBrowseFilterOptions,
  getPoolBrowseFilterOptions,
  filterPoolViewItems,
  isFavoriteListing,
  toggleFavoriteListing,
  canShareListingContent,
  getFavoriteIds,
  getFavoriteCount,
  promptFavoriteLogin,
  getListingDisplayCertBadge,
  getListingProxyBadge,
  attachListingDisplayBadges,
  resolveListingPublisherCertLevel,
  getStaffProxyClientLine,
  getStaffProxyDetailForm,
  normalizeListingScaleForServer,
  getStaffProxyClientCertHint,
  countActivePoolFilters,
  getSubmitFormPrefill,
  getRelatedMatches,
  getListingProductSearchKeyword,
  getMatchPickerRelatedBundle,
  sortItems,
  filterItems,
  saveSubmission,
  getSubmissions,
  getSubmission,
  getStatusHint,
  getSubmissionDisplayStatus,
  getSubmissionDisplayHint,
  getListingPublishTip,
  getListingPreviewButtonText,
  shouldShowListingButton,
  saveUserProfile,
  getUserProfile,
  getCertLevelOptions,
  getCertLevelConfig,
  isCloudMediaId,
  isLocalCertImagePath,
  validateCertImagesForSubmit,
  saveCertImage,
  getUserCertLevel,
  getPublisherCertBadge,
  getCertViewState,
  getApprovedCardCert,
  repairProfileCertStatus,
  repairStaffProxyToProxyConnects,
  buildConnectListingPreviewUrl,
  getConnectPreviewBackUrl,
  getConnectPreviewContext,
  getPendingCertSubmission,
  isCertPending,
  hasPendingCertApplication,
  getCertifyPageUrl,
  getCertifyRecordUrl,
  getCertifySubmissions,
  getCertReviewTimeline,
  getCertifyDetailRows,
  enrichCertifyForRecordsList,
  buildCertUpgradeFieldLocks,
  mergeCertDescription,
  getUserActiveDemands,
  getUserActiveResources,
  isResourceToDemandConnect,
  isOwnListing,
  isListingPublisher,
  isAuthorizedConnectParty,
  getListingPermissionContext,
  canApplyConnectToListing,
  canMatchToDemandListing,
  getMatchSubmitUrl,
  closeUserDemand,
  closeUserListing,
  canCloseListing,
  canToggleListingPublicDisplay,
  setListingPublicDisplay,
  isListingPrivateDisplay,
  isListingClosed,
  isListingPendingReview,
  isListingPubliclyVisible,
  canViewListingDetail,
  buildConnectReviewParties,
  buildConnectPartiesForView,
  buildStaffGlobalConnectView,
  getStaffGlobalConnectViews,
  getStaffGlobalConnectStats,
  filterStaffGlobalConnectViews,
  getUserConnectStatusFilterOptions,
  getUserListingStatusFilterOptions,
  getRecordStatusFilterOptions,
  filterConnectSubmissionsForRecordsList,
  filterListingSubmissionsForRecordsList,
  filterSubmissionsForRecordsStatus,
  getStaffGlobalConnectDetail,
  getStaffGlobalConnectRaw,
  refreshStaffGlobalConnectsFromCloud,
  getConnectDisplayHint,
  isConnectContactsExchanged,
  getUserCertSummary,
  getUserMineStats,
  getConnectRole,
  getConnectStageView,
  getConnectPendingSideView,
  getConnectPendingBadgeClass,
  isActiveConnectSubmission,
  getUserConnectSubmissionForTarget,
  findViewerConnectForListing,
  findBlockingConnectForApply,
  getBlockingConnectApplyMessage,
  canViewListingPublisherInfo,
  sanitizePublicListingFields,
  sanitizeListingForViewer,
  getConnectRecordActions,
  getConnectSubmissionsForListing,
  getListingLinkedConnectStats,
  enrichLinkedConnectItem,
  getPendingConnectNotice,
  getPendingRejectionNotice,
  getRejectionNoticeNavigateUrl,
  markRejectionNoticeRead,
  getStaffConnectActionQueue,
  updateMineTabBadge,
  getConnectConfirmPrecheck,
  getConnectExchangePrecheck,
  confirmConnectByRecipient,
  rejectConnectByRecipient,
  cancelConnectByApplicant,
  isApplicantWaitingForRecipient,
  setConnectExchangeConsent,
  switchUserAccount,
  maskPhone,
  maskCompany,
  isUserRegistered,
  hasFullProfile,
  getUserAccessLevel,
  hasLicenseCertification,
  canViewResourceAttachments,
  getListingAttachments,
  promptLicenseCertification,
  canViewFullListing,
  canApplyConnect,
  ensureConnectAccess,
  ensureMatchAccess,
  promptStaffCannotApplyConnect,
  requiresCardCertification,
  canSubmitListing,
  getListingCertGateCopy,
  ensureSubmitListingAccess,
  isUserPoolPublishBlocked,
  promptStaffUseProxyPublish,
  promptBusinessCertification,
  promptCardCertification,
  getMatchPercent,
  enrichListingForDisplay,
  getUserLevelBadge,
  getUserPermissions,
  getMineBusinessSummary,
  getMineCategoryStats,
  getMineCategorySummary,
  getMineCertBadgeClass,
  getListingVerifySteps,
  getListingPublisherInfo,
  isStaffPublisherOversight,
  isPlatformAdminPublisherOversight,
  shouldFetchStaffListingPublisher,
  shouldFetchPlatformAdminResourcePublisher,
  publisherInfoNeedsCloudFetch,
  fetchStaffListingPublisherInfoAsync,
  fetchPlatformAdminResourcePublisherInfoAsync,
  isPlatformAdminUser,
  getListingInfoGrid,
  buildListingViewLayout,
  buildListingPublicCopyText,
  buildListingKeyMetrics,
  getServerDeliveryKind,
  parseServerDeliveryTime,
  buildServerDeliveryTime,
  buildServerResourceTitle,
  resolveServerResourceDisplayTitle,
  getListingRegionLabel,
  getListingScaleLabel,
  getListingMoneyLabel,
  getListingCycleLabel,
  getConnectFlowTimeline,
  getPasswordStrength,
  formatRelativeTime,
  getRecordFilterCategory,
  getRecordTypeTag,
  getRecordStatusBadgeClass,
  getRecordCardTitle,
  getRecordSummaryLine,
  getRecordMiniTimeline,
  getRecordPublishTimeline,
  canCloseRecordFromList,
  getRecordDetailRows,
  enrichSubmissionForRecordsList,
  prepareListingForView,
  prepareListingListForView,
  markResourceViewed,
  isResourceViewed,
  markDemandViewed,
  isDemandViewed,
  prepareResourceListForView,
  prepareDemandListForView,
  getUserDisplayName,
  isDemandSubmitType,
  requiresRegistration,
  getRegistrationPromptContent,
  getDisclaimerContent,
  buildLegalPageUrl,
  getConnectSuccessRiskNotice,
  canViewSubmissionRecord,
  canViewConnectDisclosedContacts,
  getConnectDisclosedPartyViews,
  getConnectSuccessNextSteps,
  getHomeFeaturedListings,
  getHomeIntentCategories,
  getListingVerificationView,
  getListingReportReasonOptions,
  submitListingReportAsync,
  getSubmissionRejectionResubmitGuide,
  buildRegisterUrl,
  buildLoginUrl,
  resolveAuthGateFromCloud,
  navigateAuthGate,
  getLoginGateConfig,
  shouldShowLoginGateContext,
  getLoginHeroCopy,
  inferLoginGateActionFromRedirect,
  buildLoginGateUrl,
  buildAuthUrl,
  promptRegistration,
  navigateAfterRegister,
  navigateToPath,
  needsOnboarding,
  getUserIntentOptions,
  completeOnboarding,
  getIntentAction,
  getNextStepGuide,
  registerUser,
  clearLocalData,
  resetAllPlatformData,
  ensureBlankPlatform,
  getResourceTypeOptions,
  getDemandTypeOptions,
  getResourceTypeHint,
  getDemandTypeHint,
  getResourceTypeFilterChips,
  getDemandTypeFilterChips,
  isPublishType,
  isServerListingType,
  isPartsListingType,
  buildPartsResourceTitle,
  getResourceFormProfile,
  getDemandFormProfile,
  MAX_SUBMISSION_ATTACHMENTS,
  saveSubmissionAttachment,
  resolveSubmissionAttachments,
  canEditSubmissionAttachments,
  updateSubmissionAttachments,
  publishListing,
  updateSubmissionPublished,
  getAdminReviewQueue,
  getAdminReviewDetail,
  getAdminStats,
  getAdminHubStats,
  isProxyConnectReviewSubmission,
  getProxyConnectReviewQueue,
  getProxyConnectReviewSummary,
  ensureStaffAdminMode,
  getAccountMode,
  switchToStaffMode,
  switchToUserMode,
  syncStaffSessionOnLogin: function() {
    return adminModule.syncStaffSessionOnLogin()
  },
  getAdminSession,
  isStaffUser,
  isPlatformAdminUser,
  getStaffRoleLabel,
  isAdminModeActive,
  enterAdminMode,
  exitAdminMode,
  isAdminLoggedIn,
  getAdminLockStatus,
  loginAdmin,
  logoutAdmin,
  getAdminLoginHint,
  approveListingReview,
  rejectListingReview,
  isAccountDisabled,
  adminTakeDownListingAsync,
  adminSearchPublishedListingsAsync,
  adminLookupUserAsync,
  adminDisableAccountAsync,
  adminEnableAccountAsync,
  approveSubmissionReview,
  rejectSubmissionReview,
  isCloudEnabled,
  getCloudStatus,
  refreshFromCloud,
  refreshFromCloudForMine,
  refreshStaffWorkbenchFromCloud,
  refreshStaffLaunchFromCloud,
  refreshPublicListings,
  refreshAllPublicListings,
  refreshPoolPagesFromCloud,
  ensureOpenidBoundOnLaunch,
  validateDeviceSessionOnLaunch,
  getPublicListingsMeta,
  loadMorePublicListings,
  isPublicListingsServerFiltered,
  refreshFromCloudFull,
  refreshAdminFromCloud,
  DEMO_SEED_DEFAULT_COUNT,
  DEMO_SEED_CLEAR_COUNT,
  DEMO_SEED_START_PHONE,
  DEMO_SEED_PASSWORD,
  seedDemoDataAsync,
  clearDemoDataAsync,
  createSubmissionFlowAsync,
  createProxySubmissionFlowAsync,
  isStaffProxyListing,
  canStaffManageProxyListing,
  canStaffViewProxyListingConnects,
  getConnectRecipientPhone,
  canViewListingMatches,
  getStaffProxyListings,
  getStaffProxyListingViews,
  getStaffProxyHubStats,
  filterStaffProxyListingViews,
  findActiveConnectForListingPair,
  createStaffProxyMatchConnects,
  createStaffProxyMatchConnectsFromDemand,
  canProxyConnectDemandFromResource,
  getProxyResourceConnectPairState,
  buildProxyResourceConnectSubmitUrl,
  enrichDemandPoolItemForProxyConnect,
  enrichStaffProxyConnectFormFromResource,
  createOwnerDemandMatchConnects,
  createViewerDemandMatchConnects,
  createViewerResourceMatchConnects,
  createOwnerResourceMatchConnects,
  enrichStaffProxyMatchOptions,
  enrichStaffProxyMatchResourceOptions,
  enrichOwnerDemandMatchResourceOptions,
  enrichViewerResourceMatchDemandOptions,
  getResourcePoolVisibleItemsForMatch,
  getDemandPoolVisibleItemsForMatch,
  getOwnerDemandMatchResourceCandidates,
  getOwnerDemandMatchPickerBundle,
  buildOwnerDemandMatchPickerItems,
  getOwnerResourceMatchDemandCandidates,
  getOwnerResourceMatchPickerBundle,
  buildOwnerResourceMatchPickerItems,
  enrichOwnerResourceMatchDemandOptions,
  buildViewerResourceMatchPickerItems,
  buildManualMatchPickerItems,
  getManualMatchPool,
  registerUserAsync,
  loginUserAsync,
  changePasswordAsync,
  logoutUser,
  navigateAfterLogin,
  saveShareIntent,
  getShareIntent,
  clearShareIntent,
  isHomeGuideDismissed,
  dismissHomeGuide,
  getDetailPageUrl,
  isShareDetailLanding,
  isStaffProxyDetailLanding,
  canShowStaffProxyDetailOnDetailPage,
  getConnectSubmitUrl,
  getConnectApplyUrl,
  appendRedirectToUrl,
  resolveShareResumeUrl,
  formatDate,
  requestConnectSubscribe,
  getSubscribeSetupHint,
  ID_PREFIX: idFactory.ID_PREFIX,
  generateTradeId: idFactory.generateTradeId,
  generateResourceListingId: idFactory.generateResourceListingId,
  generateDemandListingId: idFactory.generateDemandListingId,
  generateConnectSubmissionId: idFactory.generateConnectSubmissionId,
  generateSubmissionId: idFactory.generateSubmissionId,
  getSubmissionIdPrefix: idFactory.getSubmissionIdPrefix,
  isResourceListingId: idFactory.isResourceListingId,
  isDemandListingId: idFactory.isDemandListingId,
  isConnectRecordId: idFactory.isConnectRecordId,
  getTradeIdTypeLabel: idFactory.getTradeIdTypeLabel,
  looksLikeTradeIdKeyword: idFactory.looksLikeTradeIdKeyword,
  itemMatchesTradeIdKeyword: idFactory.itemMatchesTradeIdKeyword,
  lookupTradeRecordById: lookupTradeRecordById,
  filterSubmissionsByKeyword: filterSubmissionsByKeyword,
  tryNavigateTradeIdSearch: tryNavigateTradeIdSearch
}
