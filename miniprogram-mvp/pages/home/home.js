Page({
  _homeRefreshing: false,
  _lastHomeRefresh: 0,

  data: {
    heroTagline: "算力产业链商机撮合平台",
    heroDesc: "汇集算力整机、硬件配件、算力租赁、机房建设与资金支持等领域的资源与需求，供双方浏览与对接。",
    heroNote: "平台审核名片并协助交换联系方式，不参与交易与资金往来。",
    guideSectionSub: "三步完成真实商机对接",
    disclaimerNotice: "本平台仅提供商机信息与撮合协助，不参与交易、不代收代付，不对信息真实性作担保，线下洽谈风险由双方自行承担。",
    resourceCount: 0,
    demandCount: 0,
    usageSteps: [
      { step: "1", title: "浏览", text: "资源池 / 需求池", tone: "green", mock: "browse" },
      { step: "2", title: "对接", text: "详情页发起申请", tone: "blue", mock: "connect" },
      { step: "3", title: "交换", text: "双方确认联系方式", tone: "amber", mock: "exchange" }
    ],
    staffUser: false,
    pendingConnectNotice: null,
    pendingRejectionNotice: null,
    intentCategories: [],
    featuredListings: [],
    showFeaturedSection: false
  },

  onLoad(options) {
    if (options && options.from === "share") {
      wx.showToast({ title: "欢迎通过分享进入", icon: "none", duration: 2000 })
    }
    this.loadHomeData()
  },

  onShow() {
    wx.setNavigationBarTitle({ title: "算力码头" })
    const data = require("../../utils/data")
    if (data.canShareListingContent()) {
      require("../../utils/share").enableShareMenus()
    } else if (wx.hideShareMenu) {
      wx.hideShareMenu()
    }
    this.loadHomeData()
    this.refreshHomeFromCloud(false)
  },

  refreshHomeFromCloud(force) {
    const data = require("../../utils/data")
    if (!data.isCloudEnabled()) {
      return Promise.resolve()
    }
    var now = Date.now()
    if (!force && (this._homeRefreshing || now - this._lastHomeRefresh < 15000)) {
      return Promise.resolve()
    }
    this._homeRefreshing = true
    var syncPromise = data.isStaffUser()
      ? data.refreshStaffLaunchFromCloud()
      : data.refreshPoolPagesFromCloud()
    return syncPromise.then(function() {
      this._lastHomeRefresh = Date.now()
      this.loadHomeData()
      data.updateMineTabBadge()
    }.bind(this)).catch(function() {
      this.loadHomeData()
    }.bind(this)).finally(function() {
      this._homeRefreshing = false
    }.bind(this))
  },

  onPullDownRefresh() {
    this.refreshHomeFromCloud(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  loadHomeData() {
    try {
      const data = require("../../utils/data")
      const registered = data.isUserRegistered()
      const staffUser = data.isStaffUser()
      var pendingConnectNotice = registered ? data.getPendingConnectNotice() : null
      var pendingRejectionNotice = registered && !staffUser ? data.getPendingRejectionNotice() : null

      var featuredListings = data.getHomeFeaturedListings()
      this.setData({
        staffUser: staffUser,
        resourceCount: data.getResources().length,
        demandCount: data.getDemands().length,
        pendingConnectNotice: pendingConnectNotice,
        pendingRejectionNotice: pendingRejectionNotice,
        intentCategories: data.getHomeIntentCategories(),
        featuredListings: [],
        showFeaturedSection: false
      })
      data.updateMineTabBadge()
    } catch (error) {
      wx.showToast({
        title: "数据加载失败",
        icon: "none"
      })
    }
  },

  goPendingConnect() {
    var notice = this.data.pendingConnectNotice
    if (notice && notice.mode === "staff") {
      if (notice.items && notice.items.length === 1 && notice.items[0].id) {
        var item = notice.items[0]
        if (item.actionType === "confirm" || item.actionType === "exchange") {
          wx.navigateTo({ url: "/pages/record/record?id=" + item.id })
          return
        }
      }
      var app = getApp()
      if ((notice.connectCount || 0) > 0 && (notice.reviewCount || 0) === 0) {
        if (app.globalData) {
          app.globalData.scrollToOpsConnect = true
        }
        wx.switchTab({ url: "/pages/mine/mine" })
        return
      }
      if ((notice.reviewCount || 0) > 0) {
        if (app.globalData) {
          app.globalData.opsReviewTab = "all"
        }
        wx.switchTab({ url: "/pages/mine/mine" })
        return
      }
      wx.navigateTo({ url: "/pages/ops-proxy/ops-proxy" })
      return
    }
    wx.navigateTo({
      url: "/pages/records/records?filter=connect"
    })
  },

  goPendingRejection() {
    const data = require("../../utils/data")
    wx.navigateTo({
      url: data.getRejectionNoticeNavigateUrl(this.data.pendingRejectionNotice)
    })
  },

  goSubmit(event) {
    const data = require("../../utils/data")
    const type = event.currentTarget.dataset.type
    var url = "/pages/submit/submit?type=" + type
    if (event.currentTarget.dataset.listingType) {
      url += "&listingType=" + encodeURIComponent(event.currentTarget.dataset.listingType)
    }
    if (data.requiresRegistration(type) && !data.isUserRegistered()) {
      data.promptRegistration({ redirect: url })
      return
    }
    if (!data.ensureSubmitListingAccess(type, { redirect: url })) {
      return
    }
    wx.navigateTo({ url: url })
  },

  goResources() {
    wx.switchTab({ url: "/pages/resources/resources" })
  },

  goDemands() {
    wx.switchTab({ url: "/pages/demands/demands" })
  },

  goProcess() {
    wx.navigateTo({ url: "/pages/process/process" })
  },

  goFeaturedDetail(event) {
    var id = event.currentTarget.dataset.id
    if (!id) {
      return
    }
    wx.navigateTo({ url: "/pages/detail/detail?id=" + id })
  },

  onIntentTap(event) {
    const data = require("../../utils/data")
    var dataset = event.currentTarget.dataset || {}
    var action = dataset.action
    if (action === "filter") {
      var app = getApp()
      if (app.globalData) {
        app.globalData.filterIntent = {
          pool: dataset.pool,
          type: dataset.filterType || ""
        }
      }
      wx.switchTab({
        url: dataset.pool === "demands" ? "/pages/demands/demands" : "/pages/resources/resources"
      })
      return
    }
    if (action === "submit") {
      if (data.isStaffUser()) {
        wx.showToast({ title: "运营请使用代发管理", icon: "none" })
        return
      }
      var submitType = dataset.submitType || "resource"
      var url = "/pages/submit/submit?type=" + submitType
      if (dataset.listingType) {
        url += "&listingType=" + encodeURIComponent(dataset.listingType)
      }
      if (data.requiresRegistration(submitType) && !data.isUserRegistered()) {
        data.promptRegistration({ redirect: url })
        return
      }
      if (!data.ensureSubmitListingAccess(submitType, { redirect: url })) {
        return
      }
      wx.navigateTo({ url: url })
    }
  },

  onShareAppMessage() {
    return require("../../utils/share").buildHomeShareAppMessage()
  },

  onShareTimeline() {
    return require("../../utils/share").buildHomeShareTimeline()
  }
})
