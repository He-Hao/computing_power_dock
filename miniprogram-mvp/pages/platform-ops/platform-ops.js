Page({
  onShow() {
    const data = require("../../utils/data")
    if (!data.isUserRegistered()) {
      wx.showToast({ title: "请先登录", icon: "none" })
      setTimeout(function() {
        wx.navigateTo({
          url: "/pages/login/login?redirect=" + encodeURIComponent("/pages/mine/mine")
        })
      }, 500)
      return
    }
    if (!data.isStaffUser()) {
      const adminModule = require("../../utils/admin")
      adminModule.guardStaffPageAccess()
      return
    }
    wx.switchTab({ url: "/pages/mine/mine" })
  }
})
