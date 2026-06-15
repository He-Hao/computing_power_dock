Page({

  _recordsRefreshing: false,

  _lastRecordsRefresh: 0,



  data: Object.assign({

    activeFilter: "all",

    recordStatusFilter: "all",

    keyword: "",

    closingListingId: "",

    pageTitle: "提交记录",

    filters: [

      { key: "all", label: "全部" },

      { key: "connect", label: "对接" },

      { key: "resource", label: "资源" },

      { key: "demand", label: "需求" }

    ],

    recordStatusFilters: [],

    emptyText: "",

    allSubmissions: [],

    submissions: [],

    typeNames: {

      demand: "需求提交",

      resource: "资源发布",

      server: "整机需求",

      room: "机房项目",

      match: "人工撮合",

      connect: "对接申请",

      certify: "企业认证"

    }

  }, require("../../utils/pagedList").initialData()),



  onLoad(options) {

    if (options && options.filter) {

      this.initialFilter = options.filter

    }

    if (options && (options.recordStatus || options.connectStatus)) {

      this.initialRecordStatus = options.recordStatus || options.connectStatus

    }

  },



  onShow() {

    const data = require("../../utils/data")

    this.loadRecords()

    data.updateMineTabBadge()

    if (!data.isCloudEnabled()) {

      return

    }

    var now = Date.now()

    if (this._recordsRefreshing || now - this._lastRecordsRefresh < 12000) {

      return

    }

    this._recordsRefreshing = true

    data.refreshFromCloudForMine().then(function() {

      this._lastRecordsRefresh = Date.now()

      this.loadRecords()

      data.updateMineTabBadge()

    }.bind(this)).catch(function() {

      // 已有本地列表

    }.bind(this)).finally(function() {

      this._recordsRefreshing = false

    }.bind(this))

  },



  refreshRecordsFromCloud(force) {

    const data = require("../../utils/data")

    this.loadRecords()

    if (!data.isCloudEnabled()) {

      return Promise.resolve()

    }

    if (!force && this._recordsRefreshing) {

      return Promise.resolve()

    }

    this._recordsRefreshing = true

    return data.refreshFromCloudForMine().then(function() {

      this._lastRecordsRefresh = Date.now()

      this.loadRecords()

      data.updateMineTabBadge()

    }.bind(this)).catch(function() {

      this.loadRecords()

    }.bind(this)).finally(function() {

      this._recordsRefreshing = false

    }.bind(this))

  },



  onPullDownRefresh() {

    this.refreshRecordsFromCloud(true).finally(function() {

      wx.stopPullDownRefresh()

    })

  },



  loadRecords() {

    try {

      const data = require("../../utils/data")

      const allSubmissions = data.getSubmissions().filter(function(item) {

        return item.type !== "certify"

      }).map(function(item) {

        return data.enrichSubmissionForRecordsList(item, this.data.typeNames)

      }.bind(this))

      var activeFilter = this.initialFilter || this.data.activeFilter

      var recordStatusFilter = this.initialRecordStatus || this.data.recordStatusFilter

      this.initialFilter = ""

      this.initialRecordStatus = ""

      this.setData({

        allSubmissions: allSubmissions,

        activeFilter: activeFilter,

        recordStatusFilter: recordStatusFilter,

        recordStatusFilters: data.getRecordStatusFilterOptions(activeFilter),

        pageTitle: this.getPageTitle(activeFilter)

      })

      wx.setNavigationBarTitle({ title: this.getPageTitle(activeFilter) })

      this.applyFilter(activeFilter)

    } catch (error) {

      wx.showToast({ title: "记录加载失败", icon: "none" })

    }

  },



  getPageTitle(filterKey) {

    var titleMap = {

      all: "提交记录",

      connect: "对接记录",

      resource: "资源记录",

      demand: "需求记录"

    }

    return titleMap[filterKey] || "提交记录"

  },



  getEmptyText(filterKey, statusFilter) {

    if (this.data.keyword) {

      return "未找到匹配编号的记录，请检查前缀 UCON-/SRES-/SDEM- 是否完整。"

    }

    if (statusFilter && statusFilter !== "all") {

      return "没有符合该状态的记录，可切换筛选或清除搜索。"

    }

    if (filterKey === "connect") {

      return "暂无对接记录。申请对接或匹配资源后会在这里显示进度。"

    }

    if (filterKey === "resource") {

      return "暂无资源发布记录。"

    }

    if (filterKey === "demand") {

      return "暂无需求提交记录。"

    }

    return "暂无提交记录。发布资源或提交需求后，会在这里看到跟进状态。"

  },



  applyFilter(filterKey) {

    const data = require("../../utils/data")

    const pagedList = require("../../utils/pagedList")

    const allSubmissions = this.data.allSubmissions

    var submissions = allSubmissions

    if (filterKey && filterKey !== "all") {

      submissions = allSubmissions.filter(function(item) {

        return item.filterCategory === filterKey

      })

    }

    submissions = data.filterSubmissionsForRecordsStatus(

      submissions,

      filterKey,

      this.data.recordStatusFilter

    )

    submissions = data.filterSubmissionsByKeyword(submissions, this.data.keyword)

    var patch = pagedList.applyPage(submissions, this, { reset: true })

    patch.submissions = patch.items

    patch.emptyText = this.getEmptyText(filterKey, this.data.recordStatusFilter)

    delete patch.items

    this.setData(patch)

  },



  onReachBottom() {

    require("../../utils/pagedList").runLoadMore(this, { listKey: "submissions" })

  },



  onSearch(event) {

    this.setData({ keyword: event.detail.value || "" }, function() {

      this.applyFilter(this.data.activeFilter)

    }.bind(this))

  },



  onSearchConfirm() {

    const data = require("../../utils/data")

    if (!data.looksLikeTradeIdKeyword(this.data.keyword)) {

      return

    }

    data.tryNavigateTradeIdSearch(this.data.keyword, { pool: "connect", toastOnMiss: true })

  },



  clearSearch() {

    this.setData({ keyword: "" }, function() {

      this.applyFilter(this.data.activeFilter)

    }.bind(this))

  },



  switchFilter(event) {

    const data = require("../../utils/data")

    var filterKey = event.currentTarget.dataset.filter

    this.setData({

      activeFilter: filterKey,

      recordStatusFilter: "all",

      recordStatusFilters: data.getRecordStatusFilterOptions(filterKey),

      pageTitle: this.getPageTitle(filterKey)

    })

    wx.setNavigationBarTitle({ title: this.getPageTitle(filterKey) })

    this.applyFilter(filterKey)

  },



  switchRecordStatusFilter(event) {

    var statusKey = event.currentTarget.dataset.value

    if (!statusKey || statusKey === this.data.recordStatusFilter) {

      return

    }

    this.setData({ recordStatusFilter: statusKey }, function() {

      this.applyFilter(this.data.activeFilter)

    }.bind(this))

  },



  copyTradeId(event) {

    const copyText = require("../../utils/copyText")

    var text = event.currentTarget.dataset.text || ""

    copyText.copyTextToClipboard(text, {

      emptyTip: "暂无编号",

      successTip: "编号已复制"

    })

  },



  goRecord(event) {

    wx.navigateTo({

      url: "/pages/record/record?id=" + event.currentTarget.dataset.id

    })

  },



  goListingDetail(event) {

    var listingId = event.currentTarget.dataset.listingId

    if (!listingId) {

      return

    }

    wx.navigateTo({

      url: "/pages/detail/detail?id=" + listingId

    })

  },



  closeListing(event) {

    const data = require("../../utils/data")

    const listingId = event.currentTarget.dataset.listingId

    const recordType = event.currentTarget.dataset.type || ""

    if (!listingId) {

      return

    }

    var isResource = recordType === "resource"

    var poolLabel = isResource ? "资源池" : "需求池"

    var listingLabel = isResource ? "资源" : "需求"

    wx.showModal({

      title: isResource ? "关闭资源" : "关闭需求",

      content: "关闭后该" + listingLabel + "将从" + poolLabel + "下架，他人无法再查看或申请对接。你的提交记录仍会保留。",

      confirmText: "确认关闭",

      success: function(res) {

        if (!res.confirm) {

          return

        }

        this.setData({ closingListingId: listingId })

        data.closeUserListing(listingId).then(function(result) {

          if (!result.ok) {

            wx.showToast({ title: result.message, icon: "none" })

            return

          }

          wx.showToast({ title: "已关闭", icon: "success" })

          this.loadRecords()

        }.bind(this)).catch(function(error) {

          wx.showToast({ title: error.message || "关闭失败", icon: "none" })

        }).finally(function() {

          this.setData({ closingListingId: "" })

        }.bind(this))

      }.bind(this)

    })

  }

})

