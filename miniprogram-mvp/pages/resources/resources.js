var poolPageFactory = require("../../utils/poolPageFactory")

poolPageFactory.createPoolPage({
  poolSide: "resource",
  intentPoolKey: "resources",
  favoriteIdsKey: "resources",
  tradeIdPool: "resource",
  sharePool: "resource",
  scrollTopKey: "resourcePoolScrollTop",
  loadErrorTitle: "资源加载失败",
  getTypeFilterChips: function(data) {
    return data.getResourceTypeFilterChips()
  },
  getBrowseFilterOptions: function(data) {
    return data.getResourceBrowseFilterOptions()
  },
  getAllItems: function(data) {
    return data.getResources()
  },
  prepareListForView: function(data, sorted) {
    return data.prepareResourceListForView(sorted)
  },
  markViewed: function(data, id) {
    data.markResourceViewed(id)
  },
  methods: {
    goPublish: function() {
      var data = require("../../utils/data")
      if (data.isUserPoolPublishBlocked()) {
        data.promptStaffUseProxyPublish()
        return
      }
      if (!data.isUserRegistered()) {
        data.promptRegistration({
          redirect: "/pages/submit/submit?type=resource"
        })
        return
      }
      var url = "/pages/submit/submit?type=resource"
      if (!data.ensureSubmitListingAccess("resource", { redirect: url })) {
        return
      }
      wx.navigateTo({
        url: url
      })
    },

    applyConnect: function(event) {
      var data = require("../../utils/data")
      var item = this.data.items.find(function(entry) {
        return entry.id === event.currentTarget.dataset.id
      })
      if (!item || !data.canApplyConnectToListing(item.id)) {
        return
      }
      var connectUrl = data.getConnectSubmitUrl(item.id, item.title)
      if (!data.ensureConnectAccess({ redirect: connectUrl })) {
        return
      }
      wx.navigateTo({ url: connectUrl })
    }
  }
})
