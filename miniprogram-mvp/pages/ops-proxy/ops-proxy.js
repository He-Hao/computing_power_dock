Page({
  _opsRefreshing: false,
  _lastOpsRefresh: 0,

  data: Object.assign({
    stats: {
      total: 0,
      resources: 0,
      demands: 0,
      pending: 0,
      published: 0,
    },
    activePool: "all",
    activeStatus: "all",
    activePublicDisplay: "all",
    activeType: "全部",
    keyword: "",
    typeFilterChips: require("../../utils/data").getResourceTypeFilterChips(),
    publicDisplayFilters: require("../../utils/data").getStaffProxyPublicDisplayFilterOptions(),
    allItems: [],
    items: [],
    poolFilters: [
      { value: "all", label: "全部" },
      { value: "resource", label: "资源" },
      { value: "demand", label: "需求" }
    ],
    statusFilters: [
      { value: "all", label: "全部状态" },
      { value: "pending", label: "待审核" },
      { value: "published", label: "已发布" },
      { value: "closed", label: "已关闭" },
      { value: "rejected", label: "已驳回" }
    ]
  }, require("../../utils/pagedList").initialData()),

  onShow() {
    const data = require("../../utils/data")
    const adminModule = require("../../utils/admin")
    if (!data.isUserRegistered()) {
      wx.showToast({ title: "请先登录", icon: "none" })
      setTimeout(function() {
        wx.navigateTo({
          url: "/pages/login/login?redirect=" + encodeURIComponent("/pages/ops-proxy/ops-proxy")
        })
      }, 500)
      return
    }
    if (!adminModule.guardStaffPageAccess({ redirect: "back" })) {
      return
    }
    if (!adminModule.guardStaffWorkMode({ redirect: "back" })) {
      return
    }
    var app = getApp()
    var force = !!(app.globalData && app.globalData.opsProxyNeedsRefresh)
    if (force && app.globalData) {
      app.globalData.opsProxyNeedsRefresh = false
    }
    this.loadPage(force)
  },

  loadPage(force) {
    const data = require("../../utils/data")
    this.applyListData(data)
    if (!data.isCloudEnabled()) {
      return Promise.resolve()
    }
    var now = Date.now()
    var needsImmediateRefresh = this.data.allItems.length === 0
    if (!force && !needsImmediateRefresh && (this._opsRefreshing || now - this._lastOpsRefresh < 12000)) {
      return Promise.resolve()
    }
    this._opsRefreshing = true
    return data.refreshFromCloudForMine().then(function() {
      this._lastOpsRefresh = Date.now()
      this.applyListData(data)
    }.bind(this)).catch(function() {
      // 已有本地缓存
    }.bind(this)).finally(function() {
      this._opsRefreshing = false
    }.bind(this))
  },

  onPullDownRefresh() {
    this.loadPage(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  applyListData(data) {
    var allItems = data.getStaffProxyListingViews()
    var stats = data.getStaffProxyHubStats(allItems)
    this.setData({
      allItems: allItems,
      stats: stats
    }, this.applyFilters)
  },

  applyFilters() {
    const data = require("../../utils/data")
    const pagedList = require("../../utils/pagedList")
    var filtered = data.filterStaffProxyListingViews(this.data.allItems, {
      pool: this.data.activePool,
      status: this.data.activeStatus,
      publicDisplay: this.data.activePublicDisplay,
      activeType: this.data.activeType,
      keyword: this.data.keyword
    })
    var patch = pagedList.applyPage(filtered, this, { reset: true })
    this.setData(patch)
  },

  onReachBottom() {
    require("../../utils/pagedList").runLoadMore(this)
  },

  setPoolFilter(event) {
    this.setData({ activePool: event.currentTarget.dataset.value }, this.applyFilters)
  },

  setStatusFilter(event) {
    this.setData({ activeStatus: event.currentTarget.dataset.value }, this.applyFilters)
  },

  setPublicDisplayFilter(event) {
    this.setData({ activePublicDisplay: event.currentTarget.dataset.value }, this.applyFilters)
  },

  setTypeFilter(event) {
    this.setData({ activeType: event.currentTarget.dataset.type }, this.applyFilters)
  },

  onSearchInput(event) {
    this.setData({ keyword: event.detail.value }, this.applyFilters)
  },

  clearSearch() {
    this.setData({ keyword: "" }, this.applyFilters)
  },

  onSearchConfirm() {
    const data = require("../../utils/data")
    if (!data.looksLikeTradeIdKeyword(this.data.keyword)) {
      return
    }
    data.tryNavigateTradeIdSearch(this.data.keyword, { toastOnMiss: true })
  },

  goPublishResource() {
    wx.navigateTo({ url: "/pages/submit/submit?type=resource&mode=proxy" })
  },

  goPublishDemand() {
    wx.navigateTo({ url: "/pages/submit/submit?type=demand&mode=proxy" })
  },

  goProxyDetail(event) {
    var id = event.currentTarget.dataset.id
    if (!id) {
      return
    }
    if (event.currentTarget.dataset.submissionOnly) {
      var submissionId = event.currentTarget.dataset.submissionId || id
      wx.navigateTo({
        url: "/pages/record/record?id=" + encodeURIComponent(submissionId)
      })
      return
    }
    wx.navigateTo({
      url: "/pages/detail/detail?id=" + id + "&from=ops-proxy"
    })
  }
})
