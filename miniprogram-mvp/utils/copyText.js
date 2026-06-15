function copyTextToClipboard(text, options) {
  options = options || {}
  var content = String(text || "").trim()
  if (!content) {
    wx.showToast({ title: options.emptyTip || "无内容可复制", icon: "none" })
    return
  }
  wx.setClipboardData({
    data: content,
    success: function() {
      wx.showToast({ title: options.successTip || "已复制", icon: "success" })
    },
    fail: function() {
      wx.showToast({ title: options.failTip || "复制失败", icon: "none" })
    }
  })
}

module.exports = {
  copyTextToClipboard: copyTextToClipboard
}
