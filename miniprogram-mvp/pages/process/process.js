Page({
  data: {
    steps: []
  },

  onLoad() {
    try {
      const data = require("../../utils/data")
      this.setData({
        steps: data.getProcessSteps().map(function(item, index) {
        return {
          displayIndex: index + 1,
          title: item.title,
          text: item.text
        }
      })
      })
    } catch (error) {
      wx.showToast({ title: "流程加载失败", icon: "none" })
    }
  },

  goMatch() {
    wx.navigateTo({
      url: "/pages/submit/submit?type=match"
    })
  }
})
