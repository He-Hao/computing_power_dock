Page({
  data: {
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
    passwordStrength: { text: "", width: 0, level: 0 },
    submitLoading: false
  },

  onLoad() {
    const data = require("../../utils/data")
    if (!data.isUserRegistered()) {
      data.promptRegistration({
        redirect: "/pages/change-password/change-password"
      })
    }
  },

  onOldPasswordInput(event) {
    this.setData({
      oldPassword: (event.detail && event.detail.value) || ""
    })
  },

  onNewPasswordInput(event) {
    const data = require("../../utils/data")
    var password = (event.detail && event.detail.value) || ""
    this.setData({
      newPassword: password,
      passwordStrength: data.getPasswordStrength(password)
    })
  },

  onConfirmPasswordInput(event) {
    this.setData({
      confirmPassword: (event.detail && event.detail.value) || ""
    })
  },

  submitChangePassword() {
    const data = require("../../utils/data")
    if (!data.isUserRegistered()) {
      wx.showToast({ title: "请先登录", icon: "none" })
      return
    }
    this.setData({ submitLoading: true })
    data.changePasswordAsync({
      oldPassword: this.data.oldPassword,
      newPassword: this.data.newPassword,
      confirmPassword: this.data.confirmPassword
    }).then(function(result) {
      this.setData({ submitLoading: false })
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: "none" })
        return
      }
      wx.showToast({ title: "密码已更新", icon: "success" })
      setTimeout(function() {
        wx.navigateBack({
          fail: function() {
            wx.switchTab({ url: "/pages/mine/mine" })
          }
        })
      }.bind(this), 600)
    }.bind(this)).catch(function(error) {
      this.setData({ submitLoading: false })
      wx.showToast({ title: error.message || "修改失败", icon: "none" })
    })
  }
})
