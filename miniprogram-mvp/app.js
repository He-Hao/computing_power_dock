const data = require("./utils/data")
const config = require("./utils/config")

App({
  onLaunch() {
    if (wx.cloud && config.useCloud) {
      var cloudOptions = { traceUser: true }
      if (config.cloudEnvId) {
        cloudOptions.env = config.cloudEnvId
      } else {
        console.warn(
          "[云开发] cloudEnvId 为空，将使用开发者工具当前选中的云环境。" +
          "若出现 Failed to fetch，请在工具栏「云开发」中开通并选择环境，或复制 utils/config.local.js.example 为 config.local.js 并填写 cloudEnvId。"
        )
      }
      wx.cloud.init(cloudOptions)
    }

    try {
      if (data.isCloudEnabled()) {
        var isGuestLaunch = !data.isUserRegistered()
        var syncPromise = isGuestLaunch
          ? data.refreshAllPublicListings({ silent: true })
          : data.validateDeviceSessionOnLaunch().then(function() {
            if (!data.isUserRegistered()) {
              return data.refreshAllPublicListings({ silent: true })
            }
            return data.isStaffUser()
              ? data.refreshStaffLaunchFromCloud()
              : data.refreshPoolPagesFromCloud()
          })
        syncPromise.then(function() {
          data.updateMineTabBadge()
        }).catch(function(error) {
          data.updateMineTabBadge()
          console.warn("云端拉取失败", error)
          if (isGuestLaunch) {
            return
          }
          var msg = error && error.message ? error.message : "拉取失败"
          if (data.isUserRegistered() && msg.indexOf("timeout") > -1) {
            return
          }
          if (!config.cloudEnvId) {
            msg = msg + "。真机预览请在 utils/config.js 填写 cloudEnvId。"
          }
          wx.showModal({
            title: "云端数据未联通",
            content: msg + "。请按 09_云开发部署指南.md 完成配置。",
            showCancel: false
          })
        })
      } else {
        data.ensureBlankPlatform()
        data.updateMineTabBadge()
      }
    } catch (error) {
      console.warn("平台初始化失败", error)
    }
  },

  globalData: {
    userProfile: null,
    filterIntent: null,
    resourcePoolScrollTop: 0,
    demandPoolScrollTop: 0,
    opsProxyNeedsRefresh: false,
    poolNeedsForceRefresh: false
  }
})
