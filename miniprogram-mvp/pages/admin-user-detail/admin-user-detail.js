Page({
  data: {
    phone: "",
    user: null,
    detailRows: [],
    certImages: [],
    attachments: [],
    imagesLoading: false,
    imageResolveError: "",
    loading: false,
    actionLoading: ""
  },

  onLoad(options) {
    var phone = String(options.phone || "").trim()
    this.setData({ phone: phone })
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: "无效手机号", icon: "none" })
      setTimeout(function() {
        wx.navigateBack()
      }, 600)
      return
    }
    this.loadUser()
  },

  onShow() {
    const data = require("../../utils/data")
    const adminModule = require("../../utils/admin")
    if (!data.isUserRegistered()) {
      wx.showToast({ title: "请先登录", icon: "none" })
      setTimeout(function() {
        wx.navigateTo({
          url: "/pages/login/login?redirect=" + encodeURIComponent("/pages/admin-user-detail/admin-user-detail?phone=" + this.data.phone)
        })
      }.bind(this), 500)
      return
    }
    if (!data.isPlatformAdminUser()) {
      wx.showToast({ title: "仅平台管理员可用", icon: "none" })
      setTimeout(function() {
        wx.navigateBack({
          fail: function() {
            wx.switchTab({ url: "/pages/mine/mine" })
          }
        })
      }, 500)
      return
    }
    adminModule.guardStaffWorkMode({ redirect: "back" })
  },

  onPullDownRefresh() {
    this.loadUser().finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  loadUser() {
    const data = require("../../utils/data")
    const adminUserView = require("../../utils/adminUserView")
    var phone = this.data.phone
    if (!/^1\d{10}$/.test(phone)) {
      return Promise.resolve()
    }
    this.setData({ loading: true })
    return data.adminLookupUserAsync(phone).then(function(result) {
      if (!result.ok || !result.user) {
        this.setData({
          user: null,
          detailRows: [],
          certImages: [],
          attachments: [],
          imagesLoading: false,
          imageResolveError: "",
          loading: false
        })
        wx.showToast({ title: result.message || "未找到用户", icon: "none" })
        return
      }
      var user = adminUserView.enrichAdminUserListItem(result.user)
      this.applyUserDetail(user)
    }.bind(this)).catch(function(error) {
      this.setData({ loading: false })
      wx.showToast({ title: error.message || "加载失败", icon: "none" })
    }.bind(this))
  },

  openAccountManage() {
    var phone = this.data.phone
    if (!phone) {
      return
    }
    wx.navigateTo({
      url: "/pages/admin-governance/admin-governance?tab=account&phone=" + phone
    })
  },

  disableAccount() {
    const data = require("../../utils/data")
    var phone = this.data.phone
    if (!phone) {
      return
    }
    wx.showModal({
      title: "禁用账号",
      editable: true,
      placeholderText: "填写禁用原因（可选）",
      confirmText: "确认禁用",
      confirmColor: "#c0392b",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        this.setData({ actionLoading: "disable" })
        data.adminDisableAccountAsync(phone, res.content || "").then(function(result) {
          if (!result.ok) {
            wx.showToast({ title: result.message || "禁用失败", icon: "none" })
            return
          }
          var tip = "已禁用"
          if (result.takenDownCount > 0) {
            tip += "，并下架 " + result.takenDownCount + " 条商机"
          }
          wx.showToast({ title: tip, icon: "success" })
          this.loadUser()
        }.bind(this)).catch(function(error) {
          wx.showToast({ title: error.message || "禁用失败", icon: "none" })
        }).finally(function() {
          this.setData({ actionLoading: "" })
        }.bind(this))
      }.bind(this)
    })
  },

  enableAccount() {
    const data = require("../../utils/data")
    var phone = this.data.phone
    if (!phone) {
      return
    }
    wx.showModal({
      title: "解除禁用",
      content: "确认恢复该账号的正常登录与发布权限？",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        this.setData({ actionLoading: "enable" })
        data.adminEnableAccountAsync(phone).then(function(result) {
          if (!result.ok) {
            wx.showToast({ title: result.message || "操作失败", icon: "none" })
            return
          }
          wx.showToast({ title: "已解除禁用", icon: "success" })
          this.loadUser()
        }.bind(this)).catch(function(error) {
          wx.showToast({ title: error.message || "操作失败", icon: "none" })
        }).finally(function() {
          this.setData({ actionLoading: "" })
        }.bind(this))
      }.bind(this)
    })
  },

  applyUserDetail(user) {
    const data = require("../../utils/data")
    const cloudStore = require("../../utils/cloudStore")
    var certImages = (user && user.certImages) || []
    var attachments = (user && user.attachments) || []
    var hasImages = certImages.length > 0 || attachments.length > 0
    var basePatch = {
      user: user,
      detailRows: (user && user.detailRows) || [],
      loading: false
    }

    if (!hasImages) {
      this.setData(Object.assign({}, basePatch, {
        certImages: [],
        attachments: [],
        imagesLoading: false,
        imageResolveError: ""
      }))
      return
    }

    this.setData(Object.assign({}, basePatch, {
      certImages: certImages,
      attachments: attachments,
      imagesLoading: true,
      imageResolveError: ""
    }))

    var resolveOptions = { adminResolve: true }
    var resolveTasks = []
    if (certImages.length > 0) {
      resolveTasks.push(cloudStore.resolveCloudImageUrls(certImages, resolveOptions).then(function(resolved) {
        return { certImages: resolved }
      }))
    }
    if (attachments.length > 0) {
      resolveTasks.push(data.resolveSubmissionAttachments(attachments, resolveOptions).then(function(resolved) {
        return {
          attachments: resolved.map(function(entry) {
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

    Promise.all(resolveTasks).then(function(parts) {
      var patch = {}
      parts.forEach(function(part) {
        patch = Object.assign(patch, part)
      })
      var unresolved = []
      ;(patch.certImages || []).concat(patch.attachments || []).forEach(function(imageItem) {
        if (imageItem && imageItem.unavailable) {
          unresolved.push(imageItem.label || "图片")
        }
      })
      this.setData({
        certImages: patch.certImages || certImages,
        attachments: patch.attachments || attachments,
        imagesLoading: false,
        imageResolveError: unresolved.length > 0
          ? "部分附件未能加载，请确认已部署最新 tradeApi 云函数后重试。"
          : ""
      })
    }.bind(this)).catch(function(error) {
      this.setData({
        certImages: certImages,
        attachments: attachments,
        imagesLoading: false,
        imageResolveError: (error && error.message) || "附件加载失败，请重新进入或部署云函数后重试"
      })
    }.bind(this))
  },

  previewUserImage(event) {
    var url = event.currentTarget.dataset.url
    if (!url) {
      return
    }
    var urls = (this.data.certImages || []).concat(this.data.attachments || []).filter(function(item) {
      return item && !item.unavailable && (item.fileType === "image" || !item.fileType) && !!(item.displayUrl || item.url)
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

  copyUserText(event) {
    const copyText = require("../../utils/copyText")
    var text = event.currentTarget.dataset.text || ""
    copyText.copyTextToClipboard(text, {
      emptyTip: "无内容可复制",
      successTip: "已复制"
    })
  }
})
