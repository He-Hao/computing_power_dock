Page({
  _reviewRefreshing: false,
  _lastReviewRefresh: 0,

  data: {
    reviewType: "submission",
    reviewId: "",
    item: null,
    imagesLoading: false,
    imageResolveError: "",
    reviewLoading: ""
  },

  onLoad(options) {
    const adminModule = require("../../utils/admin")
    if (!adminModule.guardStaffPageAccess({ redirect: "back" })) {
      return
    }
    if (!adminModule.guardStaffWorkMode({ redirect: "back" })) {
      return
    }
    this.setData({
      reviewType: options.reviewType || "submission",
      reviewId: options.id || ""
    })
    this.loadReview()
  },

  onShow() {
    const adminModule = require("../../utils/admin")
    if (!adminModule.guardStaffPageAccess({ toast: false, redirect: "back" })) {
      return
    }
    if (!adminModule.guardStaffWorkMode({ toast: false, redirect: "back" })) {
      return
    }
    this.refreshReviewFromCloud(false)
  },

  refreshReviewFromCloud(force) {
    const data = require("../../utils/data")
    if (!data.isCloudEnabled()) {
      this.loadReview()
      return Promise.resolve()
    }
    var now = Date.now()
    if (!force && (this._reviewRefreshing || now - this._lastReviewRefresh < 12000)) {
      return Promise.resolve()
    }
    this._reviewRefreshing = true
    return data.refreshAdminFromCloud().then(function() {
      this._lastReviewRefresh = Date.now()
      this.loadReview()
    }.bind(this)).catch(function(error) {
      console.warn("审核详情同步失败", error)
      this.loadReview()
      if (force) {
        wx.showToast({ title: "同步失败，显示本地数据", icon: "none" })
      }
    }.bind(this)).finally(function() {
      this._reviewRefreshing = false
    }.bind(this))
  },

  onPullDownRefresh() {
    this.refreshReviewFromCloud(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  loadReview() {
    const data = require("../../utils/data")
    const cloudStore = require("../../utils/cloudStore")
    const item = data.getAdminReviewDetail(this.data.reviewType, this.data.reviewId)
    if (!item) {
      wx.showToast({ title: "审核内容不存在", icon: "none" })
      setTimeout(function() {
        wx.navigateBack()
      }, 600)
      return
    }
    var applyItem = function(resolvedItem, errorMessage) {
      this.setData({
        item: resolvedItem,
        imagesLoading: false,
        imageResolveError: errorMessage || ""
      })
    }.bind(this)
    var resolveTasks = []
    var resolveOptions = { adminResolve: true }
    var hasImages = (item.certImages && item.certImages.length > 0)
      || (item.attachments && item.attachments.length > 0)
    if (hasImages) {
      this.setData({
        item: item,
        imagesLoading: true,
        imageResolveError: ""
      })
    } else {
      applyItem(item, "")
    }
    if (item.certImages && item.certImages.length > 0) {
      resolveTasks.push(cloudStore.resolveCloudImageUrls(item.certImages, resolveOptions).then(function(certImages) {
        return { certImages: certImages }
      }))
    }
    if (item.attachments && item.attachments.length > 0) {
      resolveTasks.push(require("../../utils/data").resolveSubmissionAttachments(item.attachments, resolveOptions).then(function(attachments) {
        return {
          attachments: attachments.map(function(entry) {
            return {
              label: entry.name || entry.label || "附件",
              url: entry.displayUrl || entry.url,
              displayUrl: entry.displayUrl || entry.url,
              fileType: entry.fileType || "file",
              unavailable: !!entry.unavailable,
              unavailableHint: entry.unavailableHint || ""
            }
          })
        }
      }))
    }
    if (resolveTasks.length > 0) {
      Promise.all(resolveTasks).then(function(parts) {
        var patch = {}
        parts.forEach(function(part) {
          patch = Object.assign(patch, part)
        })
        var merged = Object.assign({}, item, patch)
        var unresolved = []
        ;(merged.certImages || []).concat(merged.attachments || []).forEach(function(imageItem) {
          if (imageItem && imageItem.unavailable) {
            unresolved.push(imageItem.label || "图片")
          }
        })
        applyItem(merged, unresolved.length > 0
          ? "部分图片未能加载，请确认已部署最新 tradeApi 云函数后重试。"
          : "")
      }).catch(function(error) {
        applyItem(item, (error && error.message) || "认证图片加载失败，请重新进入或部署云函数后重试")
        wx.showToast({
          title: "认证图片加载失败",
          icon: "none"
        })
      })
      return
    }
  },

  approveReview() {
    const item = this.data.item
    if (!item || this.data.reviewLoading) {
      return
    }
    const data = require("../../utils/data")
    var isProxyConnect = !!item.isProxyConnectReview
    var isListingReport = !!item.isListingReport
    if (isListingReport) {
      wx.showModal({
        title: "举报成立",
        content: "确认举报成立并下架被举报商机？",
        confirmText: "成立下架",
        confirmColor: "#176b5b",
        success: function(res) {
          if (!res.confirm) {
            return
          }
          this.setData({ reviewLoading: "approve" })
          data.approveListingReportReview(item.submissionId).then(function() {
            wx.showToast({ title: "已下架商机", icon: "success" })
            setTimeout(function() {
              wx.navigateBack()
            }, 600)
          }).catch(function(error) {
            wx.showToast({ title: error.message || "操作失败", icon: "none" })
          }).finally(function() {
            this.setData({ reviewLoading: "" })
          }.bind(this))
        }.bind(this)
      })
      return
    }
    this.setData({ reviewLoading: "approve" })
    var actionPromise
    if (item.reviewType === "listing") {
      actionPromise = data.approveListingReview(item.id)
    } else {
      actionPromise = data.approveSubmissionReview(item.submissionId)
    }
    Promise.resolve(actionPromise).then(function() {
      wx.showToast({ title: isProxyConnect ? "已批准对接" : "已通过", icon: "success" })
      setTimeout(function() {
        wx.navigateBack()
      }, 600)
    }).catch(function(error) {
      wx.showToast({ title: error.message || "操作失败", icon: "none" })
    }).finally(function() {
      this.setData({ reviewLoading: "" })
    }.bind(this))
  },

  rejectReview() {
    const item = this.data.item
    if (!item || this.data.reviewLoading) {
      return
    }
    const data = require("../../utils/data")
    var isProxyConnect = !!item.isProxyConnectReview
    var isListingReport = !!item.isListingReport
    wx.showModal({
      title: isListingReport ? "驳回举报" : (isProxyConnect ? "驳回对接" : "驳回审核"),
      editable: true,
      placeholderText: isListingReport ? "请填写核查说明（可选）" : "请填写驳回说明，将通知申请人",
      confirmText: isListingReport ? "驳回举报" : "确认驳回",
      confirmColor: "#c0392b",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        var rejectReason = (res.content || "").trim()
        if (!rejectReason && !isListingReport) {
          wx.showToast({ title: "请填写驳回说明", icon: "none" })
          return
        }
        this.setData({ reviewLoading: "reject" })
        var actionPromise
        if (item.reviewType === "listing") {
          actionPromise = data.rejectListingReview(item.id, rejectReason)
        } else if (isListingReport) {
          actionPromise = data.rejectListingReportReview(item.submissionId, rejectReason || "经核查未发现违规，举报驳回。")
        } else {
          actionPromise = data.rejectSubmissionReview(item.submissionId, rejectReason)
        }
        Promise.resolve(actionPromise).then(function() {
          wx.showToast({ title: "已驳回", icon: "success" })
          setTimeout(function() {
            wx.navigateBack()
          }, 600)
        }).catch(function(error) {
          wx.showToast({ title: error.message || "操作失败", icon: "none" })
        }).finally(function() {
          this.setData({ reviewLoading: "" })
        }.bind(this))
      }.bind(this)
    })
  },

  openReportedListing() {
    const item = this.data.item
    if (!item || !item.reportListingId) {
      return
    }
    const data = require("../../utils/data")
    wx.navigateTo({
      url: data.getDetailPageUrl(item.reportListingId)
    })
  },

  previewCertImage(event) {
    const url = event.currentTarget.dataset.url
    if (!url || !this.data.item) {
      return
    }
    var images = (this.data.item.certImages || []).concat(this.data.item.attachments || [])
    const urls = images.filter(function(item) {
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

  copyReviewText(event) {
    const copyText = require("../../utils/copyText")
    var text = event.currentTarget.dataset.text || ""
    copyText.copyTextToClipboard(text, {
      emptyTip: "无内容可复制",
      successTip: "已复制"
    })
  }
})
