Page({
  onLoad(options) {
    var app = getApp()
    app.globalData = app.globalData || {}
    app.globalData.opsReviewTab = options.tab || "all"
    wx.switchTab({
      url: "/pages/mine/mine"
    })
  }
})
