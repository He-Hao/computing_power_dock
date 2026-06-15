Page({
  _recordsRefreshing: false,
  _lastRecordsRefresh: 0,

  data: Object.assign({
    records: []
  }, require("../../utils/pagedList").initialData()),

  onShow() {
    this.refreshFromCloud(false)
  },

  refreshFromCloud(force) {
    const data = require("../../utils/data")
    if (!data.isCloudEnabled()) {
      this.loadRecords()
      return Promise.resolve()
    }
    var now = Date.now()
    if (!force && (this._recordsRefreshing || now - this._lastRecordsRefresh < 12000)) {
      this.loadRecords()
      return Promise.resolve()
    }
    this._recordsRefreshing = true
    return data.refreshFromCloudForMine().then(function() {
      this._lastRecordsRefresh = Date.now()
      this.loadRecords()
    }.bind(this)).catch(function(error) {
      console.warn("认证记录同步失败", error)
      this.loadRecords()
      if (force) {
        wx.showToast({ title: "同步失败，显示本地数据", icon: "none" })
      }
    }.bind(this)).finally(function() {
      this._recordsRefreshing = false
    }.bind(this))
  },

  onPullDownRefresh() {
    this.refreshFromCloud(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  loadRecords() {
    try {
      const data = require("../../utils/data")
      const pagedList = require("../../utils/pagedList")
      const records = data.getCertifySubmissions().map(function(item) {
        return data.enrichCertifyForRecordsList(item)
      })
      var patch = pagedList.applyPage(records, this, { reset: true })
      patch.records = patch.items
      delete patch.items
      this.setData(patch)
    } catch (error) {
      wx.showToast({ title: "记录加载失败", icon: "none" })
    }
  },

  onReachBottom() {
    require("../../utils/pagedList").runLoadMore(this, { listKey: "records" })
  },

  goRecord(event) {
    wx.navigateTo({
      url: "/pages/cert-record/cert-record?id=" + event.currentTarget.dataset.id
    })
  }
})
