Page({
  _mineRefreshing: false,
  _lastMineCloudRefresh: 0,
  _syncUiActive: false,
  _syncUiTimer: null,

  data: {
    accountName: "未登录",
    accountPhone: "",
    avatarText: "?",
    enterpriseSummary: "登录后填写企业资料",
    businessSummary: "需求、资源、对接等全部记录",
    certSummary: {
      status: "guest",
      statusText: "访客用户",
      canCertify: false
    },
    certBadgeClass: "none",
    mineStats: {
      resourceCount: 0,
      demandCount: 0,
      recordCount: 0
    },
    categoryStats: {
      connect: { count: 0, pending: 0, actionPending: 0, summary: "申请对接与资源匹配" },
      resource: { count: 0, pending: 0, active: 0, summary: "暂无资源发布" },
      demand: { count: 0, pending: 0, active: 0, summary: "暂无需求提交" },
      certify: { count: 0, pending: 0, summary: "暂无认证申请" }
    },
    nextStepGuide: null,
    nextStepTitle: "",
    levelBadge: null,
    permissions: [],
    pendingConnectNotice: null,
    pendingRejectionNotice: null,
    accessLevel: "guest",
    showHeaderArrow: true,
    cloudSummary: null,
    adminSession: null,
    adminLoggedIn: false,
    staffUser: false,
    staffRoleLabel: "",
    adminModeActive: false,
    accountMode: "user",
    opsPendingCount: 0,
    opsStats: {
      pendingListings: 0,
      pendingCertify: 0,
      pendingBusiness: 0,
      pendingProxyConnect: 0,
      pendingReports: 0,
      pendingTotal: 0
    },
    opsProxySection: null,
    opsMonitorSection: null,
    opsGovernanceSection: null,
    opsDemoDataSection: null,
    opsReviewTab: "all",
    opsReviewItems: [],
    opsReviewEmptyTitle: "暂无待审内容",
    opsReviewEmptyText: "",
    opsReviewApproveLabel: "通过",
    opsReviewRejectLabel: "驳回",
    opsConnectItems: [],
    opsConnectCount: 0,
    userLoggedIn: false,
    favoriteCount: 0,
    favoriteResourceCount: 0,
    favoriteDemandCount: 0,
    reportStats: { count: 0, pending: 0, summary: "暂无举报记录" },
    syncLoading: false,
    opsReviewBusyId: "",
    opsReviewBusyAction: ""
  },

  onShow() {
    const data = require("../../utils/data")
    var app = getApp()
    if (app.globalData && app.globalData.opsReviewTab) {
      this.setData({ opsReviewTab: app.globalData.opsReviewTab })
      app.globalData.opsReviewTab = null
    }
    if (app.globalData && app.globalData.scrollToOpsConnect) {
      app.globalData.scrollToOpsConnect = false
      this._scrollToOpsConnect = true
    }
    this.loadMineData()

    if (!data.isCloudEnabled() || !data.isUserRegistered()) {
      return
    }

    var now = Date.now()
    var minInterval = 15000
    if (this._mineRefreshing || now - this._lastMineCloudRefresh < minInterval) {
      return
    }

    this.refreshMineFromCloud(false)
  },

  refreshMineFromCloud(force, options) {
    const data = require("../../utils/data")
    options = options || {}
    this.loadMineData()
    if (!data.isCloudEnabled() || !data.isUserRegistered()) {
      return Promise.resolve({ ok: true, skipped: true })
    }
    var now = Date.now()
    var minInterval = 15000
    if (!force && (this._mineRefreshing || now - this._lastMineCloudRefresh < minInterval)) {
      return Promise.resolve({ ok: true, skipped: true })
    }
    this._mineRefreshing = true
    return data.refreshFromCloudForMine({ silent: !options.manual }).then(function(result) {
      this._lastMineCloudRefresh = Date.now()
      this.loadMineData()
      if (data.isStaffUser()) {
        data.refreshStaffGlobalConnectsFromCloud({
          background: true,
          skipRepair: true
        }).then(function() {
          this.loadMineData()
        }.bind(this)).catch(function() {})
      }
      return { ok: true, result: result }
    }.bind(this)).catch(function(error) {
      if (force || options.manual) {
        return Promise.reject(error || new Error("拉取失败"))
      }
      return { ok: false, silent: true }
    }.bind(this)).finally(function() {
      this._mineRefreshing = false
    }.bind(this))
  },

  clearSyncUiTimer() {
    if (this._syncUiTimer) {
      clearTimeout(this._syncUiTimer)
      this._syncUiTimer = null
    }
  },

  onPullDownRefresh() {
    this.refreshMineFromCloud(true, { manual: true }).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  retryCloudSync() {
    if (this._syncUiActive) {
      return
    }
    this._syncUiActive = true
    this.clearSyncUiTimer()
    this.setData({ syncLoading: true })
    var self = this
    self._syncUiTimer = setTimeout(function() {
      self._syncUiActive = false
      self._syncUiTimer = null
      self.setData({ syncLoading: false })
      wx.showToast({ title: "拉取超时，请检查网络后重试", icon: "none" })
    }, 28000)
    this.refreshMineFromCloud(true, { manual: true }).then(function() {
      wx.showToast({ title: "已更新", icon: "success" })
    }).catch(function(error) {
      wx.showToast({
        title: (error && error.message) || "拉取失败",
        icon: "none"
      })
    }).finally(function() {
      self.clearSyncUiTimer()
      self._syncUiActive = false
      self.setData({ syncLoading: false })
    })
  },

  updatePageTitle(isStaffMode) {
    wx.setNavigationBarTitle({
      title: isStaffMode ? "运营工作台" : "我的"
    })
  },

  loadMineData() {
    try {
      const data = require("../../utils/data")
      this.applyMineData(data)
      data.repairProfileCertStatus().then(function() {
        this.applyMineData(data)
      }.bind(this)).catch(function() {})
    } catch (error) {
      wx.showToast({ title: "加载失败", icon: "none" })
    }
  },

  applyMineData(data) {
    try {
      const profile = data.getUserProfile()
      const certSummary = data.getUserCertSummary()
      const userLoggedIn = data.isUserRegistered()
      const accessLevel = data.getUserAccessLevel()
      const accountMode = data.getAccountMode()
      const isStaffMode = data.isStaffUser()

      var accountName = "未登录"
      var accountPhone = ""
      if (userLoggedIn && profile) {
        accountName = profile.contact || data.maskPhone(profile.phone) || "已登录用户"
        accountPhone = profile.phone ? data.maskPhone(profile.phone) : ""
      }

      var enterpriseSummary = "登录后填写企业资料"
      if (userLoggedIn) {
        if (certSummary.company) {
          enterpriseSummary = certSummary.company
          if (certSummary.role || certSummary.region) {
            enterpriseSummary += " · " + [certSummary.role, certSummary.region].filter(Boolean).join(" · ")
          }
        } else {
          enterpriseSummary = "点击完善企业资料与认证"
        }
      }

      var nextStepGuide = userLoggedIn && !isStaffMode && accessLevel !== "verified"
        && !data.getPendingConnectNotice() && !data.getPendingRejectionNotice()
        ? data.getNextStepGuide()
        : null
      var nextStepTitle = ""
      if (nextStepGuide && nextStepGuide.title) {
        nextStepTitle = nextStepGuide.title.indexOf("下一步") === 0
          ? nextStepGuide.title
          : "下一步：" + nextStepGuide.title
      }

      var categoryStats = userLoggedIn && !isStaffMode ? data.getMineCategoryStats() : {
        connect: { count: 0, pending: 0, actionPending: 0, summary: "申请对接与资源匹配" },
        resource: { count: 0, pending: 0, active: 0, summary: "暂无资源发布" },
        demand: { count: 0, pending: 0, active: 0, summary: "暂无需求提交" },
        certify: { count: 0, pending: 0, summary: "暂无认证申请" }
      }
      if (userLoggedIn && !isStaffMode) {
        ;["connect", "resource", "demand", "certify"].forEach(function(key) {
          categoryStats[key].summary = data.getMineCategorySummary(key)
        })
      }

      var opsWorkbench = isStaffMode
        ? require("../../utils/ops-workbench").loadOpsWorkbenchData(data, this.data.opsReviewTab || "all")
        : null
      var reviewQueue = opsWorkbench ? opsWorkbench.reviewQueue : null
      var connectActions = opsWorkbench ? opsWorkbench.connectActions : null

      this.setData({
        accountName: accountName,
        accountPhone: accountPhone,
        avatarText: this.getAvatarText(accountName, userLoggedIn),
        enterpriseSummary: enterpriseSummary,
        businessSummary: userLoggedIn && !isStaffMode ? data.getMineBusinessSummary() : "需求、资源、对接等全部记录",
        categoryStats: categoryStats,
        certSummary: certSummary,
        certBadgeClass: data.getMineCertBadgeClass(certSummary.status),
        mineStats: userLoggedIn && !isStaffMode ? data.getUserMineStats() : {
          resourceCount: 0,
          demandCount: 0,
          recordCount: 0
        },
        nextStepGuide: nextStepGuide,
        nextStepTitle: nextStepTitle,
        levelBadge: data.getUserLevelBadge(),
        permissions: userLoggedIn && !isStaffMode ? data.getUserPermissions() : [],
        pendingConnectNotice: userLoggedIn ? data.getPendingConnectNotice() : null,
        pendingRejectionNotice: userLoggedIn && !isStaffMode ? data.getPendingRejectionNotice() : null,
        accessLevel: accessLevel,
        showHeaderArrow: !userLoggedIn || accessLevel !== "verified",
        cloudSummary: data.getCloudStatus(),
        adminSession: data.getAdminSession(),
        adminLoggedIn: data.isAdminLoggedIn(),
        staffUser: data.isStaffUser(),
        staffRoleLabel: data.getStaffRoleLabel(),
        adminModeActive: data.isAdminModeActive(),
        accountMode: accountMode,
        opsPendingCount: isStaffMode ? data.getAdminHubStats().pendingTotal : 0,
        opsStats: opsWorkbench ? opsWorkbench.stats : this.data.opsStats,
        opsReviewTab: reviewQueue ? reviewQueue.tab : this.data.opsReviewTab,
        opsReviewItems: reviewQueue ? reviewQueue.items : [],
        opsReviewEmptyTitle: reviewQueue ? reviewQueue.emptyTitle : "暂无待审内容",
        opsReviewEmptyText: reviewQueue ? reviewQueue.emptyText : "",
        opsReviewApproveLabel: reviewQueue ? reviewQueue.approveLabel : "通过",
        opsReviewRejectLabel: reviewQueue ? reviewQueue.rejectLabel : "驳回",
        opsConnectItems: connectActions ? connectActions.items : [],
        opsConnectCount: connectActions ? connectActions.count : 0,
        opsProxySection: opsWorkbench ? opsWorkbench.proxySection : null,
        opsMonitorSection: opsWorkbench ? opsWorkbench.monitorSection : null,
        opsGovernanceSection: opsWorkbench ? opsWorkbench.governanceSection : null,
        opsDemoDataSection: opsWorkbench ? opsWorkbench.demoDataSection : null,
        userLoggedIn: userLoggedIn,
        favoriteCount: data.getFavoriteCount(),
        favoriteResourceCount: data.getFavoriteIds("resources").length,
        favoriteDemandCount: data.getFavoriteIds("demands").length,
        reportStats: userLoggedIn && !isStaffMode ? data.getUserListingReportStats() : { count: 0, pending: 0, summary: "暂无举报记录" }
      })
      this.updatePageTitle(isStaffMode)
      data.updateMineTabBadge()
      if (this._scrollToOpsConnect) {
        this._scrollToOpsConnect = false
        this.scrollToOpsConnectSection()
      }
    } catch (error) {
      wx.showToast({ title: "加载失败", icon: "none" })
    }
  },

  getAvatarText(name, userLoggedIn) {
    if (!userLoggedIn || !name || name === "未登录") {
      return "?"
    }
    if (/^\d/.test(name)) {
      return "用"
    }
    return name.slice(0, 1)
  },

  switchToUserMode() {},

  switchToStaffMode() {},

  goNextStep() {
    const data = require("../../utils/data")
    const guide = this.data.nextStepGuide
    if (!guide || !guide.action) {
      return
    }
    if (guide.action === "login") {
      wx.navigateTo({ url: data.buildLoginUrl("/pages/mine/mine") })
      return
    }
    if (guide.action === "register") {
      wx.navigateTo({ url: data.buildLoginUrl("/pages/mine/mine") })
      return
    }
    if (guide.action === "onboard") {
      wx.navigateTo({ url: "/pages/onboard/onboard" })
      return
    }
    if (guide.action === "records") {
      var recordsUrl = "/pages/records/records"
      if (guide.filter) {
        recordsUrl += "?filter=" + guide.filter
      }
      wx.navigateTo({ url: recordsUrl })
      return
    }
    if (guide.action === "certifyRecord") {
      if (guide.certRecordId) {
        wx.navigateTo({
          url: data.getCertifyRecordUrl(guide.certRecordId)
        })
        return
      }
      this.goCertRecords()
      return
    }
    if (guide.action === "certify") {
      this.goEnterprise()
      return
    }
    if (guide.action === "submitDemand") {
      this.goSubmit({ currentTarget: { dataset: { type: "demand" } } })
      return
    }
    if (guide.action === "submitResource") {
      this.goSubmit({ currentTarget: { dataset: { type: "resource" } } })
      return
    }
    if (guide.action === "browse") {
      wx.switchTab({ url: "/pages/resources/resources" })
      return
    }
    if (guide.action === "rejectionNotice") {
      wx.navigateTo({ url: data.getRejectionNoticeNavigateUrl() })
    }
  },

  goLogin() {
    const data = require("../../utils/data")
    if (data.isUserRegistered()) {
      return
    }
    wx.showLoading({ title: "加载中", mask: true })
    data.navigateAuthGate({
      tab: "login",
      redirect: "/pages/mine/mine"
    }).then(function(result) {
      wx.hideLoading()
      if (result.action === "stay") {
        this.loadMineData()
        return
      }
      if (result.message) {
        wx.showToast({ title: result.message, icon: "none" })
      }
      var url = data.buildLoginUrl("/pages/mine/mine")
      if (result.gate && result.gate.boundPhone) {
        url += (url.indexOf("?") > -1 ? "&" : "?") + "prefillPhone=" + encodeURIComponent(result.gate.boundPhone)
      }
      wx.navigateTo({ url: url })
    }.bind(this)).catch(function() {
      wx.hideLoading()
      wx.navigateTo({ url: data.buildLoginUrl("/pages/mine/mine") })
    })
  },

  goRegister() {
    const data = require("../../utils/data")
    if (data.isUserRegistered()) {
      return
    }
    wx.showLoading({ title: "加载中", mask: true })
    data.navigateAuthGate({
      tab: "register",
      redirect: "/pages/mine/mine"
    }).then(function(result) {
      wx.hideLoading()
      if (result.action === "stay") {
        this.loadMineData()
        return
      }
      if (result.action === "login") {
        if (result.message) {
          wx.showToast({ title: result.message, icon: "none" })
        }
        var loginUrl = data.buildLoginUrl("/pages/mine/mine")
        if (result.gate && result.gate.boundPhone) {
          loginUrl += (loginUrl.indexOf("?") > -1 ? "&" : "?") + "prefillPhone=" + encodeURIComponent(result.gate.boundPhone)
        }
        wx.navigateTo({ url: loginUrl })
        return
      }
      wx.navigateTo({ url: data.buildRegisterUrl("/pages/mine/mine") })
    }.bind(this)).catch(function() {
      wx.hideLoading()
      wx.navigateTo({ url: data.buildRegisterUrl("/pages/mine/mine") })
    })
  },

  goDemands() {
    wx.switchTab({
      url: "/pages/demands/demands"
    })
  },

  goEnterprise() {
    const data = require("../../utils/data")
    if (!data.isUserRegistered()) {
      data.promptRegistration({
        redirect: "/pages/certify/certify"
      })
      return
    }
    wx.navigateTo({
      url: data.getCertifyPageUrl()
    })
  },

  goChangePassword() {
    const data = require("../../utils/data")
    if (!data.isUserRegistered()) {
      data.promptRegistration({
        redirect: "/pages/change-password/change-password"
      })
      return
    }
    wx.navigateTo({ url: "/pages/change-password/change-password" })
  },

  onLogout() {
    const data = require("../../utils/data")
    if (!data.isUserRegistered()) {
      return
    }
    wx.showModal({
      title: "退出登录",
      content: "退出后将清空本机账号缓存，再次使用需重新登录。",
      confirmText: "退出",
      confirmColor: "#e54d42",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        wx.showLoading({ title: "退出中...", mask: true })
        data.logoutUser().then(function() {
          wx.hideLoading()
          wx.showToast({ title: "已退出", icon: "success" })
          this.loadMineData()
        }.bind(this)).catch(function() {
          wx.hideLoading()
          this.loadMineData()
        }.bind(this))
      }.bind(this)
    })
  },

  goCertRecords() {
    const data = require("../../utils/data")
    var url = "/pages/cert-records/cert-records"
    if (!data.isUserRegistered()) {
      data.promptRegistration({ redirect: url })
      return
    }
    wx.navigateTo({ url: url })
  },

  goPendingConnect() {
    const data = require("../../utils/data")
    var notice = this.data.pendingConnectNotice
    if (notice && notice.mode === "staff") {
      if (notice.items && notice.items.length === 1 && notice.items[0].id) {
        var item = notice.items[0]
        if (item.actionType === "confirm" || item.actionType === "exchange") {
          wx.navigateTo({ url: "/pages/record/record?id=" + item.id })
          return
        }
      }
      if ((notice.connectCount || 0) > 0 && (notice.reviewCount || 0) === 0) {
        this.scrollToOpsConnectSection()
        return
      }
      if ((notice.reviewCount || 0) > 0) {
        this.setData({ opsReviewTab: "all" }, function() {
          this.loadMineData()
        }.bind(this))
        return
      }
      wx.navigateTo({ url: "/pages/ops-proxy/ops-proxy" })
      return
    }
    wx.navigateTo({
      url: "/pages/records/records?filter=connect"
    })
  },

  goPendingRejection() {
    const data = require("../../utils/data")
    wx.navigateTo({
      url: data.getRejectionNoticeNavigateUrl(this.data.pendingRejectionNotice)
    })
  },

  scrollToOpsConnectSection() {
    wx.nextTick(function() {
      wx.pageScrollTo({
        selector: "#opsConnectSection",
        duration: 300
      })
    })
  },

  openOpsConnectAction(event) {
    var id = event.currentTarget.dataset.id
    if (!id) {
      return
    }
    wx.navigateTo({ url: "/pages/record/record?id=" + id })
  },

  goRecords(event) {
    const data = require("../../utils/data")
    var filter = event && event.currentTarget ? event.currentTarget.dataset.filter : ""
    var url = "/pages/records/records"
    if (filter) {
      url += "?filter=" + filter
    }
    if (!data.isUserRegistered()) {
      data.promptRegistration({ redirect: url })
      return
    }
    wx.navigateTo({ url: url })
  },

  goReportRecords() {
    const data = require("../../utils/data")
    var url = "/pages/report-records/report-records"
    if (!data.isUserRegistered()) {
      data.promptRegistration({ redirect: url })
      return
    }
    wx.navigateTo({ url: url })
  },

  goFavoriteResources() {
    wx.navigateTo({ url: "/pages/favorite-pool/favorite-pool?pool=resources" })
  },

  goFavoriteDemands() {
    wx.navigateTo({ url: "/pages/favorite-pool/favorite-pool?pool=demands" })
  },

  goSubmit(event) {
    const data = require("../../utils/data")
    const type = event.currentTarget.dataset.type
    var url = "/pages/submit/submit?type=" + type
    if (data.requiresRegistration(type) && !data.isUserRegistered()) {
      data.promptRegistration({
        redirect: url
      })
      return
    }
    if (!data.ensureSubmitListingAccess(type, { redirect: url })) {
      return
    }
    wx.navigateTo({
      url: url
    })
  },

  goProcess() {
    wx.navigateTo({
      url: "/pages/process/process"
    })
  },

  goLegal(event) {
    const data = require("../../utils/data")
    var type = (event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.type) || "service"
    wx.navigateTo({ url: data.buildLegalPageUrl(type) })
  },

  goPlatformOps() {
    wx.switchTab({ url: "/pages/mine/mine" })
  },

  switchOpsReviewTab(event) {
    var tab = event.currentTarget.dataset.tab
    if (!tab || tab === this.data.opsReviewTab) {
      return
    }
    this.setData({ opsReviewTab: tab }, function() {
      this.loadMineData()
    }.bind(this))
  },

  openOpsReview(event) {
    var id = event.currentTarget.dataset.id
    var item = (this.data.opsReviewItems || []).find(function(entry) {
      return entry.id === id
    })
    if (!item) {
      return
    }
    var reviewType = item.reviewType
    var targetId = reviewType === "listing" ? item.id : item.submissionId
    wx.navigateTo({
      url: "/pages/admin-review/admin-review?reviewType=" + reviewType + "&id=" + targetId
    })
  },

  copyOpsReviewText(event) {
    event.stopPropagation && event.stopPropagation()
    const copyText = require("../../utils/copyText")
    var text = event.currentTarget.dataset.text || ""
    copyText.copyTextToClipboard(text, {
      emptyTip: "无内容可复制",
      successTip: "已复制"
    })
  },

  approveOpsReview(event) {
    event.stopPropagation && event.stopPropagation()
    var id = event.currentTarget.dataset.id
    var item = (this.data.opsReviewItems || []).find(function(entry) {
      return entry.id === id
    })
    if (!item) {
      return
    }
    const data = require("../../utils/data")
    var isProxyConnect = item.submission && data.isProxyConnectReviewSubmission(item.submission)
    var isListingReport = item.submission && data.isListingReportSubmission(item.submission)
    this.setData({ opsReviewBusyId: id, opsReviewBusyAction: "approve" })
    var actionPromise
    if (item.reviewType === "listing") {
      actionPromise = data.approveListingReview(item.id)
    } else if (isListingReport) {
      actionPromise = data.approveListingReportReview(item.submissionId)
    } else {
      actionPromise = data.approveSubmissionReview(item.submissionId)
    }
    Promise.resolve(actionPromise).then(function() {
      wx.showToast({
        title: isListingReport ? "已下架商机" : (isProxyConnect ? "已批准对接" : "已通过"),
        icon: "success"
      })
      this.loadMineData()
    }.bind(this)).catch(function(error) {
      wx.showToast({ title: error.message || "操作失败", icon: "none" })
    }).finally(function() {
      this.setData({ opsReviewBusyId: "", opsReviewBusyAction: "" })
    }.bind(this))
  },

  rejectOpsReview(event) {
    event.stopPropagation && event.stopPropagation()
    var id = event.currentTarget.dataset.id
    var item = (this.data.opsReviewItems || []).find(function(entry) {
      return entry.id === id
    })
    if (!item) {
      return
    }
    const data = require("../../utils/data")
    var isProxyConnect = item.submission && data.isProxyConnectReviewSubmission(item.submission)
    var isListingReport = item.submission && data.isListingReportSubmission(item.submission)
    wx.showModal({
      title: isListingReport ? "驳回举报" : (isProxyConnect ? "驳回对接" : "驳回审核"),
      editable: true,
      placeholderText: isListingReport ? "请填写核查说明（可选）" : "请填写驳回说明，将通知申请人",
      confirmText: isListingReport ? "驳回举报" : "确认驳回",
      confirmColor: "#c0392b",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        var rejectReason = (res.content || "").trim()
        if (!rejectReason && !isListingReport) {
          wx.showToast({ title: "请填写驳回说明", icon: "none" })
          return
        }
        this.setData({ opsReviewBusyId: id, opsReviewBusyAction: "reject" })
        var actionPromise
        if (item.reviewType === "listing") {
          actionPromise = data.rejectListingReview(item.id, rejectReason)
        } else if (isListingReport) {
          actionPromise = data.rejectListingReportReview(item.submissionId, rejectReason || "经核查未发现违规，举报驳回。")
        } else {
          actionPromise = data.rejectSubmissionReview(item.submissionId, rejectReason)
        }
        Promise.resolve(actionPromise).then(function() {
          wx.showToast({ title: "已驳回", icon: "success" })
          this.loadMineData()
        }.bind(this)).catch(function(error) {
          wx.showToast({ title: error.message || "操作失败", icon: "none" })
        }).finally(function() {
          this.setData({ opsReviewBusyId: "", opsReviewBusyAction: "" })
        }.bind(this))
      }.bind(this)
    })
  },

  openOpsFeature(event) {
    var action = event.currentTarget.dataset.action
    if (action === "global-connects") {
      wx.navigateTo({ url: "/pages/ops-connects/ops-connects" })
      return
    }
    if (action === "listing-reports") {
      wx.navigateTo({ url: "/pages/ops-reports/ops-reports" })
      return
    }
    if (action === "proxy-hub") {
      wx.navigateTo({ url: "/pages/ops-proxy/ops-proxy" })
      return
    }
    if (action === "proxy-resource") {
      wx.navigateTo({ url: "/pages/submit/submit?type=resource&mode=proxy" })
      return
    }
    if (action === "proxy-demand") {
      wx.navigateTo({ url: "/pages/submit/submit?type=demand&mode=proxy" })
      return
    }
    if (action === "admin-governance") {
      const data = require("../../utils/data")
      if (!data.isPlatformAdminUser()) {
        wx.showToast({ title: "仅平台管理员可用", icon: "none" })
        return
      }
      wx.navigateTo({ url: "/pages/admin-governance/admin-governance" })
      return
    }
    if (action === "admin-listings") {
      const data = require("../../utils/data")
      if (!data.isPlatformAdminUser()) {
        wx.showToast({ title: "仅平台管理员可用", icon: "none" })
        return
      }
      wx.navigateTo({ url: "/pages/admin-listings/admin-listings" })
      return
    }
    if (action === "admin-users") {
      const data = require("../../utils/data")
      if (!data.isPlatformAdminUser()) {
        wx.showToast({ title: "仅平台管理员可用", icon: "none" })
        return
      }
      wx.navigateTo({ url: "/pages/admin-users/admin-users" })
      return
    }
    if (action === "seed-demo") {
      this.runSeedDemoData()
      return
    }
    if (action === "clear-demo") {
      this.runClearDemoData()
      return
    }
  },

  runSeedDemoData() {
    const data = require("../../utils/data")
    if (!data.isCloudEnabled()) {
      wx.showToast({ title: "请先开启云端模式", icon: "none" })
      return
    }
    if (!data.isStaffUser()) {
      wx.showToast({ title: "无运营权限", icon: "none" })
      return
    }
    wx.showModal({
      title: "导入演示数据",
      content: "将创建 4 个测试用户（18800000000～18800000003），每人 1 条资源 + 1 条需求，密码 Demo1234。已存在的记录会跳过。",
      confirmText: "开始导入",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        wx.showLoading({ title: "导入中", mask: true })
        data.seedDemoDataAsync({
          onProgress: function(progress) {
            var next = progress.nextOffset || 0
            var total = progress.totalCount || 4
            wx.showLoading({ title: "导入中 " + next + "/" + total, mask: true })
          }
        }).then(function(result) {
          wx.hideLoading()
          if (!result || !result.ok) {
            wx.showToast({ title: (result && result.message) || "导入失败", icon: "none" })
            return
          }
          var stats = result.data || {}
          wx.showModal({
            title: "导入完成",
            content: [
              "用户新建 " + (stats.usersCreated || 0) + "，跳过 " + (stats.usersSkipped || 0),
              "资源新建 " + (stats.resourcesCreated || 0),
              "需求新建 " + (stats.demandsCreated || 0),
              "可用 18800000000 / Demo1234 登录验证"
            ].join("\n"),
            showCancel: false,
            success: function() {
              this.loadMineData()
            }.bind(this)
          })
        }.bind(this)).catch(function(error) {
          wx.hideLoading()
          wx.showToast({ title: (error && error.message) || "导入失败", icon: "none" })
        })
      }.bind(this)
    })
  },

  runClearDemoData() {
    const data = require("../../utils/data")
    if (!data.isCloudEnabled()) {
      wx.showToast({ title: "请先开启云端模式", icon: "none" })
      return
    }
    if (!data.isStaffUser()) {
      wx.showToast({ title: "无运营权限", icon: "none" })
      return
    }
    wx.showModal({
      title: "清空演示数据",
      content: "将删除 18800000000～18800000099 测试用户及其资源、需求、对接记录。此操作不可撤销，确认继续？",
      confirmText: "确认清空",
      confirmColor: "#c2410c",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        wx.showLoading({ title: "清空中", mask: true })
        data.clearDemoDataAsync({
          onProgress: function(progress) {
            var next = progress.nextOffset || 0
            var total = progress.totalCount || 100
            wx.showLoading({ title: "清空中 " + next + "/" + total, mask: true })
          }
        }).then(function(result) {
          wx.hideLoading()
          if (!result || !result.ok) {
            wx.showToast({ title: (result && result.message) || "清空失败", icon: "none" })
            return
          }
          var stats = result.data || {}
          wx.showModal({
            title: "清空完成",
            content: [
              "删除用户 " + (stats.usersRemoved || 0),
              "删除公示 " + (stats.listingsRemoved || 0),
              "删除记录 " + (stats.submissionsRemoved || 0)
            ].join("\n"),
            showCancel: false,
            success: function() {
              this.loadMineData()
            }.bind(this)
          })
        }.bind(this)).catch(function(error) {
          wx.hideLoading()
          wx.showToast({ title: (error && error.message) || "清空失败", icon: "none" })
        })
      }.bind(this)
    })
  },

  goAdminLogin() {
    this.goPlatformOps()
  },

  onGuestAvatarTap() {
  },

  goAdminWorkbench() {
    this.goPlatformOps()
  },

  goOpsProxy() {
    const data = require("../../utils/data")
    if (!data.isStaffUser()) {
      wx.showToast({ title: "无运营权限", icon: "none" })
      return
    }
    wx.navigateTo({ url: "/pages/ops-proxy/ops-proxy" })
  },

})







