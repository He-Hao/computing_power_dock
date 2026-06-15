Page({
  data: {
    connectId: "",
    item: null,
    flowTimeline: []
  },

  onLoad(options) {
    const adminModule = require("../../utils/admin")
    if (!adminModule.guardStaffPageAccess({ redirect: "back" })) {
      return
    }
    if (!adminModule.guardStaffWorkMode({ redirect: "back" })) {
      return
    }
    this.setData({ connectId: options.id || "" })
    this.loadDetail(false)
  },

  onShow() {
    const adminModule = require("../../utils/admin")
    if (!adminModule.guardStaffPageAccess({ toast: false, redirect: "back" })) {
      return
    }
    if (!adminModule.guardStaffWorkMode({ toast: false, redirect: "back" })) {
      return
    }
    if (this.data.connectId) {
      this.loadDetail(false)
    }
  },

  loadDetail(force, options) {
    options = options || {}
    const data = require("../../utils/data")
    var id = this.data.connectId
    if (!id) {
      wx.showToast({ title: "记录不存在", icon: "none" })
      return Promise.resolve()
    }
    var applyDetail = function() {
      var item = data.getStaffGlobalConnectDetail(id)
      if (!item) {
        wx.showToast({ title: "对接记录不存在", icon: "none" })
        setTimeout(function() {
          wx.navigateBack()
        }, 600)
        return
      }
      var raw = data.getStaffGlobalConnectRaw(id) || { id: id, type: "connect", status: item.rawStatus }
      var flowTimeline = data.getRecordPublishTimeline(raw, "")
      this.setData({
        item: item,
        flowTimeline: flowTimeline
      })
    }.bind(this)

    if (!data.isCloudEnabled()) {
      applyDetail()
      return Promise.resolve()
    }
    if (!force) {
      applyDetail()
      if (data.getStaffGlobalConnectDetail(id)) {
        return Promise.resolve()
      }
    }
    if (!options.silent) {
      wx.showLoading({ title: "加载中", mask: true })
    }
    return data.refreshStaffGlobalConnectsFromCloud().then(function() {
      applyDetail()
    }).catch(function(error) {
      console.warn("运营对接详情同步失败", error)
      applyDetail()
      if (options.silent) {
        wx.showToast({ title: "同步失败，显示本地数据", icon: "none" })
      }
    }).finally(function() {
      if (!options.silent) {
        wx.hideLoading()
      }
    })
  },

  onPullDownRefresh() {
    this.loadDetail(true, { silent: true }).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  goReview() {
    var id = this.data.connectId
    if (!id) {
      return
    }
    wx.navigateTo({
      url: "/pages/admin-review/admin-review?reviewType=submission&id=" + id
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

  goListing(event) {
    var id = event.currentTarget.dataset.id
    if (!id) {
      return
    }
    const data = require("../../utils/data")
    var connectId = this.data.connectId
    var url = data.buildConnectListingPreviewUrl(connectId, id, { connectFrom: "ops" })
    if (!url) {
      return
    }
    var navigate = function() {
      wx.navigateTo({ url: url })
    }
    if (data.isCloudEnabled()) {
      wx.showLoading({ title: "加载中", mask: true })
      data.refreshStaffGlobalConnectsFromCloud().finally(function() {
        wx.hideLoading()
        navigate()
      })
      return
    }
    navigate()
  }
})
