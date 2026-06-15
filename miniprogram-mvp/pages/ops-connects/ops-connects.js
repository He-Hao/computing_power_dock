Page({
  _opsRefreshing: false,
  _lastOpsRefresh: 0,

  data: Object.assign({
    stats: {
      total: 0,
      active: 0,
      pendingPlatform: 0,
      pendingConfirm: 0,
      exchanging: 0,
      exchanged: 0
    },
    activeStatus: "all",
    keyword: "",
    allItems: [],
    items: [],
    statusFilters: [
      { value: "all", label: "全部" },
      { value: "active", label: "进行中" },
      { value: "pending_platform", label: "待平台审" },
      { value: "pending_confirm", label: "待对方确认" },
      { value: "exchanging", label: "交换中" },
      { value: "exchanged", label: "已交换" },
      { value: "closed", label: "已关闭" }
    ]
  }, require("../../utils/pagedList").initialData()),

  onShow() {
    const data = require("../../utils/data")
    const adminModule = require("../../utils/admin")
    if (!data.isUserRegistered()) {
      wx.showToast({ title: "请先登录", icon: "none" })
      setTimeout(function() {
        wx.navigateTo({
          url: "/pages/login/login?redirect=" + encodeURIComponent("/pages/ops-connects/ops-connects")
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
    this.loadPage(false)
  },

  loadPage(force) {
    const data = require("../../utils/data")
    var loadPromise = Promise.resolve()
    if (!data.isCloudEnabled()) {
      this.applyListData(data)
      return loadPromise
    }
    var now = Date.now()
    if (force || (!this._opsRefreshing && now - this._lastOpsRefresh >= 12000)) {
      this._opsRefreshing = true
      loadPromise = data.refreshStaffGlobalConnectsFromCloud().then(function() {
        this._lastOpsRefresh = Date.now()
        this.applyListData(data)
      }.bind(this)).catch(function() {
        this.applyListData(data)
      }.bind(this)).finally(function() {
        this._opsRefreshing = false
      }.bind(this))
    } else {
      this.applyListData(data)
    }
    return loadPromise
  },

  onPullDownRefresh() {
    this.loadPage(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  applyListData(data) {
    var allItems = data.getStaffGlobalConnectViews()
    var stats = data.getStaffGlobalConnectStats(allItems)
    this.setData({
      allItems: allItems,
      stats: stats
    }, this.applyFilters)
  },

  applyFilters() {
    const data = require("../../utils/data")
    const pagedList = require("../../utils/pagedList")
    var filtered = data.filterStaffGlobalConnectViews(this.data.allItems, {
      status: this.data.activeStatus,
      keyword: this.data.keyword
    })
    var patch = pagedList.applyPage(filtered, this, { reset: true })
    this.setData(patch)
  },

  onReachBottom() {
    require("../../utils/pagedList").runLoadMore(this)
  },

  setStatusFilter(event) {
    this.setData({ activeStatus: event.currentTarget.dataset.value }, this.applyFilters)
  },

  onSearchInput(event) {
    this.setData({ keyword: event.detail.value || "" }, this.applyFilters)
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

  goConnectDetail(event) {
    var id = event.currentTarget.dataset.id
    if (!id) {
      return
    }
    wx.navigateTo({
      url: "/pages/ops-connect-detail/ops-connect-detail?id=" + id
    })
  }
})
