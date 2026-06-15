Page({
  onLoad(options) {
    const data = require("../../utils/data")
    if (data.isUserRegistered()) {
      var registeredRedirect = options.redirect ? decodeURIComponent(options.redirect) : ""
      if (registeredRedirect) {
        data.navigateToPath(registeredRedirect)
      } else {
        wx.switchTab({ url: "/pages/mine/mine" })
      }
      return
    }
    wx.redirectTo({
      url: data.buildRegisterUrl(options.redirect ? decodeURIComponent(options.redirect) : "")
    })
  }
})
