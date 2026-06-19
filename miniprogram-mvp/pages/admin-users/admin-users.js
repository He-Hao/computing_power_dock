Page({
  data: {
    keyword: "",
    activeFilter: "all",
    filterOptions: [
      { value: "all", label: "全部" },
      { value: "normal", label: "普通用户" },
      { value: "staff", label: "运营账号" },
      { value: "disabled", label: "已禁用" }
    ],
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    hasMore: false,
    loading: false,
    loadingMore: false
  },

  onShow() {
    const data = require("../../utils/data")
    const adminModule = require("../../utils/admin")
    if (!data.isUserRegistered()) {
      wx.showToast({ title: "请先登录", icon: "none" })
      setTimeout(function() {
        wx.navigateTo({
          url: "/pages/login/login?redirect=" + encodeURIComponent("/pages/admin-users/admin-users")
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
    if (this.data.items.length === 0) {
      this.loadUsers(true)
    }
  },

  onPullDownRefresh() {
    this.loadUsers(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) {
      return
    }
    this.loadUsers(false)
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value || "" })
  },

  setFilter(event) {
    var value = event.currentTarget.dataset.value || "all"
    if (value === this.data.activeFilter) {
      return
    }
    this.setData({ activeFilter: value }, function() {
      this.loadUsers(true)
    }.bind(this))
  },

  searchUsers() {
    this.loadUsers(true)
  },

  loadUsers(reset) {
    const data = require("../../utils/data")
    if (reset) {
      this.setData({ loading: true, page: 1 })
    } else {
      this.setData({ loadingMore: true })
    }
    var nextPage = reset ? 1 : this.data.page + 1
    return data.adminListUsersAsync({
      keyword: this.data.keyword,
      filter: this.data.activeFilter,
      page: nextPage,
      pageSize: this.data.pageSize
    }).then(function(result) {
      if (!result.ok) {
        wx.showToast({ title: result.message || "加载失败", icon: "none" })
        this.setData({ loading: false, loadingMore: false })
        return
      }
      var items = reset ? (result.items || []) : (this.data.items || []).concat(result.items || [])
      const adminUserView = require("../../utils/adminUserView")
      this.setData({
        items: adminUserView.enrichAdminUserListItemsBrief(items),
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

  openUserDetail(event) {
    var phone = event.currentTarget.dataset.phone
    if (!phone) {
      return
    }
    wx.navigateTo({
      url: "/pages/admin-user-detail/admin-user-detail?phone=" + phone
    })
  },

  copyUserText(event) {
    const copyText = require("../../utils/copyText")
    var text = event.currentTarget.dataset.text || ""
    copyText.copyTextToClipboard(text, {
      emptyTip: "无内容可复制",
      successTip: "已复制"
    })
  }
})
