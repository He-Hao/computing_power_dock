Page({
  data: {
    phone: "",
    user: null,
    detailRows: [],
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
        this.setData({ user: null, detailRows: [], loading: false })
        wx.showToast({ title: result.message || "未找到用户", icon: "none" })
        return
      }
      var user = adminUserView.enrichAdminUserListItem(result.user)
      this.setData({
        user: user,
        detailRows: user.detailRows || [],
        loading: false
      })
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

  copyUserText(event) {
    const copyText = require("../../utils/copyText")
    var text = event.currentTarget.dataset.text || ""
    copyText.copyTextToClipboard(text, {
      emptyTip: "无内容可复制",
      successTip: "已复制"
    })
  }
})
