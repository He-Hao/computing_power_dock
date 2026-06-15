Page({
  data: {
    intents: [],
    selectedIntent: "",
    submitting: false
  },

  onLoad() {
    const data = require("../../utils/data")
    if (!data.isUserRegistered()) {
      wx.redirectTo({
        url: data.buildLoginUrl("/pages/onboard/onboard")
      })
      return
    }
    if (data.isStaffUser()) {
      wx.switchTab({ url: "/pages/mine/mine" })
      return
    }
    if (!data.needsOnboarding()) {
      var shareUrl = data.resolveShareResumeUrl()
      if (shareUrl) {
        data.navigateToPath(shareUrl)
        return
      }
      wx.switchTab({ url: "/pages/home/home" })
      return
    }
    this.setData({
      intents: data.getUserIntentOptions()
    })
  },

  selectIntent(event) {
    this.setData({
      selectedIntent: event.currentTarget.dataset.value
    })
  },

  confirmIntent() {
    if (this.data.submitting) {
      return
    }
    if (!this.data.selectedIntent) {
      wx.showToast({ title: "请先选择你的目标", icon: "none" })
      return
    }
    this.setData({ submitting: true })
    const data = require("../../utils/data")
    var self = this
    data.completeOnboarding(this.data.selectedIntent).then(function() {
      var intent = self.data.selectedIntent
      var actionUrl = data.getIntentAction(intent)
      if ((intent === "demand" || intent === "supply") && !data.canSubmitListing()) {
        var listingType = intent === "supply" ? "resource" : "demand"
        if (!data.ensureSubmitListingAccess(listingType, {
          redirect: actionUrl,
          onDismiss: function() {
            self.setData({ submitting: false })
          }
        })) {
          return
        }
      }
      wx.showToast({ title: "已记录你的目标", icon: "success" })
      setTimeout(function() {
        data.navigateToPath(actionUrl)
      }, 500)
    }).catch(function(error) {
      self.setData({ submitting: false })
      wx.showToast({ title: error.message || "保存失败", icon: "none" })
    })
  },

  skipOnboard() {
    if (this.data.submitting) {
      return
    }
    this.setData({ submitting: true })
    const data = require("../../utils/data")
    var self = this
    data.completeOnboarding("browse").then(function() {
      wx.switchTab({ url: "/pages/home/home" })
    }).catch(function() {
      wx.switchTab({ url: "/pages/home/home" })
    }).finally(function() {
      self.setData({ submitting: false })
    })
  }
})
