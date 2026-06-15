Page({
  data: {
    activeTab: "listing",
    listingKeyword: "",
    listingPool: "all",
    listingItems: [],
    listingLoading: false,
    poolFilters: [
      { value: "all", label: "全部" },
      { value: "resource", label: "资源" },
      { value: "demand", label: "需求" }
    ],
    accountPhone: "",
    accountUser: null,
    accountSearched: false,
    accountLoading: false,
    takingDownId: "",
    accountActionLoading: ""
  },

  onShow() {
    const data = require("../../utils/data")
    const adminModule = require("../../utils/admin")
    if (!data.isUserRegistered()) {
      wx.showToast({ title: "请先登录", icon: "none" })
      setTimeout(function() {
        wx.navigateTo({
          url: "/pages/login/login?redirect=" + encodeURIComponent("/pages/admin-governance/admin-governance")
        })
      }, 500)
      return
    }
    if (!data.isPlatformAdminUser()) {
      wx.showToast({ title: "仅平台管理员可用", icon: "none" })
      setTimeout(function() {
        wx.navigateBack({
          fail: function() {
            wx.switchTab({ url: "/pages/mine/mine" })
          }
        })
      }, 500)
      return
    }
    adminModule.guardStaffWorkMode({ redirect: "back" })
  },

  onPullDownRefresh() {
    if (this.data.activeTab === "listing" && this.data.listingKeyword) {
      this.searchListings().finally(function() {
        wx.stopPullDownRefresh()
      })
      return
    }
    if (this.data.activeTab === "account" && this.data.accountPhone) {
      this.lookupAccount().finally(function() {
        wx.stopPullDownRefresh()
      })
      return
    }
    wx.stopPullDownRefresh()
  },

  switchTab(event) {
    var tab = event.currentTarget.dataset.tab
    if (!tab || tab === this.data.activeTab) {
      return
    }
    this.setData({ activeTab: tab })
  },

  onListingKeywordInput(event) {
    this.setData({ listingKeyword: event.detail.value || "" })
  },

  setListingPool(event) {
    var value = event.currentTarget.dataset.value || "all"
    this.setData({ listingPool: value })
    if (this.data.listingKeyword) {
      this.searchListings()
    }
  },

  searchListings() {
    const data = require("../../utils/data")
    var keyword = String(this.data.listingKeyword || "").trim()
    if (!keyword) {
      wx.showToast({ title: "请输入搜索内容", icon: "none" })
      return Promise.resolve()
    }
    this.setData({ listingLoading: true })
    return data.adminSearchPublishedListingsAsync({
      keyword: keyword,
      pool: this.data.listingPool
    }).then(function(result) {
      this.setData({
        listingItems: result.items || [],
        listingLoading: false
      })
      if (!result.ok) {
        wx.showToast({ title: result.message || "查询失败", icon: "none" })
      }
    }.bind(this)).catch(function(error) {
      this.setData({ listingLoading: false })
      wx.showToast({ title: error.message || "查询失败", icon: "none" })
    }.bind(this))
  },

  previewListing(event) {
    var id = event.currentTarget.dataset.id
    if (!id) {
      return
    }
    wx.navigateTo({ url: "/pages/detail/detail?id=" + id })
  },

  takeDownListing(event) {
    const data = require("../../utils/data")
    var id = event.currentTarget.dataset.id
    var title = event.currentTarget.dataset.title || id
    if (!id) {
      return
    }
    wx.showModal({
      title: "强制下架",
      content: "确认下架「" + title + "」？下架后将从公开展示池移除，关联未完结对接将自动关闭。",
      confirmText: "确认下架",
      confirmColor: "#c0392b",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        this.setData({ takingDownId: id })
        data.adminTakeDownListingAsync(id, "平台管理员强制下架，不再公开展示。").then(function(result) {
          if (!result.ok) {
            wx.showToast({ title: result.message || "下架失败", icon: "none" })
            return
          }
          wx.showToast({ title: "已下架", icon: "success" })
          this.searchListings()
        }.bind(this)).catch(function(error) {
          wx.showToast({ title: error.message || "下架失败", icon: "none" })
        }).finally(function() {
          this.setData({ takingDownId: "" })
        }.bind(this))
      }.bind(this)
    })
  },

  onAccountPhoneInput(event) {
    this.setData({ accountPhone: event.detail.value || "" })
  },

  lookupAccount() {
    const data = require("../../utils/data")
    var phone = String(this.data.accountPhone || "").trim()
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: "请输入11位手机号", icon: "none" })
      return Promise.resolve()
    }
    this.setData({ accountLoading: true, accountSearched: true })
    return data.adminLookupUserAsync(phone).then(function(result) {
      this.setData({
        accountUser: result.ok ? result.user : null,
        accountLoading: false
      })
      if (!result.ok) {
        wx.showToast({ title: result.message || "未找到账号", icon: "none" })
      }
    }.bind(this)).catch(function(error) {
      this.setData({ accountLoading: false, accountUser: null })
      wx.showToast({ title: error.message || "查询失败", icon: "none" })
    }.bind(this))
  },

  disableAccount() {
    const data = require("../../utils/data")
    var phone = this.data.accountPhone
    if (!phone) {
      return
    }
    wx.showModal({
      title: "禁用账号",
      editable: true,
      placeholderText: "填写禁用原因（可选）",
      confirmText: "确认禁用",
      confirmColor: "#c0392b",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        this.setData({ accountActionLoading: "disable" })
        data.adminDisableAccountAsync(phone, res.content || "").then(function(result) {
          if (!result.ok) {
            wx.showToast({ title: result.message || "禁用失败", icon: "none" })
            return
          }
          var tip = "已禁用"
          if (result.takenDownCount > 0) {
            tip += "，并下架 " + result.takenDownCount + " 条商机"
          }
          wx.showToast({ title: tip, icon: "success" })
          this.lookupAccount()
        }.bind(this)).catch(function(error) {
          wx.showToast({ title: error.message || "禁用失败", icon: "none" })
        }).finally(function() {
          this.setData({ accountActionLoading: "" })
        }.bind(this))
      }.bind(this)
    })
  },

  enableAccount() {
    const data = require("../../utils/data")
    var phone = this.data.accountPhone
    if (!phone) {
      return
    }
    wx.showModal({
      title: "解除禁用",
      content: "确认恢复该账号的正常登录与发布权限？",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        this.setData({ accountActionLoading: "enable" })
        data.adminEnableAccountAsync(phone).then(function(result) {
          if (!result.ok) {
            wx.showToast({ title: result.message || "操作失败", icon: "none" })
            return
          }
          wx.showToast({ title: "已解除禁用", icon: "success" })
          this.lookupAccount()
        }.bind(this)).catch(function(error) {
          wx.showToast({ title: error.message || "操作失败", icon: "none" })
        }).finally(function() {
          this.setData({ accountActionLoading: "" })
        }.bind(this))
      }.bind(this)
    })
  }
})
