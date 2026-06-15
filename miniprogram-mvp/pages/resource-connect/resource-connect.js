Page({
  _pageRefreshing: false,
  _lastPageRefresh: 0,

  data: {
    pageBlocked: false,
    targetId: "",
    targetTitle: "",
    targetPreview: null,
    targetFavorited: false,
    ownDemands: [],
    connectUseDemand: true,
    selectedDemandId: "",
    selectedDemandTitle: "",
    needsLogin: false,
    phoneLocked: false,
    maskedPhone: "",
    submitLocked: false,
    submitDone: false,
    form: {
      company: "",
      contact: "",
      phone: "",
      role: "",
      region: "",
      description: ""
    }
  },

  buildPageRedirect(options) {
    options = options || {}
    var url = "/pages/resource-connect/resource-connect?targetId=" + (options.targetId || "")
    if (options.title) {
      url += "&title=" + encodeURIComponent(options.title)
    }
    if (options.redirect) {
      url += "&redirect=" + encodeURIComponent(options.redirect)
    }
    return url
  },

  buildConnectReturnUrl() {
    var url = "/pages/resource-connect/resource-connect?targetId=" + this.data.targetId
    if (this.data.targetTitle) {
      url += "&title=" + encodeURIComponent(this.data.targetTitle)
    }
    return url
  },

  mergeFormPrefill(form, profile) {
    const data = require("../../utils/data")
    var next = Object.assign({}, form)
    var prefill = data.getSubmitFormPrefill(profile)
    Object.keys(prefill).forEach(function(key) {
      if (!next[key] && prefill[key]) {
        next[key] = prefill[key]
      }
    })
    if (profile && profile.phoneVerified && profile.phone) {
      next.phone = profile.phone
    }
    return next
  },

  buildPageState(options, extra) {
    const data = require("../../utils/data")
    options = options || {}
    extra = extra || {}
    const profile = data.getUserProfile()
    var form = extra.preserveForm
      ? this.mergeFormPrefill(this.data.form, profile)
      : Object.assign({}, this.data.form, data.getSubmitFormPrefill(profile))
    if (profile && profile.phoneVerified && profile.phone) {
      form.phone = profile.phone
    }
    const phoneLocked = !!(profile && profile.phoneVerified && profile.phone)
    const ownDemands = data.getUserActiveDemands()
    const needsLogin = data.requiresRegistration("connect") && !data.isUserRegistered()

    if (!form.role || !data.isValidEnterpriseRole(form.role)) {
      form.role = data.getEnterpriseRoleDefault("demand")
    }

    var targetPreview = null
    if (options.targetId) {
      var targetRaw = data.prepareListingForView(data.getItem(options.targetId), {
        isListingPublisher: data.isListingPublisher(options.targetId)
      })
      if (targetRaw) {
        if (!form.region && targetRaw.region) {
          form.region = data.normalizeEnterpriseRegion(targetRaw.region)
        }
        var targetLayout = data.buildListingViewLayout(targetRaw, true)
        targetPreview = {
          type: targetRaw.type,
          title: targetRaw.title,
          poolFacts: targetLayout.poolFacts,
          poolSummaryLine: targetLayout.poolSummaryLine
        }
      }
    }

    var connectUseDemand = this._connectModeManual
      ? this.data.connectUseDemand
      : (ownDemands.length > 0)

    return {
      targetId: options.targetId || "",
      targetTitle: options.title ? decodeURIComponent(options.title) : "",
      targetPreview: targetPreview,
      targetFavorited: options.targetId ? data.isFavoriteListing(options.targetId) : false,
      ownDemands: ownDemands,
      connectUseDemand: connectUseDemand,
      selectedDemandId: extra.preserveForm && this.data.selectedDemandId
        ? this.data.selectedDemandId
        : (ownDemands.length > 0 ? ownDemands[0].id : ""),
      selectedDemandTitle: extra.preserveForm && this.data.selectedDemandTitle
        ? this.data.selectedDemandTitle
        : (ownDemands.length > 0 ? ownDemands[0].title : ""),
      needsLogin: needsLogin,
      phoneLocked: phoneLocked,
      maskedPhone: profile && profile.phone ? data.maskPhone(profile.phone) : "",
      form: form
    }
  },

  redirectExistingConnect(existingConnect) {
    wx.redirectTo({
      url: "/pages/record/record?id=" + existingConnect.id,
      fail: function() {
        wx.navigateBack({
          fail: function() {
            wx.switchTab({ url: "/pages/resources/resources" })
          }
        })
      }
    })
  },

  onLoad(options) {
    options = options || {}
    const data = require("../../utils/data")
    this.pageOptions = options
    this._connectModeManual = false

    if (data.isStaffUser()) {
      this.setData({ pageBlocked: true })
      data.promptStaffCannotApplyConnect()
      setTimeout(function() {
        wx.navigateBack({
          fail: function() {
            wx.switchTab({ url: "/pages/home/home" })
          }
        })
      }, 300)
      return
    }

    const targetId = options.targetId || ""
    if (!targetId || !data.isResource(targetId) || !data.getItem(targetId)) {
      this.setData({ pageBlocked: true })
      wx.showModal({
        title: "对接规则",
        content: "仅支持需求方申请对接资源方，请从资源池选择有效资源后再申请。",
        showCancel: false,
        success: function() {
          wx.navigateBack({
            fail: function() {
              wx.switchTab({ url: "/pages/resources/resources" })
            }
          })
        }
      })
      return
    }

    if (data.isListingPublisher(targetId)) {
      this.setData({ pageBlocked: true })
      wx.showModal({
        title: "无法对接",
        content: "不能对自己发布的资源或需求发起对接申请。",
        showCancel: false,
        success: function() {
          wx.navigateBack({
            fail: function() {
              wx.switchTab({ url: "/pages/home/home" })
            }
          })
        }
      })
      return
    }

    if (data.isUserRegistered()) {
      var existingConnect = data.findViewerConnectForListing(targetId)
      if (existingConnect) {
        this.setData({ pageBlocked: true })
        wx.showToast({ title: "你已申请过该资源", icon: "none" })
        setTimeout(function() {
          this.redirectExistingConnect(existingConnect)
        }.bind(this), 400)
        return
      }
    }

    if (data.isUserRegistered() && !data.canSubmitListing()) {
      if (!data.ensureConnectAccess({
        redirect: this.buildPageRedirect(options),
        onDismiss: function() {
          wx.navigateBack({
            fail: function() {
              wx.switchTab({ url: "/pages/resources/resources" })
            }
          })
        }
      })) {
        return
      }
    }

    var pageState = this.buildPageState(options)
    this.setData(pageState)

    if (pageState.needsLogin) {
      wx.showModal({
        title: "请先登录",
        content: "登录后可填写对接申请，提交后由资源方确认信息。",
        confirmText: "去登录",
        cancelText: "稍后再说",
        success: function(res) {
          if (!res.confirm) {
            return
          }
          data.promptRegistration({ redirect: this.buildPageRedirect(options) })
        }.bind(this)
      })
    }
  },

  syncDemandPickerPatch() {
    if (this.data.pageBlocked) {
      return
    }
    const data = require("../../utils/data")
    const targetId = this.data.targetId || (this.pageOptions && this.pageOptions.targetId) || ""

    if (data.isUserRegistered() && targetId) {
      var existingConnect = data.getUserConnectSubmissionForTarget(targetId)
      if (existingConnect) {
        this.setData({ pageBlocked: true })
        this.redirectExistingConnect(existingConnect)
        return
      }
    }

    if (this.data.needsLogin && data.isUserRegistered()) {
      this.setData(Object.assign(this.buildPageState(this.pageOptions || {}, { preserveForm: true }), {
        needsLogin: false
      }))
      return
    }

    const patch = {}
    const ownDemands = data.getUserActiveDemands()
    patch.ownDemands = ownDemands
    if (ownDemands.length > 0) {
      const stillValid = ownDemands.some(function(item) {
        return item.id === this.data.selectedDemandId
      }.bind(this))
      if (!stillValid) {
        patch.selectedDemandId = ownDemands[0].id
        patch.selectedDemandTitle = ownDemands[0].title
      }
    }
    this.setData(patch)
  },

  refreshPageFromCloud(force) {
    if (this.data.pageBlocked) {
      return Promise.resolve()
    }
    const data = require("../../utils/data")
    if (!data.isCloudEnabled()) {
      this.syncDemandPickerPatch()
      return Promise.resolve()
    }
    var now = Date.now()
    if (!force && (this._pageRefreshing || now - this._lastPageRefresh < 12000)) {
      this.syncDemandPickerPatch()
      return Promise.resolve()
    }
    this._pageRefreshing = true
    return data.refreshFromCloudForMine().then(function() {
      this._lastPageRefresh = Date.now()
      this.syncDemandPickerPatch()
    }.bind(this)).catch(function(error) {
      console.warn("对接申请页同步失败", error)
      this.syncDemandPickerPatch()
      if (force) {
        wx.showToast({ title: "同步失败，显示本地数据", icon: "none" })
      }
    }.bind(this)).finally(function() {
      this._pageRefreshing = false
    }.bind(this))
  },

  onShow() {
    this.refreshPageFromCloud(false)
  },

  onPullDownRefresh() {
    this.refreshPageFromCloud(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    if (field === "phone" && this.data.phoneLocked) {
      return
    }
    const patch = {}
    patch["form." + field] = event.detail.value
    this.setData(patch)
  },

  setConnectMode(event) {
    this._connectModeManual = true
    this.setData({
      connectUseDemand: event.currentTarget.dataset.mode === "demand"
    })
  },

  selectOwnDemand(event) {
    this.setData({
      selectedDemandId: event.currentTarget.dataset.id,
      selectedDemandTitle: event.currentTarget.dataset.title
    })
  },

  toggleTargetFavorite() {
    const data = require("../../utils/data")
    const id = this.data.targetId
    if (!id) {
      return
    }
    const result = data.toggleFavoriteListing(id)
    if (result.needLogin) {
      data.promptFavoriteLogin("resources")
      return
    }
    if (!result.ok) {
      return
    }
    this.setData({ targetFavorited: result.favorited })
    wx.showToast({
      title: result.favorited ? "已收藏" : "已取消收藏",
      icon: "none"
    })
  },

  goPublishNewDemand() {
    const data = require("../../utils/data")
    if (!data.ensureSubmitListingAccess("demand", { redirect: this.buildConnectReturnUrl() })) {
      return
    }
    const redirect = encodeURIComponent(this.buildConnectReturnUrl())
    wx.navigateTo({
      url: "/pages/submit/submit?type=demand&redirect=" + redirect
    })
  },

  prepareConnectSubmitForm(form) {
    const data = require("../../utils/data")
    var next = Object.assign({}, form)
    if (!next.role || !data.isValidEnterpriseRole(next.role)) {
      next.role = data.getEnterpriseRoleDefault("demand")
    }
    if (!next.region && this.data.targetId) {
      var target = data.getItem(this.data.targetId)
      if (target && target.region) {
        next.region = data.normalizeEnterpriseRegion(target.region)
      }
    }
    if (next.region) {
      next.region = data.normalizeEnterpriseRegion(next.region)
    }
    return next
  },

  submitForm() {
    if (this.data.submitLocked || this.data.pageBlocked) {
      return
    }
    const data = require("../../utils/data")
    if (!data.ensureConnectAccess({ redirect: this.buildPageRedirect(this.pageOptions || {}) })) {
      return
    }

    var form = this.prepareConnectSubmitForm(this.data.form)
    const company = (form.company || "").trim()
    const contact = (form.contact || "").trim()
    const phone = (form.phone || "").trim()
    const description = (form.description || "").trim()

    if (!company || !contact || !phone) {
      wx.showToast({ title: "请填写企业名称、联系人和手机号", icon: "none" })
      return
    }
    if (this.data.connectUseDemand && !this.data.selectedDemandId) {
      wx.showToast({ title: "请选择你的需求", icon: "none" })
      return
    }
    if (!this.data.connectUseDemand && !description) {
      wx.showToast({ title: "请填写对接说明", icon: "none" })
      return
    }
    if (!data.canApplyConnectToListing(this.data.targetId)) {
      wx.showToast({ title: "不能对接自己发布的内容", icon: "none" })
      return
    }
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: "请输入正确手机号", icon: "none" })
      return
    }

    var runSubmit = function() {
      try {
        this.setData({ submitLocked: true })
        wx.showLoading({ title: "提交中", mask: true })
        data.saveUserProfile({
          company: company,
          role: form.role,
          region: form.region,
          contact: contact,
          phone: phone
        }).then(function() {
          var payload = {
            type: "connect",
            targetId: this.data.targetId,
            targetTitle: this.data.targetTitle,
            company: company,
            role: form.role,
            region: form.region,
            contact: contact,
            phone: phone,
            description: description,
            connectDirection: "demand_to_resource",
            targetType: "resource",
            sourceListingId: this.data.connectUseDemand ? this.data.selectedDemandId : "",
            sourceTitle: this.data.connectUseDemand ? this.data.selectedDemandTitle : "",
            title: "需求对接资源：" + (this.data.targetTitle || "")
          }
          return data.createSubmissionFlowAsync(payload, "connect", form)
        }.bind(this)).then(function(result) {
          wx.hideLoading()
          this.setData({ submitDone: true })
          var record = result.record
          wx.showToast({
            title: record && record.status === "待平台审核"
              ? "已提交，等待平台审批对接"
              : "已发送，等待资源方确认",
            icon: "success"
          })
          setTimeout(function() {
            data.clearShareIntent()
            if (this.data.targetId) {
              data.markResourceViewed(this.data.targetId)
            }
            wx.redirectTo({
              url: "/pages/record/record?id=" + record.id,
              fail: function() {
                wx.navigateTo({ url: "/pages/record/record?id=" + record.id })
              }
            })
          }.bind(this), 700)
        }.bind(this)).catch(function(error) {
          wx.hideLoading()
          this.setData({ submitLocked: false, submitDone: false })
          wx.showToast({ title: error.message || "提交失败，请重试", icon: "none" })
        }.bind(this))
      } catch (error) {
        wx.hideLoading()
        this.setData({ submitLocked: false, submitDone: false })
        wx.showToast({ title: "提交失败，请重试", icon: "none" })
      }
    }.bind(this)

    data.requestConnectSubscribe().then(runSubmit).catch(runSubmit)
  }
})
