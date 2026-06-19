Page({
  data: {
    keyword: "",
    activePool: "all",
    activeStatus: "published",
    poolFilters: [
      { value: "all", label: "全部" },
      { value: "resource", label: "资源" },
      { value: "demand", label: "需求" }
    ],
    statusFilters: [
      { value: "published", label: "已发布" },
      { value: "closed", label: "已关闭" },
      { value: "all", label: "全部状态" }
    ],
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    hasMore: false,
    loading: false,
    loadingMore: false,
    takingDownId: ""
  },

  onShow() {
    const data = require("../../utils/data")
    const adminModule = require("../../utils/admin")
    if (!data.isUserRegistered()) {
      wx.showToast({ title: "请先登录", icon: "none" })
      setTimeout(function() {
        wx.navigateTo({
          url: "/pages/login/login?redirect=" + encodeURIComponent("/pages/admin-listings/admin-listings")
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
    this.loadListings(true)
  },

  onPullDownRefresh() {
    this.loadListings(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) {
      return
    }
    this.loadListings(false)
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value || "" })
  },

  setPoolFilter(event) {
    var value = event.currentTarget.dataset.value || "all"
    if (value === this.data.activePool) {
      return
    }
    this.setData({ activePool: value }, function() {
      this.loadListings(true)
    }.bind(this))
  },

  setStatusFilter(event) {
    var value = event.currentTarget.dataset.value || "published"
    if (value === this.data.activeStatus) {
      return
    }
    this.setData({ activeStatus: value }, function() {
      this.loadListings(true)
    }.bind(this))
  },

  searchListings() {
    this.loadListings(true)
  },

  loadListings(reset) {
    const data = require("../../utils/data")
    if (reset) {
      this.setData({ loading: true, page: 1 })
    } else {
      this.setData({ loadingMore: true })
    }
    var nextPage = reset ? 1 : this.data.page + 1
    return data.adminSearchPublishedListingsAsync({
      keyword: this.data.keyword,
      pool: this.data.activePool,
      status: this.data.activeStatus,
      page: nextPage,
      pageSize: this.data.pageSize
    }).then(function(result) {
      if (!result.ok) {
        wx.showToast({ title: result.message || "加载失败", icon: "none" })
        this.setData({ loading: false, loadingMore: false })
        return
      }
      var items = reset ? (result.items || []) : (this.data.items || []).concat(result.items || [])
      this.setData({
        items: items,
        total: result.total || 0,
        page: nextPage,
        hasMore: !!result.hasMore,
        loading: false,
        loadingMore: false
      })
    }.bind(this)).catch(function(error) {
      this.setData({ loading: false, loadingMore: false })
      wx.showToast({ title: error.message || "加载失败", icon: "none" })
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
          this.loadListings(true)
        }.bind(this)).catch(function(error) {
          wx.showToast({ title: error.message || "下架失败", icon: "none" })
        }).finally(function() {
          this.setData({ takingDownId: "" })
        }.bind(this))
      }.bind(this)
    })
  }
})
