var poolPageFactory = require("../../utils/poolPageFactory")

poolPageFactory.createPoolPage({
  poolSide: "demand",
  intentPoolKey: "demands",
  favoriteIdsKey: "demands",
  tradeIdPool: "demand",
  sharePool: "demand",
  scrollTopKey: "demandPoolScrollTop",
  loadErrorTitle: "需求加载失败",
  getTypeFilterChips: function(data) {
    return data.getDemandTypeFilterChips()
  },
  getBrowseFilterOptions: function(data) {
    return data.getDemandBrowseFilterOptions()
  },
  getAllItems: function(data) {
    return data.getDemands()
  },
  prepareListForView: function(data, sorted) {
    return data.prepareDemandListForView(sorted)
  },
  markViewed: function(data, id) {
    data.markDemandViewed(id)
  },
  methods: {
    goPublish: function() {
      var data = require("../../utils/data")
      if (data.isUserPoolPublishBlocked()) {
        data.promptStaffUseProxyPublish()
        return
      }
      if (!data.isUserRegistered()) {
        wx.navigateTo({
          url: data.buildLoginGateUrl({
            action: "submit-demand",
            redirect: "/pages/submit/submit?type=demand"
          })
        })
        return
      }
      var url = "/pages/submit/submit?type=demand"
      if (!data.ensureSubmitListingAccess("demand", { redirect: url })) {
        return
      }
      wx.navigateTo({
        url: url
      })
    },

    goMatchResource: function(event) {
      var data = require("../../utils/data")
      var item = this.data.items.find(function(entry) {
        return entry.id === event.currentTarget.dataset.id
      })
      if (!item || !data.canMatchToDemandListing(item.id)) {
        return
      }
      var connectUrl = data.getMatchSubmitUrl(item.id, item.title)
      if (!data.ensureMatchAccess({ redirect: connectUrl })) {
        return
      }
      wx.navigateTo({ url: connectUrl })
    }
  }
})
