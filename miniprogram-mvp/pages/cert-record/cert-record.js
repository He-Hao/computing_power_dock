Page({
  _recordRefreshing: false,
  _lastRecordRefresh: 0,

  data: {
    record: null,
    certImages: [],
    detailRows: [],
    flowTimeline: []
  },

  onLoad(options) {
    this.recordId = options.id || ""
    this.loadRecord()
  },

  onShow() {
    this.refreshRecordFromCloud(false)
  },

  refreshRecordFromCloud(force) {
    const data = require("../../utils/data")
    if (!data.isCloudEnabled()) {
      this.loadRecord()
      return Promise.resolve()
    }
    var now = Date.now()
    if (!force && (this._recordRefreshing || now - this._lastRecordRefresh < 12000)) {
      this.loadRecord()
      return Promise.resolve()
    }
    this._recordRefreshing = true
    return data.refreshFromCloudForMine().then(function() {
      this._lastRecordRefresh = Date.now()
      this.loadRecord()
    }.bind(this)).catch(function(error) {
      console.warn("认证详情同步失败", error)
      this.loadRecord()
      if (force) {
        wx.showToast({ title: "同步失败，显示本地数据", icon: "none" })
      }
    }.bind(this)).finally(function() {
      this._recordRefreshing = false
    }.bind(this))
  },

  onPullDownRefresh() {
    this.refreshRecordFromCloud(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  loadRecord() {
    try {
      const data = require("../../utils/data")
      const cloudStore = require("../../utils/cloudStore")
      const record = data.getSubmission(this.recordId)
      if (!record || record.type !== "certify") {
        wx.showToast({ title: "审批记录不存在", icon: "none" })
        return
      }

      data.markRejectionNoticeRead(record)

      var levelConfig = data.getCertLevelConfig(record.certLevel || "card")
      var certImages = []
      if (record.cardImage) {
        certImages.push({ label: "个人名片", url: record.cardImage })
      }
      if (record.licenseImage) {
        certImages.push({ label: "营业执照", url: record.licenseImage })
      }

      var applyRecord = function(resolvedImages) {
        this.setData({
          record: Object.assign({}, record, {
            displayStatus: data.getSubmissionDisplayStatus(record),
            statusHint: data.getSubmissionDisplayHint(record),
            certLevelName: levelConfig.title
          }),
          certImages: resolvedImages,
          detailRows: data.getCertifyDetailRows(record),
          flowTimeline: data.getCertReviewTimeline(record)
        })
      }.bind(this)

      if (certImages.length > 0) {
        cloudStore.resolveCloudImageUrls(certImages).then(applyRecord)
        return
      }
      applyRecord(certImages)
    } catch (error) {
      wx.showToast({ title: "记录加载失败", icon: "none" })
    }
  },

  previewCertImage(event) {
    const url = event.currentTarget.dataset.url
    if (!url) {
      return
    }
    var urls = this.data.certImages.filter(function(item) {
      return !item.unavailable && !!(item.displayUrl || item.url)
    }).map(function(item) {
      return item.displayUrl || item.url
    })
    if (urls.length === 0) {
      wx.showToast({ title: "图片暂不可预览", icon: "none" })
      return
    }
    wx.previewImage({
      current: url,
      urls: urls
    })
  },

  goCertRecords() {
    wx.navigateBack({
      fail: function() {
        wx.redirectTo({ url: "/pages/certify/certify?view=1" })
      }
    })
  },

  goCertify() {
    wx.navigateTo({
      url: "/pages/certify/certify?view=1"
    })
  }
})
