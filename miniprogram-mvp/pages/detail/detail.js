function getStaffProxyMatchSubmitLabel(mode, count) {
  var selectedCount = count || 0
  var base = (mode === "staffResource" || mode === "staffDemand")
    ? "提交对接申请"
    : ((mode === "viewerResource" || mode === "ownerDemand") ? "申请对接" : "发起匹配")
  return selectedCount > 0 ? base + "（" + selectedCount + "）" : base
}

function isDemandMatchResourceMode(mode) {
  return mode === "staffDemand" || mode === "ownerDemand" || mode === "viewerDemand"
}

function isResourceSideMatchPickerMode(mode) {
  return mode === "staffResource" || mode === "ownerResource" || mode === "viewerResource"
}

Page({
  _detailCloudRefreshing: false,
  _lastDetailCloudRefresh: 0,
  _matchSearchDefaultApplied: false,
  _detailLoadSettled: false,
  _detailLoadFailed: false,

  data: {
    item: null,
    itemId: "",
    detailLoading: false,
    isResource: false,
    blocked: false,
    isGuest: false,
    connectText: "申请对接",
    connectRecordId: "",
    connectRecordStatus: "",
    isOwnListing: false,
    isPublisher: false,
    canCloseListing: false,
    canTogglePublicDisplay: false,
    listingPublicDisplay: true,
    publicDisplayLoading: false,
    canAdminTakeDown: false,
    closeListingLabel: "关闭此商机",
    linkedConnects: [],
    linkedConnectPending: 0,
    relatedItems: [],
    detailHighlights: [],
    listingLayout: null,
    publisherInfo: null,
    showBottomBar: true,
    canShareConnectInvite: false,
    shareConnectLabel: "",
    hasListingAttachments: false,
    canViewAttachments: false,
    listingAttachments: [],
    fromShare: false,
    displayCertBadge: null,
    displayProxyBadge: null,
    isFavorited: false,
    isStaffProxyView: false,
    proxyClientLine: "",
    proxyClientCertHint: "",
    matchAnchor: "",
    isMatchPreview: false,
    matchAnchorTitle: "",
    connectId: "",
    connectFrom: "",
    isConnectPreview: false,
    connectPreviewTitle: "",
    showStaffMatchPicker: false,
    showMatchPicker: false,
    matchPickerMode: "",
    matchPickerItems: [],
    selectedMatchIds: [],
    selectedMatchCount: 0,
    staffMatchSubmitting: false,
    canManageListing: false,
    matchPickerTitle: "",
    matchPickerEmptyTip: "",
    matchPickerExpanded: false,
    matchPickerHasMore: false,
    matchPickerTotal: 0,
    matchPickerMoreCount: 0,
    matchPickerView: "smart",
    matchPickerHasSmart: false,
    matchManualKeyword: "",
    matchManualSearchPlaceholder: "搜索标题、类型、地区...",
    matchPickerSideLabel: "需求",
    isProxyResourceConnectPicker: false,
    isProxyDemandConnectPicker: false,
    showViewerMatchPicker: false,
    showProxyMatchSection: false,
    showMatchPickerSection: false,
    showOwnerMatchSection: false,
    showProxyStaffBottomBar: false,
    isStaffProxyManager: false,
    proxyClientForm: null,
    matchSubmitDisabled: true,
    matchSubmitLabel: "提交对接申请",
    canShowDemandMatchAction: false,
    closeListingLoading: false,
    adminTakeDownLoading: false,
    verificationView: null,
    canReportListing: false,
    reportLoading: false
  },

  resolvePageOptions() {
    const share = require("../../utils/share")
    this.options = share.mergePageLaunchOptions(this.options || {})
    return this.options
  },

  onLoad(options) {
    this.options = options || {}
    this._matchSearchDefaultApplied = false
    this._detailLoadSettled = false
    this._detailLoadFailed = false
    this.resolvePageOptions()
    this.setData({
      matchPickerExpanded: this.options.matchExpanded === "1",
      matchPickerView: "smart",
      matchManualKeyword: "",
      selectedMatchIds: [],
      selectedMatchCount: 0
    })
    const data = require("../../utils/data")
    const share = require("../../utils/share")
    var pageOptions = this.options
    if (pageOptions.id && (pageOptions.from === "ops-proxy" || pageOptions.from === "staff-proxy")) {
      data.clearShareIntent()
    }
    if (pageOptions.id && pageOptions.from === "share") {
      data.saveShareIntent({
        listingId: pageOptions.id,
        action: "view",
        isResource: data.isResource(pageOptions.id),
        source: "share"
      })
    }
    this.loadDetail()
    if (data.isCloudEnabled()
      && pageOptions.id
      && (pageOptions.from === "share" || share.isGuestCloudLaunch())) {
      this.refreshDetailFromCloud(false)
    }
  },

  onShow() {
    this.resolvePageOptions()
    const data = require("../../utils/data")
    this.loadDetail()
    if (!data.isCloudEnabled()) {
      return
    }
    var options = this.options || {}
    var isOwnDemandDetail = options.id
      && !data.isResource(options.id)
      && data.isListingPublisher(options.id)
    var now = Date.now()
    if (!isOwnDemandDetail
      && (this._detailCloudRefreshing || now - this._lastDetailCloudRefresh < 12000)) {
      return
    }
    this.refreshDetailFromCloud(false)
  },

  refreshDetailFromCloud(force) {
    const data = require("../../utils/data")
    const share = require("../../utils/share")
    var options = this.resolvePageOptions()
    this.loadDetail()
    if (!data.isCloudEnabled()) {
      return Promise.resolve()
    }
    if (!force && this._detailCloudRefreshing) {
      return Promise.resolve()
    }
    this._detailCloudRefreshing = true
    var fromShare = data.isShareDetailLanding(options.id, options) || share.isGuestCloudLaunch()
    var rawListing = data.resolveListingForDetail(options.id, {
      from: options.from,
      connectId: options.connectId || ""
    })
    var isConnectPreview = options.from === "connect-preview" && !!(options.connectId && options.id)
    var refreshPromise
    if (fromShare && options.id && (!rawListing || force)) {
      refreshPromise = data.fetchPublicListingById(options.id, { silent: true })
    } else if (options.from === "ops-connect" && data.isStaffWorkMode()) {
      refreshPromise = data.refreshStaffGlobalConnectsFromCloud()
    } else if (isConnectPreview && !rawListing) {
      refreshPromise = data.refreshFromCloudForMine()
    } else if (data.isStaffWorkMode() && rawListing && rawListing.publishedByStaff) {
      refreshPromise = data.refreshFromCloudForMine()
    } else {
      refreshPromise = data.refreshPoolPagesFromCloud()
    }
    return refreshPromise.then(function() {
      this._detailLoadSettled = true
      this._detailLoadFailed = false
      this._lastDetailCloudRefresh = Date.now()
      this.loadDetail()
    }.bind(this)).catch(function() {
      this._detailLoadSettled = true
      this._detailLoadFailed = true
      this.loadDetail()
    }.bind(this)).finally(function() {
      this._detailCloudRefreshing = false
    }.bind(this))
  },

  onPullDownRefresh() {
    this.refreshDetailFromCloud(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  shouldAutoFillMatchSearchKeyword(mode) {
    return isDemandMatchResourceMode(mode) || isResourceSideMatchPickerMode(mode)
  },

  getDefaultMatchSearchKeyword(listingId, mode) {
    if (!this.shouldAutoFillMatchSearchKeyword(mode)) {
      return ""
    }
    const data = require("../../utils/data")
    return data.getListingProductSearchKeyword(listingId) || ""
  },

  getMatchManualSearchPlaceholder(mode, keyword) {
    if (isDemandMatchResourceMode(mode)) {
      return keyword ? ("搜索资源，已带入「" + keyword + "」") : "搜索资源，将自动带入需求产品"
    }
    if (isResourceSideMatchPickerMode(mode)) {
      return keyword ? ("搜索需求，已带入「" + keyword + "」") : "搜索需求，将自动带入资源产品"
    }
    return "搜索标题、类型、地区..."
  },

  buildMatchPickerState(data, listingId, mode, isResourceListing) {
    var matchPickerExpanded = !!this.data.matchPickerExpanded
    var matchLimit = matchPickerExpanded ? 20 : 3
    var selectedIds = this.data.selectedMatchIds || []
    var keyword = String(this.data.matchManualKeyword || "").trim()
    var smartItems = []
    var matchPickerTotal = 0
    var matchPickerHasMore = false
    var matchPickerMoreCount = 0

    if (mode === "ownerDemand") {
      smartItems = data.buildOwnerDemandMatchPickerItems(listingId, matchLimit, selectedIds)
      var ownerDemandBundle = data.getOwnerDemandMatchPickerBundle(listingId, matchPickerExpanded)
      matchPickerTotal = ownerDemandBundle.total
      matchPickerHasMore = ownerDemandBundle.hasMore && !matchPickerExpanded
      matchPickerMoreCount = matchPickerHasMore ? ownerDemandBundle.total - 3 : 0
    } else if (mode === "viewerDemand") {
      smartItems = data.buildOwnerDemandMatchPickerItems(listingId, matchLimit, selectedIds)
      var viewerDemandBundle = data.getMatchPickerRelatedBundle(listingId, matchPickerExpanded)
      matchPickerTotal = viewerDemandBundle.total
      matchPickerHasMore = viewerDemandBundle.hasMore && !matchPickerExpanded
      matchPickerMoreCount = matchPickerHasMore ? viewerDemandBundle.total - 3 : 0
    } else if (mode === "viewerResource") {
      smartItems = data.buildViewerResourceMatchPickerItems(listingId, matchLimit, selectedIds)
      var viewerResourceBundle = data.getMatchPickerRelatedBundle(listingId, matchPickerExpanded)
      matchPickerTotal = viewerResourceBundle.total
      matchPickerHasMore = viewerResourceBundle.hasMore && !matchPickerExpanded
      matchPickerMoreCount = matchPickerHasMore ? viewerResourceBundle.total - 3 : 0
    } else if (mode === "ownerResource") {
      smartItems = data.buildOwnerResourceMatchPickerItems(listingId, matchLimit, selectedIds)
      var ownerResourceBundle = data.getOwnerResourceMatchPickerBundle(listingId, matchPickerExpanded)
      matchPickerTotal = ownerResourceBundle.total
      matchPickerHasMore = ownerResourceBundle.hasMore && !matchPickerExpanded
      matchPickerMoreCount = matchPickerHasMore ? ownerResourceBundle.total - 3 : 0
    } else {
      var matchBundle = data.getMatchPickerRelatedBundle(listingId, matchPickerExpanded)
      var relatedRaw = matchBundle.displayRelated
      matchPickerTotal = matchBundle.total
      matchPickerHasMore = matchBundle.hasMore && !matchPickerExpanded
      matchPickerMoreCount = matchPickerHasMore ? matchBundle.total - 3 : 0
      var relatedItems = relatedRaw
      if (relatedItems.length) {
        relatedItems = isResourceListing
          ? data.prepareDemandListForView(relatedItems)
          : data.prepareResourceListForView(relatedItems)
      }
      if (isResourceSideMatchPickerMode(mode)) {
        smartItems = mode === "viewerResource"
          ? data.enrichViewerResourceMatchDemandOptions(listingId, relatedItems, selectedIds)
          : data.enrichStaffProxyMatchOptions(listingId, relatedItems, selectedIds)
      } else if (mode === "staffDemand") {
        smartItems = data.enrichStaffProxyMatchResourceOptions(listingId, relatedItems, selectedIds)
      }
    }

    var matchPickerHasSmart = smartItems.length > 0
    var matchPickerView = this.data.matchPickerView || "smart"
    if (!matchPickerHasSmart) {
      matchPickerView = "manual"
    } else if (matchPickerView !== "manual" && matchPickerView !== "smart") {
      matchPickerView = "smart"
    }

    var matchPickerItems = smartItems
    var matchPickerTitle = "智能匹配推荐"
    var matchPickerEmptyTip = this.getMatchPickerEmptyTip(mode, "smart")

    if (matchPickerView === "manual") {
      matchPickerItems = data.buildManualMatchPickerItems(listingId, mode, {
        selectedIds: selectedIds,
        keyword: keyword
      })
      matchPickerTitle = mode === "staffResource" ? "搜索需求" : "手工匹配"
      matchPickerEmptyTip = this.getMatchPickerEmptyTip(mode, "manual")
      matchPickerHasMore = false
      matchPickerMoreCount = 0
    } else if (mode === "staffResource" || mode === "ownerResource" || mode === "viewerResource") {
      matchPickerTitle = mode === "viewerResource" ? "关联已发布需求" : (mode === "ownerResource" ? "匹配需求" : "推荐需求")
    } else if (mode === "staffDemand") {
      matchPickerTitle = "推荐资源"
    } else if (mode === "ownerDemand") {
      matchPickerTitle = "匹配资源"
    } else if (mode === "viewerDemand") {
      matchPickerTitle = "我有匹配资源"
    }

    return {
      matchPickerItems: matchPickerItems,
      matchPickerTitle: matchPickerTitle,
      matchPickerEmptyTip: matchPickerEmptyTip,
      matchPickerHasMore: matchPickerHasMore,
      matchPickerTotal: matchPickerTotal,
      matchPickerMoreCount: matchPickerMoreCount,
      matchPickerHasSmart: matchPickerHasSmart,
      matchPickerView: matchPickerView,
      matchManualKeyword: keyword,
      matchManualSearchPlaceholder: this.getMatchManualSearchPlaceholder(mode, keyword)
    }
  },

  getMatchPickerEmptyTip(mode, view) {
    var sideLabel = isResourceSideMatchPickerMode(mode) ? "需求" : "资源"
    if (mode === "staffResource") {
      return view === "manual" ? "未找到匹配需求，请换关键词" : "暂无推荐需求"
    }
    if (mode === "staffDemand") {
      return view === "manual" ? "未找到匹配资源，请换关键词" : "暂无推荐资源"
    }
    if (view === "manual") {
      if (mode === "ownerDemand") {
        return "资源池中没有符合搜索条件的资源；请调整搜索词。"
      }
      if (mode === "ownerResource") {
        return "需求池中没有符合搜索条件的需求；请调整搜索词。"
      }
      if (isDemandMatchResourceMode(mode)) {
        return "暂无可勾选的已发布资源；请调整搜索词，或先发布资源后再发起匹配。"
      }
      if (mode === "viewerResource") {
        return "暂无可勾选的已发布需求；请调整搜索词，或先提交需求后再申请对接。"
      }
      if (isResourceSideMatchPickerMode(mode)) {
        return "没有符合搜索条件的公开" + sideLabel + "；请换个关键词，或确认公开展示池中有可对接" + sideLabel + "。"
      }
      return "没有符合搜索条件的" + sideLabel + "，请换个关键词试试。"
    }
    if (mode === "ownerDemand") {
      return "暂无资源池中的可对接资源；可在下方搜索并勾选资源申请对接。"
    }
    if (isDemandMatchResourceMode(mode)) {
      return "暂无智能推荐资源；可在下方搜索并勾选你已发布的资源，或先发布资源后再匹配。"
    }
    if (mode === "viewerResource") {
      return "暂无推荐需求；可在下方搜索并勾选你已发布的需求，或先提交需求后再申请对接。"
    }
    if (mode === "ownerResource") {
      return "暂无需求池中的可对接需求；可在下方搜索并勾选需求发起匹配。"
    }
    return "暂无智能推荐；可在下方搜索并手工勾选公开" + sideLabel + "发起匹配。"
  },

  refreshMatchPickerItems() {
    const data = require("../../utils/data")
    if (!this.data.showMatchPickerSection || !this.data.itemId || !this.data.matchPickerMode) {
      return
    }
    var bundle = this.buildMatchPickerState(
      data,
      this.data.itemId,
      this.data.matchPickerMode,
      this.data.isResource
    )
    this.setData({
      matchPickerItems: bundle.matchPickerItems,
      matchPickerTitle: bundle.matchPickerTitle,
      matchPickerEmptyTip: bundle.matchPickerEmptyTip,
      matchPickerHasMore: bundle.matchPickerHasMore,
      matchPickerTotal: bundle.matchPickerTotal,
      matchPickerMoreCount: bundle.matchPickerMoreCount,
      matchPickerHasSmart: bundle.matchPickerHasSmart,
      matchPickerView: bundle.matchPickerView,
      matchManualKeyword: bundle.matchManualKeyword,
      matchManualSearchPlaceholder: bundle.matchManualSearchPlaceholder
    })
  },

  toggleMatchPickerView() {
    if (!this.data.matchPickerHasSmart) {
      return
    }
    var nextView = this.data.matchPickerView === "manual" ? "smart" : "manual"
    var keyword = String(this.data.matchManualKeyword || "").trim()
    if (nextView === "manual" && !keyword) {
      keyword = this.getDefaultMatchSearchKeyword(this.data.itemId, this.data.matchPickerMode)
      if (keyword) {
        this._matchSearchDefaultApplied = true
      }
    }
    this.setData({
      matchPickerView: nextView,
      matchManualKeyword: keyword,
      matchManualSearchPlaceholder: this.getMatchManualSearchPlaceholder(this.data.matchPickerMode, keyword)
    }, function() {
      this.refreshMatchPickerItems()
    }.bind(this))
  },

  onManualMatchSearch(event) {
    this.setData({ matchManualKeyword: event.detail.value || "" }, function() {
      if (this.data.matchPickerView === "manual") {
        this.refreshMatchPickerItems()
      }
    }.bind(this))
  },

  loadDetail() {
    var options = this.resolvePageOptions()
    try {
      const data = require("../../utils/data")
      const share = require("../../utils/share")
      const isAdmin = data.isAdminLoggedIn()
      const isGuest = !data.isUserRegistered() && !isAdmin
      const isResource = data.isResource(options.id)
      const fromShare = data.isShareDetailLanding(options.id, options) || share.isGuestCloudLaunch()
      const isStaffOversight = options.from === "ops-connect" && data.isStaffUser() && data.isStaffWorkMode()
      var connectId = options.connectId || ""
      var connectFrom = options.connectFrom || ""
      var isConnectPreview = options.from === "connect-preview" && !!connectId && !!options.id
      var connectPreviewContext = isConnectPreview ? data.getConnectPreviewContext(connectId) : null

      const rawItem = data.resolveListingForDetail(options.id, {
        from: options.from,
        connectId: connectId
      })
      var matchAnchor = options.matchAnchor || ""
      var isMatchPreview = !!(matchAnchor && options.id && matchAnchor !== options.id)
      var perm = data.getListingPermissionContext(options.id, {
        isGuest: isGuest,
        isMatchPreview: isMatchPreview,
        isConnectPreview: isConnectPreview
      })
      var isPublisher = perm.isPublisher
      var isStaffProxyView = data.canShowStaffProxyDetailOnDetailPage(options.id, options)
      var isOwnListing = isPublisher || isStaffProxyView
      var canViewMatches = perm.canViewOwnerMatches
      if (canViewMatches && !matchAnchor) {
        matchAnchor = options.id || ""
      }
      var matchAnchorItem = isMatchPreview && matchAnchor ? data.resolveListingForDetail(matchAnchor) : null
      var showMatches = canViewMatches && !isMatchPreview && !isConnectPreview
      var sourceListingClosed = perm.isClosed
      var showMatchPicker = perm.showMatchPicker
      var showViewerMatchPicker = perm.showViewerMatchPicker
      var canManageListing = perm.canManageListing
      if (fromShare && perm.isStaffUser) {
        canManageListing = false
      } else if (perm.isStaffProxyManager && !isStaffProxyView) {
        canManageListing = false
      }
      var showProxyStaffBottomBar = perm.isStaffProxyManager && canManageListing && !fromShare
      var showMatchPickerSection = perm.showMatchPickerSection
      var showOwnerMatchSection = perm.showOwnerMatchSection
      var showProxyMatchSection = perm.showProxyMatchSection && showProxyStaffBottomBar
      var matchPickerMode = perm.matchPickerMode
      var matchPickerSideLabel = isResourceSideMatchPickerMode(matchPickerMode) ? "需求" : "资源"
      var showStaffMatchPicker = matchPickerMode === "staffDemand"
      var matchPickerBundle = showMatchPickerSection
        ? this.buildMatchPickerState(data, options.id, matchPickerMode, isResource)
        : {
          matchPickerItems: [],
          matchPickerTitle: "",
          matchPickerEmptyTip: "",
          matchPickerHasMore: false,
          matchPickerTotal: 0,
          matchPickerMoreCount: 0,
          matchPickerHasSmart: false,
          matchPickerView: "smart"
        }
      if (showMatchPickerSection
        && matchPickerBundle.matchPickerView === "manual"
        && !String(this.data.matchManualKeyword || "").trim()
        && !this._matchSearchDefaultApplied) {
        var defaultMatchKeyword = this.getDefaultMatchSearchKeyword(options.id, matchPickerMode)
        if (defaultMatchKeyword) {
          this._matchSearchDefaultApplied = true
          this.data.matchManualKeyword = defaultMatchKeyword
          matchPickerBundle = this.buildMatchPickerState(data, options.id, matchPickerMode, isResource)
        }
      }
      if (rawItem && !data.canViewListingDetail(rawItem, {
        isPublisher: isPublisher,
        isListingPublisher: isPublisher,
        isStaffProxyManager: isStaffProxyView,
        isStaffProxyView: isStaffProxyView,
        isStaffOversight: isStaffOversight,
        isConnectPreview: isConnectPreview,
        connectId: connectId
      })) {
        this.setData({
          item: null,
          itemId: options.id || "",
          blocked: false,
          isResource: isResource,
          isGuest: isGuest
        })
        return
      }
      if (isResource && options.id && rawItem) {
        data.markResourceViewed(options.id)
      } else if (!isResource && options.id && rawItem) {
        data.markDemandViewed(options.id)
      }
      const item = isAdmin
        ? data.enrichListingForDisplay(rawItem)
        : data.prepareListingForView(rawItem, {
          isListingPublisher: isPublisher,
          isStaffProxyView: isStaffProxyView,
          isStaffProxyManager: isStaffProxyView
        })
      var relatedItems = []
      if (rawItem && showMatches && matchPickerBundle.matchPickerView === "smart") {
        var matchPickerExpanded = !!this.data.matchPickerExpanded
        var matchBundle = data.getMatchPickerRelatedBundle(options.id, matchPickerExpanded)
        relatedItems = matchBundle.displayRelated
        if (relatedItems.length) {
          relatedItems = isResource
            ? data.prepareDemandListForView(relatedItems)
            : data.prepareResourceListForView(relatedItems)
        }
      }
      var canCloseListing = rawItem && perm.canCloseListing
      var canTogglePublicDisplay = rawItem
        && !isMatchPreview
        && !isConnectPreview
        && !isStaffOversight
        && (isPublisher || isStaffProxyView)
        && data.canToggleListingPublicDisplay(options.id)
      var listingPublicDisplay = rawItem ? rawItem.publicDisplay !== false : true
      var canAdminTakeDown = rawItem
        && data.isPlatformAdminUser()
        && !isMatchPreview
        && !isConnectPreview
        && !data.isListingClosed(rawItem)
      var closeListingLabel = isResource ? "关闭此资源" : "关闭此需求"
      var selectedMatchCount = this.data.selectedMatchCount || 0
      var matchSubmitDisabled = selectedMatchCount === 0 || !!this.data.staffMatchSubmitting
      var matchSubmitLabel = getStaffProxyMatchSubmitLabel(matchPickerMode, selectedMatchCount)
      var proxyClientLine = ""
      var proxyClientCertHint = ""
      var proxyClientForm = null
      if (isStaffProxyView && rawItem) {
        proxyClientLine = data.getStaffProxyClientLine(rawItem)
        proxyClientCertHint = data.getStaffProxyClientCertHint(rawItem)
        proxyClientForm = data.getStaffProxyDetailForm(rawItem)
      }
      var existingConnect = null
      if (rawItem && !isPublisher && !isStaffProxyView && data.isUserRegistered()) {
        existingConnect = data.findViewerConnectForListing(options.id)
      }
      var connectRecordId = existingConnect ? existingConnect.id : ""
      var connectRecordStatus = existingConnect ? data.getSubmissionDisplayStatus(existingConnect) : ""
      var connectText = connectRecordId
        ? "查看申请进度"
        : isResource
          ? (isGuest
            ? "登录后申请对接"
            : (data.isStaffUser()
              ? "运营请使用代发"
              : (data.isUserRegistered() && !data.canSubmitListing()
                ? "认证后申请对接"
                : "申请对接")))
          : (isGuest
            ? "登录后申请对接"
            : (data.isStaffUser()
              ? "运营请使用代发"
              : (data.isUserRegistered() && !data.canSubmitListing()
                ? "认证后申请对接"
                : "申请对接")))
      var attachmentState = {
        hasListingAttachments: false,
        canViewAttachments: false,
        listingAttachments: []
      }
      if (isResource && rawItem) {
        var attachmentMeta = data.getListingAttachments(rawItem, {
          isPublisher: isPublisher,
          isListingPublisher: isPublisher,
          isStaffProxyView: isStaffProxyView
        })
        attachmentState.hasListingAttachments = attachmentMeta.hasAttachments
        attachmentState.canViewAttachments = attachmentMeta.canView
        if (attachmentMeta.hasAttachments && attachmentMeta.canView) {
          data.resolveSubmissionAttachments(attachmentMeta.attachments).then(function(resolved) {
            this.setData({ listingAttachments: resolved || [] })
          }.bind(this)).catch(function() {
            this.setData({ listingAttachments: attachmentMeta.attachments || [] })
          }.bind(this))
        }
      }
      var publisherViewOptions = {
        isListingPublisher: isPublisher,
        isStaffProxyView: isStaffProxyView,
        forPlatformAdmin: data.isPlatformAdminUser() && !fromShare,
        fromShare: fromShare
      }
      var publisherInfo = rawItem ? data.getListingPublisherInfo(rawItem, publisherViewOptions) : null
      var listingLayout = item ? data.buildListingViewLayout(item, isResource, {
        includePublisherSpecFields: !!(publisherInfo || isPublisher || isStaffProxyView),
        forDetail: true
      }) : null

      var linkedConnectStats = (isPublisher || isStaffProxyView) && rawItem && !isMatchPreview && !isConnectPreview
        ? data.getListingLinkedConnectStats(options.id)
        : { count: 0, pending: 0, connects: [] }
      var showBottomBar = perm.showBottomBar
      const permissions = require("../../utils/permissions")
      var canShareConnectInvite = permissions.canShareConnectInviteOnDetail({
        hasListing: !!rawItem,
        isPublisher: isPublisher,
        isStaffProxyView: isStaffProxyView,
        isListingPreview: isMatchPreview || isConnectPreview
      })
      if (canShareConnectInvite || data.canShareListingContent()) {
        share.enableShareMenus()
      } else if (wx.hideShareMenu) {
        wx.hideShareMenu()
      }

      wx.setNavigationBarTitle({
        title: isMatchPreview
          ? "匹配预览"
          : (isConnectPreview
            ? "对接预览"
            : (isStaffOversight ? (isResource ? "资源预览" : "需求预览") : (isResource ? "资源详情" : "需求详情")))
      })
      var guestLanding = fromShare || share.isGuestCloudLaunch()
      var detailLoading = !rawItem
        && options.id
        && guestLanding
        && data.isCloudEnabled()
        && !this._detailLoadSettled
      this.setData({
        item: item,
        itemId: options.id || "",
        detailLoading: detailLoading,
        isResource: isResource,
        blocked: false,
        isGuest: isGuest,
        connectText: connectText,
        connectRecordId: connectRecordId,
        connectRecordStatus: connectRecordStatus,
        isOwnListing: isOwnListing,
        isPublisher: isPublisher,
        canCloseListing: canCloseListing,
        canTogglePublicDisplay: canTogglePublicDisplay,
        listingPublicDisplay: listingPublicDisplay,
        canAdminTakeDown: canAdminTakeDown,
        closeListingLabel: closeListingLabel,
        sourceListingClosed: sourceListingClosed,
        linkedConnects: linkedConnectStats.connects,
        linkedConnectPending: linkedConnectStats.pending,
        relatedItems: relatedItems,
        matchPickerItems: matchPickerBundle.matchPickerItems,
        showMatchPicker: showMatchPicker,
        showViewerMatchPicker: showViewerMatchPicker,
        showMatchPickerSection: showMatchPickerSection,
        showOwnerMatchSection: showOwnerMatchSection,
        showProxyMatchSection: showProxyMatchSection,
        matchPickerMode: matchPickerMode,
        listingLayout: listingLayout,
        detailHighlights: (item && item.highlights ? item.highlights : []).filter(function(point) {
          return !!point
        }).slice(0, 4),
        publisherInfo: publisherInfo,
        showBottomBar: showBottomBar,
        canShareConnectInvite: canShareConnectInvite,
        canShowDemandMatchAction: perm.canMatchToListing,
        shareConnectLabel: isResource ? "分享给好友对接" : "分享给好友匹配",
        canManageListing: canManageListing,
        matchPickerTitle: matchPickerBundle.matchPickerTitle,
        matchPickerEmptyTip: matchPickerBundle.matchPickerEmptyTip,
        matchPickerExpanded: !!this.data.matchPickerExpanded,
        matchPickerHasMore: matchPickerBundle.matchPickerHasMore,
        matchPickerTotal: matchPickerBundle.matchPickerTotal,
        matchPickerMoreCount: matchPickerBundle.matchPickerMoreCount,
        matchPickerView: matchPickerBundle.matchPickerView,
        matchPickerHasSmart: matchPickerBundle.matchPickerHasSmart,
        matchManualKeyword: matchPickerBundle.matchManualKeyword || this.data.matchManualKeyword,
        matchManualSearchPlaceholder: matchPickerBundle.matchManualSearchPlaceholder || this.data.matchManualSearchPlaceholder,
        matchPickerSideLabel: matchPickerSideLabel,
        isProxyResourceConnectPicker: isResourceSideMatchPickerMode(matchPickerMode),
        isProxyDemandConnectPicker: isDemandMatchResourceMode(matchPickerMode),
        showProxyStaffBottomBar: showProxyStaffBottomBar,
        isStaffProxyManager: perm.isStaffProxyManager,
        hasListingAttachments: attachmentState.hasListingAttachments,
        canViewAttachments: attachmentState.canViewAttachments,
        listingAttachments: attachmentState.canViewAttachments ? attachmentState.listingAttachments : [],
        fromShare: fromShare,
        displayCertBadge: rawItem ? data.getListingDisplayCertBadge(rawItem) : null,
        displayProxyBadge: rawItem ? data.getListingProxyBadge(rawItem) : null,
        isFavorited: options.id ? data.isFavoriteListing(options.id) : false,
        isStaffProxyView: isStaffProxyView,
        proxyClientLine: proxyClientLine,
        proxyClientCertHint: proxyClientCertHint,
        proxyClientForm: proxyClientForm,
        matchAnchor: matchAnchor,
        isMatchPreview: isMatchPreview,
        isConnectPreview: isConnectPreview,
        connectId: connectId,
        connectFrom: connectFrom,
        connectPreviewTitle: connectPreviewContext ? connectPreviewContext.title : "",
        isStaffOversight: isStaffOversight,
        matchAnchorTitle: matchAnchorItem ? matchAnchorItem.title : "",
        showStaffMatchPicker: showStaffMatchPicker,
        matchSubmitDisabled: matchSubmitDisabled,
        matchSubmitLabel: matchSubmitLabel,
        verificationView: rawItem && !isMatchPreview && !isConnectPreview && !isStaffOversight
          ? data.getListingVerificationView(rawItem, isResource)
          : null,
        canReportListing: !!(rawItem && !isPublisher && !isStaffProxyView && !isMatchPreview && !isConnectPreview && !isStaffOversight && data.isUserRegistered() && !data.isStaffUser())
      })
      if (rawItem && data.shouldFetchStaffListingPublisher(rawItem, { fromShare: fromShare })) {
        if (data.publisherInfoNeedsCloudFetch(publisherInfo)) {
          data.fetchStaffListingPublisherInfoAsync(options.id, Object.assign({}, publisherViewOptions, {
            isListingPublisher: isPublisher
          })).then(function(nextPublisherInfo) {
            if (nextPublisherInfo && this.data.itemId === options.id) {
              this.setData({ publisherInfo: nextPublisherInfo })
            }
          }.bind(this))
        }
      }
      this.tryResumeShareConnect()
    } catch (error) {
      wx.showToast({ title: "详情加载失败", icon: "none" })
    }
  },

  tryResumeShareConnect() {
    const data = require("../../utils/data")
    const intent = data.getShareIntent()
    const item = this.data.item
    if (!intent || intent.action !== "connect" || intent.listingId !== this.data.itemId) {
      return
    }
    if (!this.data.isResource || this.data.isPublisher || !item) {
      return
    }
    var existingConnect = data.findViewerConnectForListing(this.data.itemId)
    if (existingConnect) {
      data.clearShareIntent()
      return
    }
    var options = this.options || {}
    if (intent.source !== "share" && options.from !== "share") {
      data.clearShareIntent()
      return
    }
    if (!data.canApplyConnect()) {
      return
    }
    data.clearShareIntent()
  },

  goAuth(event) {
    const data = require("../../utils/data")
    var tab = (event && event.currentTarget && event.currentTarget.dataset.tab) || "login"
    var redirect = data.getDetailPageUrl(this.data.itemId, { fromShare: true })
    if (this.data.itemId) {
      data.saveShareIntent({
        listingId: this.data.itemId,
        action: "connect",
        isResource: true,
        title: this.data.item ? this.data.item.title : "",
        source: "share"
      })
    }
    wx.navigateTo({
      url: data.buildAuthUrl({
        action: "share-resource",
        redirect: redirect,
        tab: tab
      })
    })
  },

  goLogin() {
    this.goAuth({ currentTarget: { dataset: { tab: "login" } } })
  },

  applyConnect() {
    const data = require("../../utils/data")
    if (this.data.isGuest) {
      this.goLogin()
      return
    }
    const item = this.data.item
    if (!item || this.data.isPublisher || this.data.isStaffProxyView) {
      return
    }
    if (this.data.connectRecordId) {
      wx.navigateTo({
        url: "/pages/record/record?id=" + this.data.connectRecordId
      })
      return
    }
    var blockingConnect = data.findViewerConnectForListing(item.id)
    if (blockingConnect) {
      wx.showToast({ title: "已有进行中的对接", icon: "none" })
      wx.navigateTo({
        url: "/pages/record/record?id=" + blockingConnect.id
      })
      return
    }
    var actionUrl = this.data.isResource
      ? data.getConnectSubmitUrl(item.id, item.title)
      : data.getMatchSubmitUrl(this.data.itemId, item.title)
    if (!actionUrl) {
      return
    }
    if (this.data.isResource) {
      if (!data.ensureConnectAccess({ redirect: actionUrl })) {
        return
      }
    } else if (!data.ensureMatchAccess({ redirect: actionUrl })) {
      return
    }
    wx.navigateTo({ url: actionUrl })
  },

  goPublishResource() {
    this.applyConnect()
  },

  adminTakeDownListing() {
    if (this.data.adminTakeDownLoading) {
      return
    }
    const data = require("../../utils/data")
    const itemId = this.data.itemId
    const title = this.data.item ? this.data.item.title : itemId
    if (!itemId || !data.isPlatformAdminUser()) {
      wx.showToast({ title: "仅平台管理员可操作", icon: "none" })
      return
    }
    wx.showModal({
      title: "平台强制下架",
      content: "确认下架「" + (title || itemId) + "」？他人将无法再查看或对接。",
      confirmText: "确认下架",
      confirmColor: "#c0392b",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        this.setData({ adminTakeDownLoading: true })
        data.adminTakeDownListingAsync(itemId, "平台管理员在详情页强制下架。").then(function(result) {
          if (!result.ok) {
            wx.showToast({ title: result.message || "下架失败", icon: "none" })
            return
          }
          wx.showToast({ title: "已下架", icon: "success" })
          setTimeout(function() {
            this.loadDetail()
          }.bind(this), 500)
        }.bind(this)).catch(function(error) {
          wx.showToast({ title: error.message || "下架失败", icon: "none" })
        }).finally(function() {
          this.setData({ adminTakeDownLoading: false })
        }.bind(this))
      }.bind(this)
    })
  },

  onPublicDisplayChange(event) {
    if (this.data.publicDisplayLoading || !this.data.canTogglePublicDisplay) {
      return
    }
    const data = require("../../utils/data")
    const itemId = this.data.itemId
    const enabled = !!event.detail.value
    const poolLabel = this.data.isResource ? "资源池" : "需求池"
    const content = enabled
      ? "开启后，他人可在" + poolLabel + "脱敏查看并申请对接。"
      : "关闭后，将不再在" + poolLabel + "展示；仅你可在提交记录中查看。"
    wx.showModal({
      title: enabled ? "开启公开展示" : "关闭公开展示",
      content: content,
      confirmText: enabled ? "确认开启" : "确认关闭",
      success: function(res) {
        if (!res.confirm) {
          this.setData({ listingPublicDisplay: !enabled })
          return
        }
        this.setData({ publicDisplayLoading: true })
        data.setListingPublicDisplay(itemId, enabled).then(function(result) {
          if (!result.ok) {
            this.setData({ listingPublicDisplay: !enabled })
            wx.showToast({ title: result.message || "设置失败", icon: "none" })
            return
          }
          var item = this.data.item ? Object.assign({}, this.data.item, { publicDisplay: enabled }) : this.data.item
          this.setData({
            item: item,
            listingPublicDisplay: enabled
          })
          wx.showToast({ title: enabled ? "已开启公开展示" : "已关闭公开展示", icon: "success" })
        }.bind(this)).catch(function(error) {
          this.setData({ listingPublicDisplay: !enabled })
          wx.showToast({ title: (error && error.message) || "设置失败", icon: "none" })
        }.bind(this)).finally(function() {
          this.setData({ publicDisplayLoading: false })
        }.bind(this))
      }.bind(this)
    })
  },

  closeListing() {
    if (this.data.closeListingLoading) {
      return
    }
    const data = require("../../utils/data")
    const itemId = this.data.itemId
    const label = this.data.closeListingLabel || "关闭此商机"
    var content = this.data.isStaffProxyView
      ? "关闭后该代发商机将从公开展示池下架，他人无法再查看或申请对接。提交记录仍会保留，可随时查看历史信息。"
      : "关闭后该商机将从公开展示池下架，他人无法再查看或申请对接。你的提交记录仍会保留，可随时查看历史信息。"
    wx.showModal({
      title: label,
      content: content,
      confirmText: "确认关闭",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        this.setData({ closeListingLoading: true })
        Promise.resolve(data.closeUserListing(itemId)).then(function(closeResult) {
          if (!closeResult.ok) {
            wx.showToast({ title: closeResult.message, icon: "none" })
            return
          }
          wx.showToast({ title: "已关闭", icon: "success" })
          setTimeout(function() {
            wx.navigateBack({
              fail: function() {
                wx.switchTab({ url: "/pages/mine/mine" })
              }
            })
          }, 700)
        }).catch(function(error) {
          wx.showToast({ title: (error && error.message) || "关闭失败", icon: "none" })
        }).finally(function() {
          this.setData({ closeListingLoading: false })
        }.bind(this))
      }.bind(this)
    })
  },

  goConnectRecord(event) {
    var id = event.currentTarget.dataset.id
    if (!id) {
      return
    }
    wx.navigateTo({
      url: "/pages/record/record?id=" + id
    })
  },

  closeDemand() {
    this.closeListing()
  },

  goRelated(event) {
    var targetId = event.currentTarget.dataset.id
    if (!targetId) {
      return
    }
    var anchor = this.data.matchAnchor || this.data.itemId
    wx.navigateTo({
      url: "/pages/detail/detail?id=" + targetId + "&matchAnchor=" + anchor
    })
  },

  loadMoreMatchPicker() {
    if (this.data.matchPickerExpanded || !this.data.matchPickerHasMore || this.data.matchPickerView === "manual") {
      return
    }
    this.setData({ matchPickerExpanded: true }, function() {
      this.loadDetail()
    }.bind(this))
  },

  goBackToMatchAnchor() {
    var anchor = this.data.matchAnchor
    if (!anchor) {
      wx.navigateBack()
      return
    }
    wx.redirectTo({
      url: "/pages/detail/detail?id=" + anchor + "&matchAnchor=" + anchor,
      fail: function() {
        wx.navigateTo({
          url: "/pages/detail/detail?id=" + anchor + "&matchAnchor=" + anchor
        })
      }
    })
  },

  goBackToConnectRecord() {
    const data = require("../../utils/data")
    var connectId = this.data.connectId
    if (!connectId) {
      wx.navigateBack()
      return
    }
    var backUrl = data.getConnectPreviewBackUrl(connectId, {
      connectFrom: this.data.connectFrom
    })
    if (!backUrl) {
      wx.navigateBack()
      return
    }
    wx.redirectTo({
      url: backUrl,
      fail: function() {
        wx.navigateTo({ url: backUrl })
      }
    })
  },

  toggleMatchSelect(event) {
    var id = event.currentTarget.dataset.id
    if (!id || !this.data.showMatchPickerSection) {
      return
    }
    const data = require("../../utils/data")
    var mode = this.data.matchPickerMode
    var item = (this.data.matchPickerItems || []).find(function(entry) {
      return entry.id === id
    })
    if (item && item.matchPreviewOnly) {
      wx.showToast({
        title: mode === "ownerDemand"
          ? "该资源仅可预览"
          : (isResourceSideMatchPickerMode(mode)
            ? "仅可预览，请勾选自己发布的需求"
            : "仅可预览，请勾选自己发布的资源"),
        icon: "none"
      })
      return
    }
    if (item && item.matchAlreadyLinked) {
      wx.showToast({ title: "该条已发起对接", icon: "none" })
      return
    }
    if (item && item.matchSelectable === false) {
      wx.showToast({
        title: mode === "ownerDemand"
          ? "该资源不可勾选对接"
          : (isResourceSideMatchPickerMode(mode)
            ? "只能勾选自己发布的需求"
            : "只能勾选自己发布的资源"),
        icon: "none"
      })
      return
    }
    if (item && (item.matchListingClosed || data.isListingClosed(data.getItem(id)))) {
      wx.showToast({ title: "该商机已关闭，无法勾选", icon: "none" })
      return
    }
    var selected = (this.data.selectedMatchIds || []).slice()
    var index = selected.indexOf(id)
    if (index > -1) {
      selected.splice(index, 1)
    } else {
      if (selected.length >= 5) {
        wx.showToast({ title: "一次最多勾选 5 条", icon: "none" })
        return
      }
      selected.push(id)
    }
    var matchPickerItems = this.enrichMatchPickerItems(
      data,
      this.data.itemId,
      mode,
      this.data.matchPickerItems || [],
      selected
    )
    this.setData({
      selectedMatchIds: selected,
      selectedMatchCount: selected.length,
      matchPickerItems: matchPickerItems,
      matchSubmitDisabled: selected.length === 0 || !!this.data.staffMatchSubmitting,
      matchSubmitLabel: getStaffProxyMatchSubmitLabel(mode, selected.length)
    })
  },

  enrichMatchPickerItems(data, listingId, mode, items, selectedIds) {
    if (this.data.matchPickerView === "manual") {
      return data.buildManualMatchPickerItems(listingId, mode, {
        selectedIds: selectedIds,
        keyword: this.data.matchManualKeyword || ""
      })
    }
    if (isResourceSideMatchPickerMode(mode)) {
      if (mode === "viewerResource") {
        return data.enrichViewerResourceMatchDemandOptions(listingId, items, selectedIds)
      }
      if (mode === "ownerResource") {
        return data.enrichOwnerResourceMatchDemandOptions(listingId, items, selectedIds)
      }
      return data.enrichStaffProxyMatchOptions(listingId, items, selectedIds)
    }
    if (mode === "staffDemand") {
      return data.enrichStaffProxyMatchResourceOptions(listingId, items, selectedIds)
    }
    if (isDemandMatchResourceMode(mode)) {
      return data.enrichOwnerDemandMatchResourceOptions(listingId, items, selectedIds)
    }
    return items
  },

  submitStaffMatch() {
    this.submitMatchPicker()
  },

  submitMatchPicker() {
    const data = require("../../utils/data")
    var selected = this.data.selectedMatchIds || []
    var mode = this.data.matchPickerMode
    if (!selected.length || this.data.staffMatchSubmitting || !mode) {
      if (!selected.length) {
        var pickSide = isResourceSideMatchPickerMode(mode) ? "需求" : "资源"
        wx.showToast({ title: "请先勾选要匹配的" + pickSide, icon: "none" })
      }
      return
    }
    var isStaffMode = mode === "staffResource" || mode === "staffDemand"
    var targetLabel = isResourceSideMatchPickerMode(mode) ? "需求" : "资源"
    var modalTitle = (mode === "viewerResource" || mode === "ownerDemand")
      ? "确认申请对接"
      : (isStaffMode ? "确认提交对接申请" : "确认发起匹配")
    var modalContent = mode === "staffResource"
      ? "将替客户向 " + selected.length + " 条需求提交对接申请；双方均为代发时将自动完结，否则进入对方确认。"
      : (mode === "staffDemand"
        ? "将替客户向 " + selected.length + " 条资源提交对接申请；双方均为代发时将自动完结，否则进入对方确认。"
        : (mode === "ownerDemand"
          ? "将向 " + selected.length + " 条资源提交对接申请；平台代发资源需平台审核，其他资源需对方确认。"
          : ((isStaffMode ? "将替客户向 " : "将向 ") + selected.length + " 条" + targetLabel + "发起对接，对方确认后可进入交换联系方式。")))
    wx.showModal({
      title: modalTitle,
      content: modalContent,
      success: function(res) {
        if (!res.confirm) {
          return
        }
        this.setData({
          staffMatchSubmitting: true,
          matchSubmitDisabled: true,
          matchSubmitLabel: "提交中..."
        })
        var submitPromise
        if (mode === "staffResource") {
          submitPromise = data.createStaffProxyMatchConnects(this.data.itemId, selected)
        } else if (mode === "staffDemand") {
          submitPromise = data.createStaffProxyMatchConnectsFromDemand(this.data.itemId, selected)
        } else if (mode === "ownerResource") {
          submitPromise = data.createOwnerResourceMatchConnects(this.data.itemId, selected)
        } else if (mode === "viewerResource") {
          submitPromise = data.createViewerResourceMatchConnects(this.data.itemId, selected)
        } else if (mode === "viewerDemand") {
          submitPromise = data.createViewerDemandMatchConnects(this.data.itemId, selected)
        } else {
          submitPromise = data.createOwnerDemandMatchConnects(this.data.itemId, selected)
        }
        submitPromise.then(function(result) {
          this.setData({
            staffMatchSubmitting: false,
            selectedMatchIds: [],
            selectedMatchCount: 0,
            matchSubmitDisabled: true,
            matchSubmitLabel: getStaffProxyMatchSubmitLabel(mode, 0)
          })
          var created = (result && result.created) ? result.created.length : 0
          var skipped = (result && result.skipped) ? result.skipped.length : 0
          var failed = (result && result.failed) ? result.failed.length : 0
          if (created === 0 && failed > 0) {
            var failMsg = (result.failed[0] && result.failed[0].message) || "提交失败，请重试"
            wx.showModal({
              title: "匹配提交失败",
              content: failMsg + (failed > 1 ? "（共 " + failed + " 条失败）" : ""),
              showCancel: false,
              success: function() {
                this.loadDetail()
              }.bind(this)
            })
            return
          }
          var successTitle = (isStaffMode || mode === "viewerResource" || mode === "ownerDemand") ? "对接申请已提交" : "匹配已提交"
          wx.showModal({
            title: successTitle,
            content: "成功 " + created + " 条" + (skipped ? "，跳过 " + skipped + " 条（已存在对接）" : "") + (failed ? "，失败 " + failed + " 条" : ""),
            showCancel: false,
            success: function() {
              var reload = function() {
                this.loadDetail()
              }.bind(this)
              if (data.isCloudEnabled()) {
                data.refreshFromCloudForMine().then(reload).catch(reload)
                return
              }
              reload()
            }.bind(this)
          })
        }.bind(this)).catch(function(error) {
          this.setData({
            staffMatchSubmitting: false,
            matchSubmitDisabled: selected.length === 0,
            matchSubmitLabel: getStaffProxyMatchSubmitLabel(mode, selected.length)
          })
          wx.showToast({ title: (error && error.message) || "提交失败", icon: "none" })
        }.bind(this))
      }.bind(this)
    })
  },

  goProxyDemandConnect(event) {
    const data = require("../../utils/data")
    var resourceId = this.data.itemId
    var demandId = event.currentTarget.dataset.id
    var demandTitle = event.currentTarget.dataset.title || ""
    if (!resourceId || !demandId || this.data.matchPickerMode !== "staffResource") {
      return
    }
    if (!data.canStaffManageProxyListing(resourceId)) {
      wx.showToast({ title: "无权操作该代发资源", icon: "none" })
      return
    }
    var pairState = data.getProxyResourceConnectPairState(resourceId, demandId)
    if (pairState.connectRecordId) {
      wx.navigateTo({ url: "/pages/record/record?id=" + pairState.connectRecordId })
      return
    }
    if (!pairState.canConnect) {
      wx.showToast({ title: "当前不可对接该需求", icon: "none" })
      return
    }
    wx.navigateTo({
      url: data.buildProxyResourceConnectSubmitUrl(resourceId, demandId, demandTitle)
    })
  },

  goCertifyForAttachments() {
    require("../../utils/data").promptLicenseCertification()
  },

  previewAttachment(event) {
    const index = Number(event.currentTarget.dataset.index)
    const item = this.data.listingAttachments[index]
    if (!item) {
      return
    }
    const url = item.displayUrl || item.url
    if (item.fileType === "image") {
      const urls = this.data.listingAttachments
        .filter(function(entry) { return entry.fileType === "image" })
        .map(function(entry) { return entry.displayUrl || entry.url })
      wx.previewImage({ current: url, urls: urls })
      return
    }
    wx.openDocument({
      filePath: url,
      showMenu: true,
      fail: function() {
        wx.showToast({ title: "暂不支持预览该文件", icon: "none" })
      }
    })
  },

  onShareAppMessage(res) {
    const share = require("../../utils/share")
    if (!this.data.item || !this.data.itemId) {
      return share.buildHomeShareAppMessage()
    }
    var fromConnectInvite = res && res.from === "button"
      && res.target
      && res.target.dataset
      && res.target.dataset.shareScene === "connect"
    if (fromConnectInvite) {
      return share.buildListingConnectShareAppMessage(this.data.item, this.data.itemId, {
        isResource: this.data.isResource
      })
    }
    return share.buildListingShareAppMessage(this.data.item, this.data.itemId)
  },

  onShareTimeline() {
    const share = require("../../utils/share")
    const data = require("../../utils/data")
    var options = this.resolvePageOptions()
    var id = this.data.itemId || options.id || ""
    var item = this.data.item
    if (!item && id) {
      item = data.resolveListingForDetail(id, {
        from: options.from,
        connectId: options.connectId || ""
      })
    }
    if (!item || !id) {
      return share.buildHomeShareTimeline()
    }
    return share.buildListingShareTimeline(item, id)
  },

  toggleFavorite() {
    const data = require("../../utils/data")
    const id = this.data.itemId
    const result = data.toggleFavoriteListing(id)
    if (result.needLogin) {
      data.promptFavoriteLogin(this.data.isResource ? "resources" : "demands")
      return
    }
    if (!result.ok) {
      return
    }
    this.setData({ isFavorited: result.favorited })
    wx.showToast({
      title: result.favorited ? "已收藏" : "已取消收藏",
      icon: "none"
    })
  },

  reportListing() {
    const data = require("../../utils/data")
    if (this.data.reportLoading || !this.data.itemId) {
      return
    }
    if (!data.isUserRegistered()) {
      data.promptRegistration({ redirect: data.getDetailPageUrl(this.data.itemId) })
      return
    }
    var reasons = data.getListingReportReasonOptions()
    var self = this
    wx.showActionSheet({
      itemList: reasons,
      success: function(res) {
        var reason = reasons[res.tapIndex]
        if (!reason) {
          return
        }
        self.setData({ reportLoading: true })
        data.submitListingReportAsync(self.data.itemId, reason).then(function() {
          wx.showToast({ title: "举报已提交", icon: "success" })
        }).catch(function(error) {
          wx.showToast({
            title: (error && error.message) || "提交失败",
            icon: "none"
          })
        }).finally(function() {
          self.setData({ reportLoading: false })
        })
      }
    })
  },

  copyTradeId(event) {
    const copyText = require("../../utils/copyText")
    var text = event.currentTarget.dataset.text || ""
    copyText.copyTextToClipboard(text, {
      emptyTip: "暂无编号",
      successTip: "编号已复制"
    })
  },

  copyListingText() {
    const data = require("../../utils/data")
    const copyText = require("../../utils/copyText")
    var item = this.data.item
    if (!item) {
      return
    }
    var text = data.buildListingPublicCopyText(item, this.data.isResource, {
      listingId: this.data.itemId
    })
    copyText.copyTextToClipboard(text, {
      emptyTip: "暂无可复制内容",
      successTip: "已复制商机文字"
    })
  }
})
