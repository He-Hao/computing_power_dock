/**
 * 权限规则实现（口径见项目根目录 10_权限规则.md v1.13）
 *
 * 本模块负责：
 * - 「我的」页权限阶梯展示
 * - 单条商机权限上下文组装（供详情页等使用）
 *
 * 账号认证、对接记录查询等仍由 data/_core.js 提供底层数据。
 */

var admin = require("./admin")

/** 「我的」页权限项，按解锁顺序排列 */
var permissionCatalog = [
  { key: "browseDemands", text: "浏览需求池与详情", shortText: "浏览需求", step: 1 },
  { key: "browseResources", text: "浏览资源池与详情", shortText: "浏览资源", step: 2 },
  { key: "cardCert", text: "名片认证", shortText: "名片认证", step: 3 },
  { key: "submitDemand", text: "提交需求", shortText: "提交需求", step: 4 },
  { key: "submitResource", text: "发布资源", shortText: "发布资源", step: 5 },
  { key: "applyConnect", text: "申请对接 / 发起匹配", shortText: "申请对接", step: 6 },
  { key: "licenseCert", text: "营业执照认证", shortText: "执照认证", step: 7 },
  { key: "viewResourceAttachment", text: "查看资源附件", shortText: "资源附件", step: 8 },
  { key: "priorityRecommend", text: "优先推荐", shortText: "优先推荐", step: 9 }
]

var permissionMilestoneKeys = ["cardCert", "licenseCert"]

var unlockedByAccessLevel = {
  guest: {
    browseDemands: true,
    browseResources: true
  },
  basic: {
    browseDemands: true,
    browseResources: true
  },
  standard: {
    browseDemands: true,
    browseResources: true,
    cardCert: true,
    submitDemand: true,
    submitResource: true,
    applyConnect: true,
    viewResourceAttachment: true
  },
  verified: {
    browseDemands: true,
    browseResources: true,
    cardCert: true,
    licenseCert: true,
    submitDemand: true,
    submitResource: true,
    viewResourceAttachment: true,
    applyConnect: true,
    priorityRecommend: true
  }
}

function buildPermissionRows(accessLevel) {
  var accessKey = accessLevel === "verified"
    ? "verified"
    : (accessLevel === "standard"
      ? "standard"
      : (accessLevel === "guest" ? "guest" : "basic"))
  var unlocked = unlockedByAccessLevel[accessKey] || unlockedByAccessLevel.basic
  var rows = permissionCatalog.map(function(item) {
    var isUnlocked = !!unlocked[item.key]
    return {
      key: item.key,
      text: item.shortText || item.text,
      step: item.step,
      unlocked: isUnlocked,
      locked: !isUnlocked
    }
  })
  if (accessKey === "guest") {
    return rows.filter(function(item) {
      return item.key === "browseDemands" || item.key === "browseResources"
    })
  }
  if (accessKey === "verified") {
    return rows.filter(function(item) {
      return permissionMilestoneKeys.indexOf(item.key) === -1
    })
  }
  if (accessKey === "standard") {
    return rows.filter(function(item) {
      return item.key !== "cardCert"
    })
  }
  return rows
}

/**
 * 组装单条商机的权限上下文（详情页、附件、底栏等统一引用）
 */
