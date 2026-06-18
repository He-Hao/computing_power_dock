Page({
  _opsRefreshing: false,
  _lastOpsRefresh: 0,
  _initialTab: "pending",

  data: Object.assign({
    activeTab: "pending",
    tabFilters: [
      { value: "pending", label: "待处理" },
      { value: "history", label: "历史记录" }
    ],
    stats: { pending: 0, history: 0 },
    allItems: [],
    items: [],
    emptyTitle: "",
    emptyText: "",
    busyId: "",
    busyAction: ""
  }, require("../../utils/pagedList").initialData()),

  onLoad(options) {
    if (options && options.tab === "history") {
      this._initialTab = "history"
    }
  },

  onShow() {
    const data = require("../../utils/data")
    const adminModule = require("../../utils/admin")
    if (!data.isUserRegistered()) {
      wx.showToast({ title: "请先登录", icon: "none" })
      setTimeout(function() {
        wx.navigateTo({
          url: "/pages/login/login?redirect=" + encodeURIComponent("/pages/ops-reports/ops-reports")
        })
      }, 500)
      return
    }
    if (!adminModule.guardStaffPageAccess({ redirect: "back" })) {
      return
    }
    if (!adminModule.guardStaffWorkMode({ redirect: "back" })) {
      return
    }
    if (this._initialTab) {
      this.setData({ activeTab: this._initialTab })
      this._initialTab = ""
    }
    this.loadPage(false)
  },

  loadPage(force) {
    const data = require("../../utils/data")
    var loadPromise = Promise.resolve()
    if (!data.isCloudEnabled()) {
      this.applyListData(data)
      return loadPromise
    }
    var now = Date.now()
    if (force || (!this._opsRefreshing && now - this._lastOpsRefresh >= 12000)) {
      this._opsRefreshing = true
      loadPromise = data.refreshAdminFromCloud().then(function() {
        return data.refreshStaffListingReportsFromCloud()
      }).then(function() {
        this._lastOpsRefresh = Date.now()
        this.applyListData(data)
      }.bind(this)).catch(function() {
        this.applyListData(data)
      }.bind(this)).finally(function() {
        this._opsRefreshing = false
      }.bind(this))
    } else {
      this.applyListData(data)
    }
    return loadPromise
  },

  onPullDownRefresh() {
    this.loadPage(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  applyListData(data) {
    var pending = data.getListingReportReviewQueue().map(function(item) {
      return data.enrichListingReportForList(item.submission || item)
    })
    var history = data.getStaffListingReportHistory().map(function(item) {
      return data.enrichListingReportForList(item)
    })
    var allItems = this.data.activeTab === "pending" ? pending : history
    var pagedList = require("../../utils/pagedList")
    var patch = pagedList.applyPage(allItems, this, { reset: true })
    patch.allItems = allItems
    patch.items = patch.items
    patch.stats = {
      pending: pending.length,
      history: history.length
    }
    patch.filteredCount = allItems.length
    patch.emptyTitle = this.data.activeTab === "pending" ? "暂无待处理举报" : "暂无历史记录"
    patch.emptyText = this.data.activeTab === "pending"
      ? "用户举报的虚假信息会出现在这里"
      : "已处理的举报会保留在此供查阅"
    this.setData(patch)
  },

  setTab(event) {
    var value = event.currentTarget.dataset.value
    if (!value || value === this.data.activeTab) {
      return
    }
    this.setData({ activeTab: value }, function() {
      this.applyListData(require("../../utils/data"))
    }.bind(this))
  },

  onReachBottom() {
    require("../../utils/pagedList").runLoadMore(this)
  },

  openReport(event) {
    var id = event.currentTarget.dataset.id
    if (!id) {
      return
    }
    wx.navigateTo({
      url: "/pages/admin-review/admin-review?reviewType=submission&id=" + id
    })
  },

  approveReport(event) {
    event.stopPropagation && event.stopPropagation()
    var id = event.currentTarget.dataset.id
    const data = require("../../utils/data")
    var self = this
    wx.showModal({
      title: "举报成立",
      content: "确认举报成立并下架被举报商机？",
      confirmText: "成立下架",
      confirmColor: "#176b5b",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        self.setData({ busyId: id, busyAction: "approve" })
        data.approveListingReportReview(id).then(function() {
          wx.showToast({ title: "已下架商机", icon: "success" })
          self.loadPage(true)
        }).catch(function(error) {
          wx.showToast({ title: error.message || "操作失败", icon: "none" })
        }).finally(function() {
          self.setData({ busyId: "", busyAction: "" })
        })
      }
    })
  },

  rejectReport(event) {
    event.stopPropagation && event.stopPropagation()
    var id = event.currentTarget.dataset.id
    const data = require("../../utils/data")
    var self = this
    wx.showModal({
      title: "驳回举报",
      editable: true,
      placeholderText: "请填写核查说明（可选）",
      confirmText: "驳回举报",
      confirmColor: "#c0392b",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        var reason = (res.content || "").trim() || "经核查未发现违规，举报驳回。"
        self.setData({ busyId: id, busyAction: "reject" })
        data.rejectListingReportReview(id, reason).then(function() {
          wx.showToast({ title: "已驳回举报", icon: "success" })
          self.loadPage(true)
        }).catch(function(error) {
          wx.showToast({ title: error.message || "操作失败", icon: "none" })
        }).finally(function() {
          self.setData({ busyId: "", busyAction: "" })
        })
      }
    })
  }
})
