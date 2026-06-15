/**
 * 资源池 / 需求池列表页工厂 — 共用筛选、分页、云端同步
 */
var pagedList = require("./pagedList")
var poolListPage = require("./poolListPage")

function getData() {
  return require("./data")
}

function getShare() {
  return require("./share")
}

function createPoolPage(config) {
  config = config || {}
  var scrollTopKey = config.scrollTopKey || ""

  var pageDef = {
    _poolRefreshing: false,
    _lastPoolRefresh: 0,
    _poolSide: config.poolSide,

    data: Object.assign({
      registered: false,
      activeType: "全部",
      activeRegion: "全部",
      activeCert: "all",
      activeTime: "all",
      activeDeliveryKind: "all",
      activeFavorite: "all",
      activeBrowse: "all",
      sortBy: "match",
      keyword: "",
      filterDrawerOpen: false,
      filterActiveCount: 0,
      staffPoolPublishBlocked: false,
      regionOptions: [],
      sortOptions: [],
      typeFilterChips: [],
      certFilterOptions: [],
      timeFilterOptions: [],
      deliveryKindFilterOptions: [],
      favoriteFilterOptions: [],
      browseFilterOptions: [],
      allItems: [],
      items: []
    }, pagedList.initialData()),

    onLoad: function(options) {
      options = options || {}
      this.bootstrapPoolPage(options.type || "全部", {
        openFavorite: options.favorite === "1",
        openDrawer: options.favorite === "1"
      })
    },

    onHide: function() {
      if (this.data.filterDrawerOpen) {
        this.setData({ filterDrawerOpen: false })
      }
    },

    onShow: function() {
      var data = getData()
      if (data.canShareListingContent()) {
        getShare().enableShareMenus()
      } else if (wx.hideShareMenu) {
        wx.hideShareMenu()
      }
      this.bootstrapPoolPage(this.data.activeType)
      if (scrollTopKey) {
        this.restoreScrollPosition()
      }
      var forcePoolRefresh = false
      try {
        var app = getApp()
        if (app.globalData && app.globalData.poolNeedsForceRefresh) {
          forcePoolRefresh = true
          app.globalData.poolNeedsForceRefresh = false
        }
      } catch (error) {
        // 非页面上下文
      }
      this.refreshPoolFromCloud(forcePoolRefresh)
    },

    bootstrapPoolPage: function(activeType, intentOptions) {
      var data = getData()
      intentOptions = intentOptions || {}
      var self = this

      try {
        var patch = {
          registered: data.isUserRegistered(),
          staffPoolPublishBlocked: data.isUserPoolPublishBlocked(),
          regionOptions: data.getRegionOptions(),
          sortOptions: data.getPoolSortOptions(),
          typeFilterChips: config.getTypeFilterChips(data),
          certFilterOptions: data.getPoolCertFilterOptions(),
          timeFilterOptions: data.getPoolTimeFilterOptions(),
          deliveryKindFilterOptions: data.getPoolDeliveryKindFilterOptions(),
          favoriteFilterOptions: data.getPoolFavoriteFilterOptions(),
          browseFilterOptions: config.getBrowseFilterOptions(data),
          allItems: config.getAllItems(data),
          activeType: activeType || "全部"
        }
        if (intentOptions.openFavorite) {
          patch.activeFavorite = "favorite"
        }
        if (intentOptions.openDrawer) {
          patch.filterDrawerOpen = true
        }

        var app = getApp()
        var intent = app.globalData.filterIntent
        if (intent && intent.pool === config.intentPoolKey) {
          if (intent.type) {
            patch.activeType = intent.type
          }
          if (intent.favorite) {
            patch.activeFavorite = "favorite"
            if (intent.openDrawer !== false) {
              patch.filterDrawerOpen = true
            }
          }
          app.globalData.filterIntent = null
        }

        this.setData(patch, self.applyFilters)
      } catch (error) {
        wx.showToast({ title: config.loadErrorTitle || "列表加载失败", icon: "none" })
      }
    },

    refreshPoolFromCloud: function(force) {
      var self = this
      poolListPage.refreshPoolFromCloud(this, {
        force: !!force,
        toastOnError: !!force,
        onSynced: function() {
          self.bootstrapPoolPage(self.data.activeType)
          if (scrollTopKey) {
            self.restoreScrollPosition()
          }
        }
      })
    },

    onPullDownRefresh: function() {
      this.refreshPoolFromCloud(true).finally(function() {
        wx.stopPullDownRefresh()
      })
    },

    setType: function(event) {
      this.setData({ activeType: event.currentTarget.dataset.type }, this.applyFilters)
    },

    setRegion: function(event) {
      this.setData({ activeRegion: event.currentTarget.dataset.region }, this.applyFilters)
    },

    setSort: function(event) {
      this.setData({ sortBy: event.currentTarget.dataset.sort }, this.applyFilters)
    },

    setCertFilter: function(event) {
      this.setData({ activeCert: event.currentTarget.dataset.value }, this.applyFilters)
    },

    setTimeFilter: function(event) {
      this.setData({ activeTime: event.currentTarget.dataset.value }, this.applyFilters)
    },

    setDeliveryKindFilter: function(event) {
      this.setData({ activeDeliveryKind: event.currentTarget.dataset.value }, this.applyFilters)
    },

    setFavoriteFilter: function(event) {
      this.setData({ activeFavorite: event.currentTarget.dataset.value }, this.applyFilters)
    },

    setBrowseFilter: function(event) {
      this.setData({ activeBrowse: event.currentTarget.dataset.value }, this.applyFilters)
    },

    toggleQuickFavorite: function() {
      this.setData({
        activeFavorite: this.data.activeFavorite === "favorite" ? "all" : "favorite"
      }, this.applyFilters)
    },

    toggleQuickLicense: function() {
      this.setData({
        activeCert: this.data.activeCert === "license" ? "all" : "license"
      }, this.applyFilters)
    },

    toggleQuickDay: function() {
      this.setData({
        activeTime: this.data.activeTime === "24h" ? "all" : "24h"
      }, this.applyFilters)
    },

    toggleQuickWeek: function() {
      this.setData({
        activeTime: this.data.activeTime === "7d" ? "all" : "7d"
      }, this.applyFilters)
    },

    openFilterDrawer: function() {
      this.setData({ filterDrawerOpen: true })
    },

    closeFilterDrawer: function() {
      this.setData({ filterDrawerOpen: false })
    },

    resetAdvancedFilters: function() {
      var patch = { activeBrowse: "all", activeRegion: "全部", activeDeliveryKind: "all" }
      if (this.data.activeTime === "30d") {
        patch.activeTime = "all"
      }
      this.setData(patch, this.applyFilters)
    },

    onSearch: function(event) {
      var self = this
      this.setData({ keyword: event.detail.value })
      if (this._searchDebounceTimer) {
        clearTimeout(this._searchDebounceTimer)
      }
      this._searchDebounceTimer = setTimeout(function() {
        self.applyFilters()
      }, 400)
    },

    onSearchConfirm: function() {
      var data = getData()
      if (!data.looksLikeTradeIdKeyword(this.data.keyword)) {
        return
      }
      data.tryNavigateTradeIdSearch(this.data.keyword, {
        pool: config.tradeIdPool,
        toastOnMiss: true
      })
    },

    buildFilterOptions: function() {
      var data = getData()
      return {
        keyword: this.data.keyword,
        activeType: this.data.activeType,
        activeRegion: this.data.activeRegion,
        activeCert: this.data.activeCert,
        activeTime: this.data.activeTime,
        activeDeliveryKind: this.data.activeDeliveryKind,
        activeFavorite: this.data.activeFavorite,
        sortBy: this.data.sortBy,
        favoriteIds: data.getFavoriteIds(config.favoriteIdsKey)
      }
    },

    buildServerFilterOptions: function() {
      return {
        keyword: this.data.keyword,
        activeType: this.data.activeType,
        activeRegion: this.data.activeRegion,
        activeCert: this.data.activeCert,
        activeTime: this.data.activeTime,
        activeDeliveryKind: this.data.activeDeliveryKind,
        sortBy: this.data.sortBy
      }
    },

    fetchPoolFromCloudWithFilters: function() {
      var self = this
      var data = getData()
      var pool = poolListPage.getCloudPoolName(this)
      var filters = this.buildServerFilterOptions()
      if (this._poolFilterLoading) {
        return
      }
      this._poolFilterLoading = true
      data.refreshPublicListings(pool, 1, { filters: filters }).then(function() {
        self.setData({
          allItems: poolListPage.getAllPoolItems(data, self)
        })
        self.rebuildFilteredPoolItems({ reset: true, serverFiltered: true })
      }).catch(function(error) {
        console.warn("公开展示池筛选拉取失败", error)
        wx.showToast({ title: "筛选拉取失败", icon: "none" })
        self.rebuildFilteredPoolItems({ reset: true })
      }).finally(function() {
        self._poolFilterLoading = false
      })
    },

    applyFilters: function() {
      var data = getData()
      var poolFilters = require("./poolFilters")
      var pool = poolListPage.getCloudPoolName(this)
      var serverOpts = this.buildServerFilterOptions()
      var meta = data.getPublicListingsMeta(pool)
      var filterKey = poolFilters.buildPoolFilterKey(serverOpts)
      var needServerFetch = data.isCloudEnabled() && (
        poolFilters.hasServerPoolFilters(serverOpts)
        || (!!meta.serverFiltered && meta.filterKey !== filterKey)
      )
      if (needServerFetch) {
        this.fetchPoolFromCloudWithFilters()
        return
      }
      this.rebuildFilteredPoolItems({ reset: true })
    },

    rebuildFilteredPoolItems: function(options) {
      var data = getData()
      options = options || {}
      var pool = poolListPage.getCloudPoolName(this)
      var useServerFiltered = !!options.serverFiltered
        || (data.isCloudEnabled() && data.isPublicListingsServerFiltered(pool))
      var fullItems
      if (useServerFiltered) {
        fullItems = config.prepareListForView(data, config.getAllItems(data))
        if (this.data.activeFavorite === "favorite") {
          fullItems = data.filterItems(fullItems, {
            activeFavorite: "favorite",
            favoriteIds: data.getFavoriteIds(config.favoriteIdsKey)
          })
        }
        fullItems = data.filterPoolViewItems(fullItems, { activeBrowse: this.data.activeBrowse })
      } else {
        var filtered = data.filterItems(this.data.allItems, this.buildFilterOptions())
        if (!filtered.length && data.looksLikeTradeIdKeyword(this.data.keyword)) {
          var lookup = data.lookupTradeRecordById(this.data.keyword)
          if (lookup && lookup.kind === "listing" && lookup.pool === config.tradeIdPool) {
            var rawItem = data.getItem(lookup.id)
            if (rawItem) {
              filtered = [rawItem]
            }
          }
        }
        var sorted = data.sortItems(filtered, this.data.sortBy)
        fullItems = config.prepareListForView(data, sorted)
        fullItems = data.filterPoolViewItems(fullItems, { activeBrowse: this.data.activeBrowse })
      }
      var patch = poolListPage.buildPagedPoolPatch(this, fullItems, {
        reset: options.reset !== false,
        extendPage: !!options.extendPage,
        keepDisplayPage: !!options.keepDisplayPage
      })
      patch.filterActiveCount = data.countPoolDrawerFilters(this.data, { includeBrowse: true })
      this.setData(patch)
    },

    onReachBottom: function() {
      poolListPage.onPoolReachBottom(this)
    },

    toggleFavorite: function(event) {
      var data = getData()
      var id = event.currentTarget.dataset.id
      var result = data.toggleFavoriteListing(id)
      if (result.needLogin) {
        data.promptFavoriteLogin(config.favoriteIdsKey)
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

    goDetail: function(event) {
      var data = getData()
      var id = event.currentTarget.dataset.id
      config.markViewed(data, id)
      wx.navigateTo({
        url: "/pages/detail/detail?id=" + id
      })
    },

    viewConnectRecord: function(event) {
      var recordId = event.currentTarget.dataset.recordId
      if (!recordId) {
        return
      }
      wx.navigateTo({
        url: "/pages/record/record?id=" + recordId
      })
    },

    onShareAppMessage: function() {
      return getShare().buildPoolShareAppMessage(config.sharePool)
    },

    onShareTimeline: function() {
      return getShare().buildPoolShareTimeline(config.sharePool)
    }
  }

  if (scrollTopKey) {
    pageDef.onPageScroll = function(event) {
      getApp().globalData[scrollTopKey] = event.scrollTop || 0
    }
    pageDef.restoreScrollPosition = function() {
      var top = getApp().globalData[scrollTopKey] || 0
      if (top > 0) {
        setTimeout(function() {
          wx.pageScrollTo({ scrollTop: top, duration: 0 })
        }, 80)
      }
    }
  }

  if (config.methods) {
    Object.assign(pageDef, config.methods)
  }

  return Page(pageDef)
}

module.exports = {
  createPoolPage: createPoolPage
}