function buildListingPermissionContext(listingId, deps) {
  deps = deps || {}
  var isResourceListing = !!deps.isResource
  var isGuest = !!deps.isGuest
  var isPublisher = !!deps.isPublisher
  var isStaffProxyManager = !!deps.isStaffProxyManager
  var isStaffProxyViewer = !!deps.isStaffProxyViewer
  var isStaffUser = !!deps.isStaffUser
  var isClosed = !!deps.isClosed
  var isMatchPreview = !!deps.isMatchPreview
  var isConnectPreview = !!deps.isConnectPreview
  var isListingPreview = isMatchPreview || isConnectPreview
  var canApplyConnect = !!deps.canApplyConnect
  var canViewPublisherInfo = !!deps.canViewPublisherInfo
  var canClose = !!deps.canClose

  var canManageListing = !isListingPreview && (isPublisher || isStaffProxyManager || isStaffProxyViewer)
  var canViewOwnerMatches = !isListingPreview && (isPublisher || isStaffProxyManager)
  // 运营账号默认不在详情页勾选；负责该代发商机的运营仍可在商机管理区替客户匹配
  var canShowMatchPicker = !isClosed && !isListingPreview && !isGuest
    && (!isStaffUser || isStaffProxyManager)

  var matchPickerMode = ""
  if (isStaffProxyManager && canViewOwnerMatches && canShowMatchPicker) {
    matchPickerMode = isResourceListing ? "staffResource" : "staffDemand"
  } else if (isPublisher && canViewOwnerMatches && canShowMatchPicker) {
    matchPickerMode = isResourceListing ? "ownerResource" : "ownerDemand"
  }
  // 路人不在详情页勾选：资源详情走 resource-connect 选需求；需求详情走对接表单选资源

  var showMatchPickerSection = !!matchPickerMode
  var showProxyMatchSection = showMatchPickerSection && (matchPickerMode === "staffResource" || matchPickerMode === "staffDemand")
  var showOwnerMatchSection = showMatchPickerSection && !showProxyMatchSection

  var showMatchPicker = showOwnerMatchSection && isPublisher
  var showViewerMatchPicker = showOwnerMatchSection && !isPublisher

  var showBottomBar = !isListingPreview
    && !isPublisher
    && !isStaffProxyManager
    && !isStaffUser
    && !showMatchPickerSection

  return {
    listingId: listingId,
    isResource: isResourceListing,
    isGuest: isGuest,
    isPublisher: isPublisher,
    isStaffProxyManager: isStaffProxyManager,
    isStaffProxyViewer: isStaffProxyViewer,
    isStaffUser: isStaffUser,
    isClosed: isClosed,
    isMatchPreview: isMatchPreview,
    isConnectPreview: isConnectPreview,
    isListingPreview: isListingPreview,
    canViewPublisherInfo: canViewPublisherInfo,
    canManageListing: canManageListing,
    canViewOwnerMatches: canViewOwnerMatches,
    canCloseListing: (isPublisher || isStaffProxyManager) && canClose,
    showMatchPicker: showMatchPicker,
    showViewerMatchPicker: showViewerMatchPicker,
    showMatchPickerSection: showMatchPickerSection,
    showProxyMatchSection: showProxyMatchSection,
    showOwnerMatchSection: showOwnerMatchSection,
    showBottomBar: showBottomBar,
    matchPickerMode: matchPickerMode,
    canApplyConnectToListing: !isPublisher && !isStaffUser && canApplyConnect && isResourceListing && !isClosed,
    canMatchToListing: !isPublisher && !isStaffUser && canApplyConnect && !isResourceListing && !isClosed,
    hideFromPublicPool: isPublisher,
    showPoolMineTag: isPublisher
  }
}

function isStaffAccount() {
  return admin.isStaffUser()
}

/** 已登录即可收藏（访客引导登录） */
function canFavoriteContent(isRegistered) {
  return !!isRegistered
}

/** 已登录即可分享商机（访客不可用分享菜单） */
function canShareContent(isRegistered) {
  return !!isRegistered
}

/** 详情页「分享给好友对接/匹配」：公开展示商机均可转发，访客无需登录 */
function canShareConnectInviteOnDetail(deps) {
  deps = deps || {}
  if (!deps.hasListing || deps.isListingPreview) {
    return false
  }
  if (deps.isPublisher || deps.isStaffProxyView) {
    return false
  }
  return true
}

/**
 * 资源附件可见性（见 10_权限规则.md §5.3）
 * 发布方 / 代发运营始终可见；路人需名片或执照认证；已授权对接方与路人同口径。
 */
function canViewResourceAttachmentsForListing(options) {
  options = options || {}
  if (options.isStaffProxyView || options.isPublisher || options.isListingPublisher) {
    return true
  }
  return !!(options.hasBusinessCert || options.hasLicenseCert)
}

/** 需求附件永不公开展示 */
function canViewDemandAttachmentsForListing(options) {
  options = options || {}
  return !!(options.isPublisher || options.isListingPublisher || options.isStaffProxyView || options.forAdmin)
}

/**
 * 详情页是否展示发布方/需求方卡片（口径见 10_权限规则.md §5.2）
 * 访客永不展示；普通用户发布方仅管理员/本人/已授权对接方可进入卡片逻辑。
 */
function canShowPublisherBlockOnDetail(deps) {
  deps = deps || {}
  if (deps.isGuest || !deps.isLoggedIn) {
    return false
  }
  if (deps.isStaffProxyView) {
    return false
  }
  if (deps.isPublisher) {
    return true
  }
  if (deps.isPlatformAdmin && deps.platformAdminOversight) {
    return true
  }
  return !!deps.isAuthorizedConnectParty
}

/** 发布方卡片内是否展示联系人/手机号（交换前不对路人/管理员以外开放） */
function canShowPublisherFullContact(deps) {
  deps = deps || {}
  if (deps.isPublisher) {
    return true
  }
  if (deps.isPlatformAdmin && deps.platformAdminOversight) {
    return true
  }
  return !!deps.contactsExchanged
}

module.exports = {
  permissionCatalog: permissionCatalog,
  buildPermissionRows: buildPermissionRows,
  buildListingPermissionContext: buildListingPermissionContext,
  isStaffAccount: isStaffAccount,
  canFavoriteContent: canFavoriteContent,
  canShareContent: canShareContent,
  canShareConnectInviteOnDetail: canShareConnectInviteOnDetail,
  canViewResourceAttachmentsForListing: canViewResourceAttachmentsForListing,
  canViewDemandAttachmentsForListing: canViewDemandAttachmentsForListing,
  canShowPublisherBlockOnDetail: canShowPublisherBlockOnDetail,
  canShowPublisherFullContact: canShowPublisherFullContact
}
