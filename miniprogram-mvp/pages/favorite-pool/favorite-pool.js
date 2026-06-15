Page({
  _poolRefreshing: false,
  _lastPoolRefresh: 0,
  _poolType: "resources",
  _poolSide: "resource",

  data: Object.assign({
    poolType: "resources",
    isResourcePool: true,
    poolLabel: "资源",
    typeFilterLabel: "资源类型",
    searchPlaceholder: "搜索 GPU、整机、机柜、液冷",
    emptyText: "暂无收藏资源，浏览资源池时可点星标收藏。",
    registered: false,
    activeType: "全部",
    activeRegion: "全部",
    activeCert: "all",
    activeTime: "all",
    activeDeliveryKind: "all",
    activeFavorite: "favorite",
    activeBrowse: "all",
    sortBy: "match",
    keyword: "",
    filterDrawerOpen: false,
    filterActiveCount: 0,
    regionOptions: [],
    sortOptions: [],
    typeFilterChips: [],
    timeFilterOptions: [],
    deliveryKindFilterOptions: [],
    browseFilterOptions: [],
    allItems: [],
    items: []
  }, require("../../utils/pagedList").initialData()),

  onLoad(options) {
    var poolType = options.pool === "demands" ? "demands" : "resources"
    this._poolType = poolType
    this._poolSide = poolType === "demands" ? "demand" : "resource"
    var isResourcePool = poolType === "resources"
    wx.setNavigationBarTitle({
      title: isResourcePool ? "收藏的资源" : "收藏的需求"
    })
    this.setData({
      poolType: poolType,
      isResourcePool: isResourcePool,
      poolLabel: isResourcePool ? "资源" : "需求",
      typeFilterLabel: isResourcePool ? "资源类型" : "需求类型",
      searchPlaceholder: isResourcePool
        ? "搜索 GPU、整机，或编号 URES-"
        : "搜索整机、租赁，或编号 UDEM-",
      emptyText: isResourcePool
        ? "暂无收藏资源，浏览资源池时可点星标收藏。"
        : "暂无收藏需求，浏览需求池时可点星标收藏。"
    })
    this.initPage("全部")
  },

  onHide() {
    if (this.data.filterDrawerOpen) {
      this.setData({ filterDrawerOpen: false })
    }
  },

  onShow() {
    const data = require("../../utils/data")
    if (data.canShareListingContent()) {
      require("../../utils/share").enableShareMenus()
    } else if (wx.hideShareMenu) {
      wx.hideShareMenu()
    }
    this.initPage(this.data.activeType)
    this.refreshPoolFromCloud(false)
  },

  initPage(activeType) {
    const data = require("../../utils/data")
    var isResourcePool = this._poolType === "resources"

    try {
      this.setData({
        registered: data.isUserRegistered(),
        regionOptions: data.getRegionOptions(),
        sortOptions: data.getPoolSortOptions(),
        typeFilterChips: isResourcePool
          ? data.getResourceTypeFilterChips()
          : data.getDemandTypeFilterChips(),
        timeFilterOptions: data.getPoolTimeFilterOptions(),
        deliveryKindFilterOptions: data.getPoolDeliveryKindFilterOptions(),
        browseFilterOptions: isResourcePool
          ? data.getResourceBrowseFilterOptions()
          : data.getDemandBrowseFilterOptions(),
        allItems: isResourcePool ? data.getResources() : data.getDemands(),
        activeType: activeType || "全部",
        activeFavorite: "favorite"
      }, this.applyFilters)
    } catch (error) {
      wx.showToast({
        title: isResourcePool ? "资源加载失败" : "需求加载失败",
        icon: "none"
      })
    }
  },

  refreshPoolFromCloud(force) {
    const poolListPage = require("../../utils/poolListPage")
    poolListPage.refreshPoolFromCloud(this, {
      force: !!force,
      toastOnError: !!force,
      onSynced: function() {
        this.initPage(this.data.activeType)
      }.bind(this)
    })
  },

  onPullDownRefresh() {
    this.refreshPoolFromCloud(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  setType(event) {
    this.setData({ activeType: event.currentTarget.dataset.type }, this.applyFilters)
  },

  setRegion(event) {
    this.setData({ activeRegion: event.currentTarget.dataset.region }, this.applyFilters)
  },

  setSort(event) {
    this.setData({ sortBy: event.currentTarget.dataset.sort }, this.applyFilters)
  },

  setTimeFilter(event) {
    this.setData({ activeTime: event.currentTarget.dataset.value }, this.applyFilters)
  },

  setDeliveryKindFilter(event) {
    this.setData({ activeDeliveryKind: event.currentTarget.dataset.value }, this.applyFilters)
  },

  setBrowseFilter(event) {
    this.setData({ activeBrowse: event.currentTarget.dataset.value }, this.applyFilters)
  },

  toggleQuickLicense() {
    this.setData({
      activeCert: this.data.activeCert === "license" ? "all" : "license"
    }, this.applyFilters)
  },

  toggleQuickDay() {
    this.setData({
      activeTime: this.data.activeTime === "24h" ? "all" : "24h"
    }, this.applyFilters)
  },

  toggleQuickWeek() {
    this.setData({
      activeTime: this.data.activeTime === "7d" ? "all" : "7d"
    }, this.applyFilters)
  },

  openFilterDrawer() {
    this.setData({ filterDrawerOpen: true })
  },

  closeFilterDrawer() {
    this.setData({ filterDrawerOpen: false })
  },

  resetAdvancedFilters() {
    var patch = { activeBrowse: "all", activeRegion: "全部", activeDeliveryKind: "all" }
    if (this.data.activeTime === "30d") {
      patch.activeTime = "all"
    }
    this.setData(patch, this.applyFilters)
  },

  onSearch(event) {
    this.setData({ keyword: event.detail.value }, this.applyFilters)
  },

  onSearchConfirm() {
    const data = require("../../utils/data")
    if (!data.looksLikeTradeIdKeyword(this.data.keyword)) {
      return
    }
    data.tryNavigateTradeIdSearch(this.data.keyword, {
      pool: this.data.isResourcePool ? "resource" : "demand",
      toastOnMiss: true
    })
  },

  buildFilterOptions() {
    const data = require("../../utils/data")
    return {
      keyword: this.data.keyword,
      activeType: this.data.activeType,
      activeRegion: this.data.activeRegion,
      activeCert: this.data.activeCert,
      activeTime: this.data.activeTime,
      activeDeliveryKind: this.data.activeDeliveryKind,
      activeFavorite: "favorite",
      favoriteIds: data.getFavoriteIds(this._poolType)
    }
  },

  applyFilters() {
    this.rebuildFilteredPoolItems({ reset: true })
  },

  rebuildFilteredPoolItems(options) {
    const data = require("../../utils/data")
    const poolListPage = require("../../utils/poolListPage")
    options = options || {}
    const filtered = data.filterItems(this.data.allItems, this.buildFilterOptions())
    const sorted = data.sortItems(filtered, this.data.sortBy)
    var fullItems = this._poolType === "resources"
      ? data.prepareResourceListForView(sorted)
      : data.prepareDemandListForView(sorted)
    fullItems = data.filterPoolViewItems(fullItems, { activeBrowse: this.data.activeBrowse })
    var patch = poolListPage.buildPagedPoolPatch(this, fullItems, {
      reset: options.reset !== false,
      extendPage: !!options.extendPage,
      keepDisplayPage: !!options.keepDisplayPage
    })
    patch.filterActiveCount = data.countPoolDrawerFilters(this.data, { includeBrowse: true })
    this.setData(patch)
  },

  onReachBottom() {
    require("../../utils/poolListPage").onPoolReachBottom(this)
  },

  toggleFavorite(event) {
    const data = require("../../utils/data")
    const id = event.currentTarget.dataset.id
    const result = data.toggleFavoriteListing(id)
    if (result.needLogin) {
      data.promptFavoriteLogin(this._poolType)
      return
    }
    if (!result.ok) {
      return
    }
    wx.showToast({
      title: result.favorited ? "已收藏" : "已取消收藏",
      icon: "none"
    })
    this.applyFilters()
  },

  goDetail(event) {
    const data = require("../../utils/data")
    const id = event.currentTarget.dataset.id
    if (this._poolType === "resources") {
      data.markResourceViewed(id)
    } else {
      data.markDemandViewed(id)
    }
    wx.navigateTo({
      url: "/pages/detail/detail?id=" + id
    })
  },

  applyConnect(event) {
    const data = require("../../utils/data")
    const item = this.data.items.find(function(entry) {
      return entry.id === event.currentTarget.dataset.id
    })
    if (!item || !data.canApplyConnectToListing(item.id)) {
      return
    }
    const connectUrl = data.getConnectSubmitUrl(item.id, item.title)
    if (!data.ensureConnectAccess({ redirect: connectUrl })) {
      return
    }
    wx.navigateTo({ url: connectUrl })
  },

  viewConnectRecord(event) {
    var recordId = event.currentTarget.dataset.recordId
    if (!recordId) {
      return
    }
    wx.navigateTo({
      url: "/pages/record/record?id=" + recordId
    })
  },

  goMatchResource(event) {
    const data = require("../../utils/data")
    const item = this.data.items.find(function(entry) {
      return entry.id === event.currentTarget.dataset.id
    })
    if (!item || !data.canMatchToDemandListing(item.id)) {
      return
    }
    const connectUrl = data.getMatchSubmitUrl(item.id, item.title)
    if (!data.ensureMatchAccess({ redirect: connectUrl })) {
      return
    }
    wx.navigateTo({ url: connectUrl })
  }
})
