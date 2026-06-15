Page({
  onLoad(options) {
    const data = require("../../utils/data")
    if (data.isUserRegistered()) {
      if (options.redirect) {
        data.navigateToPath(decodeURIComponent(options.redirect))
      } else {
        wx.switchTab({ url: "/pages/home/home" })
      }
      return
    }
    var action = options.action || "default"
    var redirect = options.redirect ? decodeURIComponent(options.redirect) : ""
    wx.redirectTo({
      url: data.buildAuthUrl({
        action: action,
        redirect: redirect
      })
    })
  }
})
