const copyMap = {
  demand: {
    title: "提交需求",
    subtitle: "",
    submit: "提交需求"
  },
  resource: {
    title: "发布资源",
    subtitle: "",
    submit: "发布资源"
  },
  server: {
    title: "找整机",
    subtitle: "",
    submit: "提交整机需求"
  },
  room: {
    title: "找机房/建机房",
    subtitle: "",
    submit: "提交项目需求"
  },
  match: {
    title: "申请人工撮合",
    subtitle: "由平台撮合经理协助确认需求、推荐企业并推动线下沟通。",
    label: "撮合说明",
    placeholder: "例如：我有客户需求，希望对接可靠 H800 资源方。",
    submit: "申请人工撮合"
  },
  connect: {
    title: "申请对接资源",
    subtitle: "申请后由资源方确认信息，双方同意后可交换联系方式。",
    label: "对接说明",
    placeholder: "请说明你的需求与这条资源的匹配点、合作意向等。",
    submit: "提交对接申请"
  },
  matchResource: {
    title: "我有匹配资源",
    subtitle: "勾选你已发布的资源向需求方发起对接，需求方确认后可交换联系方式。",
    label: "匹配说明",
    placeholder: "请说明你的资源与这条需求的匹配点、合作意向等。",
    submit: "提交匹配申请"
  }
}

const proxyCopyMap = {
  demand: {
    title: "代发需求",
    subtitle: "填写客户需求信息，提交后在需求池展示，并可在详情查看匹配资源。",
    submit: "提交代发需求"
  },
  resource: {
    title: "代发资源",
    subtitle: "填写客户资源信息，提交后在资源池展示，并可在详情查看匹配需求。",
    submit: "提交代发资源"
  },
  connect: {
    title: "代发资源对接需求",
    subtitle: "已关联代发资源，确认客户信息并填写补充说明后提交，等待需求方确认。",
    label: "对接说明",
    placeholder: "可补充匹配理由、交付能力、合作意向等。",
    submit: "提交对接申请"
  }
}

Page({
  data: {
    type: "demand",
    isPublishForm: false,
    isResourceForm: false,
    isServerForm: false,
    targetId: "",
    targetTitle: "",
    targetPreview: null,
    pageTitle: "",
    pageSubtitle: "",
    descriptionLabel: "",
    descriptionPlaceholder: "",
    submitText: "",
    submitLocked: false,
    submitDone: false,
    needsCardCert: false,
    certPending: false,
    certBannerTitle: "",
    certBannerText: "",
    certActionText: "",
    certBlockedSubmitText: "",
    needsLogin: false,
    phoneLocked: false,
    isQuickDemand: false,
    isQuickResource: false,
    showSupplementSection: false,
    showAttachments: false,
    isRentalForm: false,
    isMaintForm: false,
    listingTypeHint: "",
    isFinanceForm: false,
    isComprehensiveForm: false,
    isComputeForm: false,
    isPartsForm: false,
    isIdcForm: false,
    isRoomBuildForm: false,
    isDcOpForm: false,
    isAgentForm: false,
    attachments: [],
    maxAttachments: 5,
    isConnectForm: false,
    isResourceConnect: false,
    connectDirection: "demand_to_resource",
    ownDemands: [],
    ownResources: [],
    connectUseDemand: true,
    connectUseResource: true,
    selectedDemandId: "",
    selectedDemandTitle: "",
    selectedResourceId: "",
    selectedResourceTitle: "",
    returnUrl: "",
    isProxyMode: false,
    isProxyConnectMode: false,
    proxySourceResourceId: "",
    needCompany: true,
    maskedPhone: "",
    regionOptions: [],
    listingTypeOptions: [],
    roleOptions: [],
    deliveryOptions: ["整机交付", "裸金属", "容器环境", "云主机", "机柜托管", "项目制交付", "待沟通"],
    form: {
      company: "",
      role: "",
      region: "",
      contact: "",
      phone: "",
      title: "",
      listingType: "",
      scale: "",
      budget: "",
      price: "",
      delivery: "",
      startTime: "",
      deliveryTime: "",
      deliveryKind: "",
      deliveryTimeDetail: "",
      configSpec: "",
      procurementRegion: "",
      serverBrand: "",
      warranty: "",
      serverProduct: "",
      serverPayment: "",
      serverProcess: "",
      specModel: "",
      cycle: "",
      networkSpec: "",
      rentalSubject: "",
      maintenanceTarget: "",
      idcName: "",
      idcLevel: "",
      cabinetPower: "",
      bandwidth: "",
      projectScale: "",
      serviceScope: "",
      dcName: "",
      financePurpose: "",
      financeScale: "",
      financeMode: "",
      description: "",
      publicDisplay: true
    }
  },

  buildSubmitRedirect(options) {
    const type = options.type || "demand"
    var redirect = "/pages/submit/submit?type=" + type
    if (options.listingType) {
      redirect += "&listingType=" + encodeURIComponent(options.listingType)
    }
    if (options.direction) {
      redirect += "&direction=" + encodeURIComponent(options.direction)
    }
    if (options.targetId) {
      redirect += "&targetId=" + options.targetId
    }
    if (options.title) {
      redirect += "&title=" + encodeURIComponent(options.title)
    }
    if (options.redirect) {
      redirect += "&redirect=" + encodeURIComponent(options.redirect)
    }
    return redirect
  },

  buildPageState(options) {
    const data = require("../../utils/data")
    const type = options.type || "demand"
    const isProxyMode = options.mode === "proxy"
    const connectDirection = options.direction || "demand_to_resource"
    const isConnectForm = type === "connect"
    const isResourceConnect = isConnectForm && connectDirection === "resource_to_demand"
    const isProxyConnectMode = isProxyMode && isResourceConnect && !!options.sourceResourceId
    const copySource = isProxyMode
      ? (isConnectForm ? proxyCopyMap.connect : (proxyCopyMap[type] || proxyCopyMap.demand))
      : (copyMap[type === "connect" && connectDirection === "resource_to_demand" ? "matchResource" : type] || copyMap.demand)
    const copy = copySource
    const profile = data.getUserProfile()
    const form = Object.assign({}, this.data.form, isProxyMode ? {} : data.getSubmitFormPrefill(profile))
    if (!isProxyMode && profile && profile.phoneVerified && profile.phone) {
      form.phone = profile.phone
    }
    const phoneLocked = !isProxyMode && !!(profile && profile.phoneVerified && profile.phone)
    const isPublishForm = data.isPublishType(type)
    const isResourceForm = type === "resource"
    const listingTypeOptions = isResourceForm ? data.getResourceTypeOptions() : data.getDemandTypeOptions()

    if (type === "room") {
      form.listingType = "机房建设"
    }
    if (type === "server") {
      form.listingType = "算力整机"
    }
    if (options.listingType) {
      form.listingType = decodeURIComponent(options.listingType)
    }

    const formProfile = isResourceForm
      ? data.getResourceFormProfile(form.listingType)
      : data.getDemandFormProfile(form.listingType)
    const isServerForm = formProfile.isServerForm
    if (isServerForm && form.deliveryTime && !form.deliveryKind) {
      var parsedDelivery = data.parseServerDeliveryTime(form.deliveryTime)
      form.deliveryKind = parsedDelivery.deliveryKind
      form.deliveryTimeDetail = parsedDelivery.deliveryTimeDetail
    }
    const isQuickDemand = isPublishForm && !isResourceForm
    const isQuickResource = isPublishForm && isResourceForm
    const showSupplementSection = !isServerForm && !formProfile.isPartsForm && (
      formProfile.isRentalForm ||
      formProfile.isMaintForm ||
      formProfile.isRoomBuildForm ||
      formProfile.isFinanceForm ||
      formProfile.isDcOpForm
    )
    var ownDemands = isConnectForm && !isResourceConnect ? data.getUserActiveDemands() : []
    var ownResources = isResourceConnect && !isProxyConnectMode ? data.getUserActiveResources() : []
    var proxySourceResource = null
    var proxySourceResourceId = options.sourceResourceId || ""
    if (isProxyConnectMode && proxySourceResourceId) {
      proxySourceResource = data.getItem(proxySourceResourceId)
      if (proxySourceResource) {
        ownResources = [data.prepareListingForView(proxySourceResource)].filter(Boolean)
        var proxySourceSub = proxySourceResource.submissionId ? data.getSubmission(proxySourceResource.submissionId) : null
        form = data.enrichStaffProxyConnectFormFromResource(form, proxySourceResource, proxySourceSub)
      }
    }
    if (isQuickDemand && !form.role) {
      form.role = data.getEnterpriseRoleDefault("demand")
    }
    if (isQuickResource) {
      form.role = data.getEnterpriseRoleDefault("supply")
    }
    if (isConnectForm) {
      var connectSide = isResourceConnect ? "supply" : "demand"
      if (!form.role || !data.isValidEnterpriseRole(form.role)) {
        form.role = data.getEnterpriseRoleDefault(connectSide)
      }
    }

    var targetRaw = null
    const needsLogin = !isProxyMode && data.requiresRegistration(type) && !data.isUserRegistered()
    const needsCardCert = !isProxyMode && data.requiresCardCertification(type) && data.isUserRegistered() && !data.canSubmitListing()

    var targetPreview = null
    if (options.targetId) {
      targetRaw = data.prepareListingForView(data.getItem(options.targetId), {
        isListingPublisher: data.isListingPublisher(options.targetId)
      })
      if (targetRaw) {
        if (isConnectForm && !form.region && targetRaw.region) {
          form.region = data.normalizeEnterpriseRegion(targetRaw.region)
        }
        var targetIsResource = data.isResource(options.targetId)
        var targetLayout = data.buildListingViewLayout(targetRaw, targetIsResource)
        targetPreview = {
          type: targetRaw.type,
          title: targetRaw.title,
          poolFacts: targetLayout.poolFacts,
          poolSummaryLine: targetLayout.poolSummaryLine
        }
      }
    }

    var listingTypeHint = isResourceForm
      ? data.getResourceTypeHint(form.listingType)
      : data.getDemandTypeHint(form.listingType)
    var certGateCopy = needsCardCert ? data.getListingCertGateCopy(type) : null

    var pageTitle = copy.title
    var pageSubtitle = copy.subtitle
    var submitText = copy.submit
    if (isQuickDemand && !isProxyMode) {
      pageTitle = copyMap.demand.title
      pageSubtitle = ""
      submitText = copyMap.demand.submit
    } else if (isQuickResource && !isProxyMode) {
      pageTitle = copyMap.resource.title
      pageSubtitle = ""
      submitText = copyMap.resource.submit
    }

    return {
      type: type,
      isPublishForm: isPublishForm,
      isResourceForm: isResourceForm,
      isServerForm: isServerForm,
      isQuickDemand: isQuickDemand,
      isQuickResource: isQuickResource,
      showSupplementSection: showSupplementSection,
      showAttachments: isQuickDemand || isQuickResource,
      isRentalForm: formProfile.isRentalForm || false,
      isMaintForm: formProfile.isMaintForm || false,
      isFinanceForm: formProfile.isFinanceForm || false,
      isComprehensiveForm: formProfile.isComprehensiveForm || false,
      isOtherForm: formProfile.isOtherForm || false,
      isComputeForm: formProfile.isComputeForm,
      isPartsForm: formProfile.isPartsForm || false,
      isIdcForm: formProfile.isIdcForm,
      isRoomBuildForm: formProfile.isRoomBuildForm,
      isDcOpForm: formProfile.isDcOpForm || false,
      isAgentForm: false,
      maxAttachments: data.MAX_SUBMISSION_ATTACHMENTS,
      isConnectForm: isConnectForm,
      isResourceConnect: isResourceConnect,
      connectDirection: connectDirection,
      ownDemands: ownDemands,
      ownResources: ownResources,
      connectUseDemand: isConnectForm && !isResourceConnect,
      connectUseResource: isResourceConnect,
      selectedDemandId: ownDemands.length > 0 ? ownDemands[0].id : "",
      selectedDemandTitle: ownDemands.length > 0 ? ownDemands[0].title : "",
      selectedResourceId: isProxyConnectMode
        ? proxySourceResourceId
        : (ownResources.length > 0 ? ownResources[0].id : ""),
      selectedResourceTitle: isProxyConnectMode && proxySourceResource
        ? proxySourceResource.title
        : (ownResources.length > 0 ? ownResources[0].title : ""),
      needCompany: !(profile && profile.company),
      maskedPhone: profile && profile.phone ? data.maskPhone(profile.phone) : "",
      targetId: options.targetId || "",
      targetTitle: options.title ? decodeURIComponent(options.title) : "",
      targetPreview: targetPreview,
      targetFavorited: options.targetId ? data.isFavoriteListing(options.targetId) : false,
      returnUrl: options.redirect ? decodeURIComponent(options.redirect) : (isProxyMode ? "/pages/ops-proxy/ops-proxy" : ""),
      isProxyMode: isProxyMode,
      isProxyConnectMode: isProxyConnectMode,
      proxySourceResourceId: proxySourceResourceId,
      pageTitle: pageTitle,
      pageSubtitle: pageSubtitle,
      descriptionLabel: copy.label || "补充说明",
      descriptionPlaceholder: copy.placeholder || "可补充网络、运维、合规、交付等特殊要求",
      submitText: submitText,
      needsLogin: needsLogin,
      needsCardCert: needsCardCert,
      certPending: certGateCopy ? certGateCopy.pending : false,
      certBannerTitle: certGateCopy ? certGateCopy.bannerTitle : "",
      certBannerText: certGateCopy ? certGateCopy.bannerText : "",
      certActionText: certGateCopy ? certGateCopy.actionText : "",
      certBlockedSubmitText: certGateCopy ? certGateCopy.submitText : "",
      regionOptions: data.getEnterpriseRegionOptions(),
      roleOptions: data.getEnterpriseRoleOptions(),
      listingTypeOptions: listingTypeOptions,
      listingTypeHint: listingTypeHint,
      form: form,
      phoneLocked: phoneLocked
    }
  },

  onLoad(options) {
    options = options || {}
    const data = require("../../utils/data")
    const type = options.type || "demand"
    this.pageOptions = options

    if (type === "connect" && options.mode !== "proxy" && (options.direction || "demand_to_resource") === "demand_to_resource") {
      var resourceConnectUrl = "/pages/resource-connect/resource-connect?targetId=" + (options.targetId || "")
      if (options.title) {
        resourceConnectUrl += "&title=" + encodeURIComponent(options.title)
      }
      if (options.redirect) {
        resourceConnectUrl += "&redirect=" + encodeURIComponent(options.redirect)
      }
      wx.redirectTo({ url: resourceConnectUrl })
      return
    }

    if (options.mode === "proxy") {
      if (!data.isStaffUser()) {
        wx.showModal({
          title: "需要运营账号",
          content: "代发功能仅限已开通 staffRole 的运营账号使用，请使用运营账号登录。",
          showCancel: false,
          success: function() {
            wx.navigateBack({
              fail: function() {
                wx.switchTab({ url: "/pages/mine/mine" })
              }
            })
          }
        })
        return
      }
      if (type === "connect") {
        var proxyConnectDirection = options.direction || "demand_to_resource"
        var sourceResourceId = options.sourceResourceId || ""
        var proxyTargetId = options.targetId || ""
        if (proxyConnectDirection !== "resource_to_demand") {
          wx.showModal({
            title: "对接规则",
            content: "代发资源对接请从代发资源详情进入需求池，选择目标需求后再提交。",
            showCancel: false,
            success: function() {
              wx.navigateBack({
                fail: function() {
                  wx.switchTab({ url: "/pages/demands/demands" })
                }
              })
            }
          })
          return
        }
        if (!sourceResourceId || !data.isResource(sourceResourceId) || !data.canStaffManageProxyListing(sourceResourceId)) {
          wx.showModal({
            title: "代发资源无效",
            content: "请从代发资源详情重新进入需求池选择对接目标。",
            showCancel: false,
            success: function() {
              wx.navigateBack({
                fail: function() {
                  wx.navigateTo({ url: "/pages/ops-proxy/ops-proxy" })
                }
              })
            }
          })
          return
        }
        if (!proxyTargetId || data.isResource(proxyTargetId)) {
          wx.showModal({
            title: "需求无效",
            content: "请从需求池选择有效需求后再对接。",
            showCancel: false,
            success: function() {
              wx.switchTab({ url: "/pages/demands/demands" })
            }
          })
          return
        }
        var proxyPairState = data.getProxyResourceConnectPairState(sourceResourceId, proxyTargetId)
        if (!proxyPairState.canConnect) {
          if (proxyPairState.connectRecordId) {
            wx.redirectTo({
              url: "/pages/record/record?id=" + proxyPairState.connectRecordId
            })
            return
          }
          wx.showToast({ title: "当前不可对接该需求", icon: "none" })
          setTimeout(function() {
            wx.navigateBack({
              fail: function() {
                wx.switchTab({ url: "/pages/demands/demands" })
              }
            })
          }, 400)
          return
        }
      } else if (type !== "resource" && type !== "demand") {
        wx.showToast({ title: "仅支持代发资源或需求", icon: "none" })
        setTimeout(function() {
          wx.navigateBack()
        }, 400)
        return
      }
    } else if (data.isPublishType(type) && data.isUserPoolPublishBlocked()) {
      data.promptStaffUseProxyPublish({
        redirect: "/pages/ops-proxy/ops-proxy"
      })
      setTimeout(function() {
        wx.navigateBack({
          fail: function() {
            wx.switchTab({ url: "/pages/resources/resources" })
          }
        })
      }, 300)
      return
    } else if (data.isStaffUser() && type === "connect" && options.mode !== "proxy") {
      data.promptStaffCannotApplyConnect()
      setTimeout(function() {
        wx.navigateBack({
          fail: function() {
            wx.switchTab({ url: "/pages/home/home" })
          }
        })
      }, 300)
      return
    } else if (options.mode !== "proxy" && data.isPublishType(type) && data.isUserRegistered() && !data.canSubmitListing()) {
      var listingRedirect = this.buildSubmitRedirect(options)
      if (!data.ensureSubmitListingAccess(type, {
        redirect: listingRedirect,
        onDismiss: function() {
          wx.navigateBack({
            fail: function() {
              wx.switchTab({ url: "/pages/home/home" })
            }
          })
        }
      })) {
        return
      }
    } else if (options.mode !== "proxy" && data.isUserRegistered() && !data.canSubmitListing()) {
      var certRedirect = this.buildSubmitRedirect(options)
      var dismissBack = function() {
        wx.navigateBack({
          fail: function() {
            wx.switchTab({ url: "/pages/home/home" })
          }
        })
      }
      if (type === "match") {
        if (!data.ensureMatchAccess({ redirect: certRedirect, onDismiss: dismissBack })) {
          return
        }
      } else if (type === "connect") {
        var connectDirection = options.direction || "demand_to_resource"
        var ensureAccess = connectDirection === "resource_to_demand"
          ? data.ensureMatchAccess.bind(data)
          : data.ensureConnectAccess.bind(data)
        if (!ensureAccess({ redirect: certRedirect, onDismiss: dismissBack })) {
          return
        }
      }
    }

    if (type === "connect" && options.mode !== "proxy") {
      const targetId = options.targetId || ""
      const connectDirection = options.direction || "demand_to_resource"
      if (connectDirection === "resource_to_demand") {
        if (!targetId || data.isResource(targetId)) {
          wx.showModal({
            title: "匹配规则",
            content: "请从需求详情页选择要匹配的需求后再提交。",
            showCancel: false,
            success: function() {
              wx.navigateBack({
                fail: function() {
                  wx.switchTab({ url: "/pages/demands/demands" })
                }
              })
            }
          })
          return
        }
      } else if (!targetId || !data.isResource(targetId)) {
        wx.showModal({
          title: "对接规则",
          content: "仅支持需求方申请对接资源方，请从资源池选择资源后再申请。",
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
      var sourceListingId = options.sourceResourceId || options.sourceListingId || ""
      var blockingConnect = data.findBlockingConnectForApply({
        type: "connect",
        targetId: targetId,
        connectDirection: connectDirection,
        sourceListingId: sourceListingId
      })
      if (blockingConnect) {
        var blockingMessage = data.getBlockingConnectApplyMessage({
          connectDirection: connectDirection
        }, blockingConnect)
        wx.showToast({ title: blockingMessage, icon: "none" })
        setTimeout(function() {
          wx.navigateBack({
            fail: function() {
              wx.switchTab({
                url: connectDirection === "resource_to_demand"
                  ? "/pages/demands/demands"
                  : "/pages/resources/resources"
              })
            }
          })
        }, 400)
        return
      }
    }

    var pageState = this.buildPageState(options)
    wx.setNavigationBarTitle({ title: pageState.pageTitle || "提交信息" })
    this.setData(pageState)

    if (pageState.needsLogin) {
      var loginRedirect = this.buildSubmitRedirect(options)
      wx.showModal({
        title: "请先登录",
        content: type === "connect"
          ? "登录后可填写对接申请，提交后由资源方确认信息。"
          : data.getRegistrationPromptContent(type),
        confirmText: "去登录",
        cancelText: "稍后再说",
        success: function(res) {
          if (res.confirm) {
            wx.redirectTo({
              url: data.buildLoginUrl(loginRedirect)
            })
          }
        }
      })
    }
  },

  onShow() {
    const data = require("../../utils/data")
    if (this.pageOptions) {
      var pageState = this.buildPageState(this.pageOptions)
      const certPatch = {}
      if (pageState.needsLogin !== this.data.needsLogin) {
        certPatch.needsLogin = pageState.needsLogin
      }
      if (pageState.needsCardCert !== this.data.needsCardCert
        || pageState.certPending !== this.data.certPending) {
        certPatch.needsCardCert = pageState.needsCardCert
        certPatch.certPending = pageState.certPending
        certPatch.certBannerTitle = pageState.certBannerTitle
        certPatch.certBannerText = pageState.certBannerText
        certPatch.certActionText = pageState.certActionText
        certPatch.certBlockedSubmitText = pageState.certBlockedSubmitText
      }
      if (Object.keys(certPatch).length > 0) {
        this.setData(certPatch)
      }
    }
    if (!this.data.isConnectForm) {
      return
    }
    if (this.data.isResourceConnect) {
      const ownResources = data.getUserActiveResources()
      const patch = { ownResources: ownResources }
      if (ownResources.length > 0) {
        const stillValid = ownResources.some(function(item) {
          return item.id === this.data.selectedResourceId
        }.bind(this))
        if (!stillValid) {
          patch.selectedResourceId = ownResources[0].id
          patch.selectedResourceTitle = ownResources[0].title
        }
        patch.connectUseResource = true
      }
      this.setData(patch)
      return
    }
    const ownDemands = data.getUserActiveDemands()
    const patch = { ownDemands: ownDemands }
    if (ownDemands.length > 0) {
      const stillValid = ownDemands.some(function(item) {
        return item.id === this.data.selectedDemandId
      }.bind(this))
      if (!stillValid) {
        patch.selectedDemandId = ownDemands[0].id
        patch.selectedDemandTitle = ownDemands[0].title
      }
      patch.connectUseDemand = true
    }
    this.setData(patch)
  },

  buildConnectReturnUrl() {
    if (!this.data.isResourceConnect && (this.data.connectDirection || "demand_to_resource") === "demand_to_resource") {
      var rcUrl = "/pages/resource-connect/resource-connect?targetId=" + (this.data.targetId || "")
      if (this.data.targetTitle) {
        rcUrl += "&title=" + encodeURIComponent(this.data.targetTitle)
      }
      return rcUrl
    }
    var url = "/pages/submit/submit?type=connect"
    if (this.data.targetId) {
      url += "&targetId=" + this.data.targetId
    }
    if (this.data.targetTitle) {
      url += "&title=" + encodeURIComponent(this.data.targetTitle)
    }
    if (this.data.connectDirection && this.data.connectDirection !== "demand_to_resource") {
      url += "&direction=" + this.data.connectDirection
    }
    return url
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

  onRoleChange(event) {
    this.setData({
      "form.role": this.data.roleOptions[event.detail.value]
    })
  },

  onRegionChange(event) {
    this.setData({
      "form.region": this.data.regionOptions[event.detail.value]
    })
  },

  applyListingProfile(listingType) {
    const data = require("../../utils/data")
    const profile = this.data.isQuickResource || this.data.isResourceForm
      ? data.getResourceFormProfile(listingType)
      : data.getDemandFormProfile(listingType)
    var patch = Object.assign({
      "form.listingType": listingType,
      isServerForm: profile.isServerForm,
      showSupplementSection: !profile.isServerForm && !profile.isPartsForm && (
        profile.isRentalForm ||
        profile.isMaintForm ||
        profile.isRoomBuildForm ||
        profile.isFinanceForm ||
        profile.isDcOpForm
      ),
      listingTypeHint: (this.data.isQuickResource || this.data.isResourceForm)
        ? data.getResourceTypeHint(listingType)
        : data.getDemandTypeHint(listingType)
    }, profile)
    if (profile.isServerForm) {
      patch["form.specModel"] = ""
      patch["form.cycle"] = ""
      patch["form.delivery"] = ""
      patch["form.deliveryKind"] = ""
      patch["form.deliveryTimeDetail"] = ""
      patch["form.deliveryTime"] = ""
      patch["form.networkSpec"] = ""
      patch["form.idcName"] = ""
      patch["form.idcLevel"] = ""
      patch["form.cabinetPower"] = ""
      patch["form.bandwidth"] = ""
      patch["form.projectScale"] = ""
      patch["form.serviceScope"] = ""
      patch["form.dcName"] = ""
    } else {
      patch["form.serverProduct"] = ""
      patch["form.serverBrand"] = ""
      patch["form.serverPayment"] = ""
      patch["form.serverProcess"] = ""
      patch["form.configSpec"] = ""
      patch["form.procurementRegion"] = ""
      patch["form.warranty"] = ""
      patch["form.deliveryKind"] = ""
      patch["form.deliveryTimeDetail"] = ""
    }
    this.setData(patch)
  },

  onListingTypeChange(event) {
    const listingType = this.data.listingTypeOptions[event.detail.value]
    this.applyListingProfile(listingType)
  },

  onDeliveryChange(event) {
    this.setData({
      "form.delivery": this.data.deliveryOptions[event.detail.value]
    })
  },

  setServerDeliveryKind(event) {
    var kind = event.currentTarget.dataset.kind
    if (!kind) {
      return
    }
    this.setData({
      "form.deliveryKind": kind
    })
  },

  onServerDeliveryDetailInput(event) {
    this.setData({
      "form.deliveryTimeDetail": event.detail.value
    })
  },

  onPublicDisplayChange(event) {
    this.setData({
      "form.publicDisplay": !!event.detail.value
    })
  },

  setConnectMode(event) {
    var mode = event.currentTarget.dataset.mode
    if (this.data.isResourceConnect) {
      this.setData({
        connectUseResource: mode === "resource"
      })
      return
    }
    this.setData({
      connectUseDemand: mode === "demand"
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
      data.promptFavoriteLogin(this.data.isResourceConnect ? "demands" : "resources")
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

  selectOwnDemand(event) {
    this.setData({
      selectedDemandId: event.currentTarget.dataset.id,
      selectedDemandTitle: event.currentTarget.dataset.title
    })
  },

  selectOwnResource(event) {
    if (this.data.isProxyConnectMode) {
      return
    }
    this.setData({
      selectedResourceId: event.currentTarget.dataset.id,
      selectedResourceTitle: event.currentTarget.dataset.title
    })
  },

  goPublishNewDemand() {
    const data = require("../../utils/data")
    if (!data.ensureSubmitListingAccess("demand")) {
      return
    }
    const redirect = encodeURIComponent(this.buildConnectReturnUrl())
    wx.navigateTo({
      url: "/pages/submit/submit?type=demand&redirect=" + redirect
    })
  },

  goPublishNewResource() {
    const data = require("../../utils/data")
    if (!data.ensureSubmitListingAccess("resource")) {
      return
    }
    const redirect = encodeURIComponent(this.buildConnectReturnUrl())
    wx.navigateTo({
      url: "/pages/submit/submit?type=resource&redirect=" + redirect
    })
  },

  buildQuickDemandForm(form) {
    const data = require("../../utils/data")
    const desc = (form.description || "").trim()
    const listingType = form.listingType || "算力租赁"
    const region = form.region || ""
    const product = (form.serverProduct || "").trim()
    const title = (form.title || "").trim()
      || (product
        ? product + ((form.scale || "").trim() ? " " + form.scale : "")
        : (((form.scale || "").trim() ? (form.scale + " ") : "") + ((region ? region + " " : "")) + listingType + "需求"))
    return Object.assign({}, form, {
      title: this.data.isPartsForm && !(form.title || "").trim() && product
        ? product + ((form.scale || "").trim() ? " " + form.scale : "")
        : title,
      role: form.role || data.getEnterpriseRoleDefault("demand"),
      contact: (form.contact || "").trim(),
      region: (form.region || "").trim(),
      scale: this.data.isServerForm
        ? data.normalizeListingScaleForServer((form.scale || "").trim(), form.listingType || "算力整机")
        : (form.scale || "").trim(),
      budget: (form.budget || "").trim(),
      startTime: (form.startTime || "").trim(),
      deliveryTime: this.data.isServerForm
        ? data.buildServerDeliveryTime(form.deliveryKind, form.deliveryTimeDetail)
        : (form.deliveryTime || "").trim(),
      configSpec: (form.configSpec || "").trim(),
      procurementRegion: (form.procurementRegion || "").trim(),
      serverBrand: (form.serverBrand || "").trim(),
      serverProduct: (form.serverProduct || "").trim(),
      serverPayment: (form.serverPayment || "").trim(),
      serverProcess: (form.serverProcess || "").trim(),
      specModel: (form.specModel || "").trim(),
      networkSpec: (form.networkSpec || "").trim(),
      rentalSubject: (form.rentalSubject || "").trim(),
      maintenanceTarget: (form.maintenanceTarget || "").trim(),
      idcName: (form.idcName || "").trim(),
      idcLevel: (form.idcLevel || "").trim(),
      cabinetPower: (form.cabinetPower || "").trim(),
      bandwidth: (form.bandwidth || "").trim(),
      delivery: (form.delivery || "").trim(),
      warranty: (form.warranty || "").trim(),
      projectScale: (form.projectScale || "").trim(),
      serviceScope: (form.serviceScope || "").trim(),
      financePurpose: (form.financePurpose || "").trim(),
      financeScale: (form.financeScale || "").trim(),
      financeMode: (form.financeMode || "").trim(),
      description: desc
    })
  },

  chooseAttachment() {
    const data = require("../../utils/data")
    const remaining = this.data.maxAttachments - this.data.attachments.length
    if (remaining <= 0) {
      wx.showToast({ title: "最多上传" + this.data.maxAttachments + "个附件", icon: "none" })
      return
    }
    wx.showActionSheet({
      itemList: ["上传图片", "选择文件"],
      success: function(res) {
        if (res.tapIndex === 0) {
          this.chooseAttachmentImage(remaining)
          return
        }
        if (res.tapIndex === 1) {
          this.chooseAttachmentFile(remaining)
        }
      }.bind(this)
    })
  },

  chooseAttachmentImage(count) {
    wx.chooseMedia({
      count: count,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: function(res) {
        const files = (res.tempFiles || []).map(function(item, index) {
          return {
            path: item.tempFilePath,
            name: "图片" + (index + 1) + ".jpg"
          }
        })
        this.uploadAttachmentFiles(files)
      }.bind(this)
    })
  },

  chooseAttachmentFile(count) {
    wx.chooseMessageFile({
      count: count,
      type: "all",
      success: function(res) {
        const files = (res.tempFiles || []).map(function(item) {
          return {
            path: item.path,
            name: item.name || "附件"
          }
        })
        this.uploadAttachmentFiles(files)
      }.bind(this)
    })
  },

  uploadAttachmentFiles(files) {
    const data = require("../../utils/data")
    if (!files || files.length === 0) {
      return
    }
    wx.showLoading({ title: "上传中", mask: true })
    Promise.all(files.map(function(file) {
      return data.saveSubmissionAttachment(file.path, file.name)
    })).then(function(results) {
      wx.hideLoading()
      this.setData({
        attachments: this.data.attachments.concat(results).slice(0, this.data.maxAttachments)
      })
      wx.showToast({ title: "附件已添加", icon: "success" })
    }.bind(this)).catch(function(error) {
      wx.hideLoading()
      wx.showToast({ title: error.message || "附件上传失败", icon: "none" })
    })
  },

  removeAttachment(event) {
    const id = event.currentTarget.dataset.id
    this.setData({
      attachments: this.data.attachments.filter(function(item) {
        return item.id !== id
      })
    })
  },

  previewAttachment(event) {
    const index = Number(event.currentTarget.dataset.index)
    const item = this.data.attachments[index]
    if (!item) {
      return
    }
    if (item.fileType === "image") {
      const urls = this.data.attachments
        .filter(function(entry) { return entry.fileType === "image" })
        .map(function(entry) { return entry.url })
      wx.previewImage({
        current: item.url,
        urls: urls
      })
      return
    }
    wx.openDocument({
      filePath: item.url,
      showMenu: true,
      fail: function() {
        wx.showToast({ title: "暂不支持预览该文件", icon: "none" })
      }
    })
  },

  buildQuickResourceForm(form) {
    const data = require("../../utils/data")
    const desc = (form.description || "").trim()
    const listingType = form.listingType || "算力租赁"
    const region = form.region || ""
    const product = (form.serverProduct || "").trim()
    const title = (form.title || "").trim()
      || (this.data.isServerForm
        ? data.buildServerResourceTitle(form)
        : (this.data.isPartsForm ? data.buildPartsResourceTitle(form) : ""))
    return Object.assign({}, form, {
      title: title,
      region: (form.region || "").trim(),
      role: data.getEnterpriseRoleDefault("supply"),
      contact: (form.contact || "").trim(),
      scale: this.data.isServerForm
        ? data.normalizeListingScaleForServer((form.scale || "").trim(), form.listingType || "算力整机")
        : (form.scale || "").trim(),
      price: (form.price || "").trim(),
      specModel: (form.specModel || "").trim(),
      cycle: (form.cycle || "").trim(),
      deliveryTime: this.data.isServerForm
        ? data.buildServerDeliveryTime(form.deliveryKind, form.deliveryTimeDetail)
        : (form.deliveryTime || "").trim(),
      configSpec: (form.configSpec || "").trim(),
      procurementRegion: (form.procurementRegion || "").trim(),
      warranty: (form.warranty || "").trim(),
      serverProduct: (form.serverProduct || "").trim(),
      serverPayment: (form.serverPayment || "").trim(),
      serverProcess: (form.serverProcess || "").trim(),
      delivery: (form.delivery || "").trim(),
      networkSpec: (form.networkSpec || "").trim(),
      rentalSubject: (form.rentalSubject || "").trim(),
      maintenanceTarget: (form.maintenanceTarget || "").trim(),
      idcName: (form.idcName || "").trim(),
      idcLevel: (form.idcLevel || "").trim(),
      cabinetPower: (form.cabinetPower || "").trim(),
      bandwidth: (form.bandwidth || "").trim(),
      projectScale: (form.projectScale || "").trim(),
      serviceScope: (form.serviceScope || "").trim(),
      dcName: (form.dcName || "").trim(),
      financePurpose: (form.financePurpose || "").trim(),
      financeScale: (form.financeScale || "").trim(),
      financeMode: (form.financeMode || "").trim(),
      description: desc
    })
  },

  validateQuickPublishContact(form) {
    const data = require("../../utils/data")
    return data.validatePublishContactFields(form, {
      isProxyMode: this.data.isProxyMode,
      needCompany: this.data.needCompany
    })
  },

  validateQuickResource(form) {
    const data = require("../../utils/data")
    if (!(form.title || "").trim() && !(this.data.isServerForm && (form.serverProduct || "").trim()) && !(this.data.isPartsForm && (form.serverProduct || "").trim())) {
      return this.data.isServerForm ? "请填写标题或产品" : (this.data.isPartsForm ? "请填写标题或配件名称" : "请填写资源标题")
    }
    if (!form.listingType) {
      return "请选择资源类型"
    }
    if (this.data.isServerForm) {
      if (!(form.serverProduct || "").trim() && !(form.title || "").trim()) {
        return "请填写产品或标题"
      }
      if (!(form.configSpec || "").trim()) {
        return "请填写规格"
      }
      if (!(form.scale || "").trim()) {
        return "请填写数量"
      }
      if (!(form.price || "").trim()) {
        return "请填写报价"
      }
      if (!(form.deliveryKind || "").trim()) {
        return "请选择交期类型（现货/准现货/期货）"
      }
    } else if (this.data.isPartsForm) {
      if (!(form.serverProduct || "").trim() && !(form.title || "").trim()) {
        return "请填写配件名称或标题"
      }
      if (!(form.specModel || "").trim()) {
        return "请填写规格型号"
      }
      if (!(form.scale || "").trim()) {
        return "请填写数量"
      }
      if (!(form.price || "").trim()) {
        return "请填写报价"
      }
      if (!(form.deliveryTime || "").trim()) {
        return "请填写交期"
      }
    } else {
      if (!(form.scale || "").trim()) {
        return "请填写资源规模"
      }
      if (!(form.price || "").trim()) {
        return "请填写价格说明"
      }
    }
    return this.validateQuickPublishContact(form)
  },

  validateQuickDemand(form) {
    const data = require("../../utils/data")
    if (!(form.title || "").trim() && !(this.data.isServerForm && (form.serverProduct || "").trim()) && !(this.data.isPartsForm && (form.serverProduct || "").trim())) {
      return this.data.isServerForm ? "请填写标题或产品" : (this.data.isPartsForm ? "请填写标题或配件名称" : "请填写需求标题")
    }
    if (!form.listingType) {
      return "请选择需求类型"
    }
    if (this.data.isServerForm) {
      if (!(form.serverProduct || "").trim() && !(form.title || "").trim()) {
        return "请填写产品或标题"
      }
      if (!(form.configSpec || "").trim()) {
        return "请填写规格"
      }
      if (!(form.scale || "").trim()) {
        return "请填写数量"
      }
      if (!(form.budget || "").trim()) {
        return "请填写预算"
      }
      if (!(form.deliveryKind || "").trim()) {
        return "请选择交期类型（现货/准现货/期货）"
      }
    } else if (this.data.isPartsForm) {
      if (!(form.serverProduct || "").trim() && !(form.title || "").trim()) {
        return "请填写配件名称或标题"
      }
      if (!(form.specModel || "").trim()) {
        return "请填写规格型号"
      }
      if (!(form.scale || "").trim()) {
        return "请填写数量"
      }
      if (!(form.budget || "").trim()) {
        return "请填写预算"
      }
      if (this.data.isProxyMode) {
        if (!(form.deliveryTime || "").trim()) {
          return "请填写交期"
        }
      } else if (!(form.procurementRegion || "").trim()) {
        return "请填写收货地点"
      }
    } else {
      if (!(form.scale || "").trim()) {
        return "请填写需求规模"
      }
      if (!(form.budget || "").trim()) {
        return "请填写预算"
      }
    }
    if (this.data.isProxyMode && !this.data.isServerForm && !this.data.isPartsForm && !this.data.isDcOpForm && !this.data.isFinanceForm && !this.data.isComprehensiveForm && !(form.deliveryTime || "").trim()) {
      return "请填写交期"
    }
    return this.validateQuickPublishContact(form)
  },

  validatePublishForm(form) {
    if (this.data.isQuickDemand) {
      return this.validateQuickDemand(form)
    }
    if (this.data.isQuickResource) {
      return this.validateQuickResource(form)
    }
    return ""
  },

  prepareConnectSubmitForm(form) {
    const data = require("../../utils/data")
    var next = Object.assign({}, form)
    var side = this.data.isResourceConnect ? "supply" : "demand"
    if (!next.role || !data.isValidEnterpriseRole(next.role)) {
      next.role = data.getEnterpriseRoleDefault(side)
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

  goCertAction() {
    const data = require("../../utils/data")
    var redirect = this.buildSubmitRedirect(this.pageOptions || { type: this.data.type })
    if (this.data.certPending) {
      var pendingCert = data.getPendingCertSubmission() || data.getLatestCertSubmission()
      if (pendingCert && pendingCert.id) {
        wx.navigateTo({ url: data.getCertifyRecordUrl(pendingCert.id) })
        return
      }
      wx.navigateTo({ url: "/pages/cert-records/cert-records" })
      return
    }
    wx.navigateTo({ url: data.getCertifyPageUrl(redirect) })
  },

  submitForm() {
    if (this.data.submitLocked) {
      return
    }
    const data = require("../../utils/data")
    if (this.data.needsLogin) {
      var loginRedirect = this.buildSubmitRedirect(this.pageOptions || { type: this.data.type })
      data.promptRegistration({ redirect: loginRedirect })
      return
    }
    if (this.data.isConnectForm && !this.data.isProxyConnectMode) {
      var connectRedirect = this.buildSubmitRedirect(this.pageOptions || { type: this.data.type })
      if (!data.ensureConnectAccess({ redirect: connectRedirect })) {
        return
      }
    } else if (this.data.needsCardCert) {
      this.goCertAction()
      return
    }
    var form = Object.assign({}, this.data.form)
    if (this.data.isPublishForm && (this.data.isQuickDemand || this.data.isQuickResource)) {
      const publishError = this.validatePublishForm(form)
      if (publishError) {
        wx.showToast({ title: publishError, icon: "none" })
        return
      }
    }
    if (this.data.isQuickDemand) {
      form = this.buildQuickDemandForm(form)
    } else if (this.data.isQuickResource) {
      form = this.buildQuickResourceForm(form)
    } else if (this.data.isConnectForm) {
      form = this.prepareConnectSubmitForm(form)
    }
    const company = (form.company || "").trim()
    const role = form.role
    const region = form.region
    const contact = (form.contact || "").trim()
    const phone = (form.phone || "").trim()
    const description = (form.description || "").trim()

    if (this.data.isProxyMode) {
      if (!company || !contact) {
        wx.showToast({ title: "请填写客户企业与联系人", icon: "none" })
        return
      }
    } else if (this.data.isConnectForm) {
      if (!company || !contact || !phone) {
        wx.showToast({ title: "请填写企业名称、联系人和手机号", icon: "none" })
        return
      }
    } else if (!this.data.isQuickDemand && !this.data.isQuickResource) {
      const contactError = data.validatePublishContactFields(form, {
        isProxyMode: false,
        needCompany: this.data.needCompany
      })
      if (contactError) {
        wx.showToast({ title: contactError, icon: "none" })
        return
      }
    }

    if (this.data.isPublishForm && !this.data.isQuickDemand && !this.data.isQuickResource) {
      const publishError = this.validatePublishForm(form)
      if (publishError) {
        wx.showToast({ title: publishError, icon: "none" })
        return
      }
    } else if (this.data.isConnectForm) {
      if (this.data.isResourceConnect) {
        if (this.data.connectUseResource && !this.data.selectedResourceId) {
          wx.showToast({ title: "请选择你的资源", icon: "none" })
          return
        }
        if (!this.data.connectUseResource && !description) {
          wx.showToast({ title: "请填写匹配说明", icon: "none" })
          return
        }
      } else if (this.data.connectUseDemand && !this.data.selectedDemandId) {
        wx.showToast({ title: "请选择你的需求", icon: "none" })
        return
      } else if (!this.data.connectUseDemand && !description) {
        wx.showToast({ title: "请填写对接说明", icon: "none" })
        return
      }
    } else if (!this.data.isPublishForm && !description) {
      wx.showToast({ title: "请补充说明内容", icon: "none" })
      return
    }

    if (this.data.isConnectForm) {
      const connectData = require("../../utils/data")
      if (!this.data.isProxyConnectMode && !connectData.canApplyConnectToListing(this.data.targetId)) {
        wx.showToast({ title: "不能对接自己发布的内容", icon: "none" })
        return
      }
    }

    if (phone && !/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: "请输入正确手机号", icon: "none" })
      return
    }

    var runSubmit = function() {
    try {
      this.setData({ submitLocked: true })
      wx.showLoading({ title: "提交中", mask: true })
      var submitPromise
      if (this.data.isProxyConnectMode) {
        submitPromise = data.createStaffProxyMatchConnects(this.data.proxySourceResourceId, [this.data.targetId], {
          description: (form.description || "").trim()
        })
          .then(function(result) {
            if (!result || !result.created || !result.created.length) {
              var failMsg = (result && result.failed && result.failed[0] && result.failed[0].message)
                || (result && result.skipped && result.skipped.length ? "该需求已有进行中的对接" : "提交失败")
              throw new Error(failMsg)
            }
            var connectId = result.created[0].connectId
            return { record: data.getSubmission(connectId) }
          })
      } else if (this.data.isProxyMode) {
        var payload = {
          type: this.data.type,
          company: company,
          role: role,
          region: region,
          contact: contact,
          phone: phone,
          financePurpose: (form.financePurpose || "").trim(),
      financeScale: (form.financeScale || "").trim(),
      financeMode: (form.financeMode || "").trim(),
      description: description,
          title: form.title,
          listingType: form.listingType,
          scale: form.scale,
          budget: form.budget,
          price: form.price,
          delivery: form.delivery,
          startTime: form.startTime,
          deliveryTime: form.deliveryTime,
          configSpec: (form.configSpec || "").trim(),
          procurementRegion: (form.procurementRegion || "").trim(),
          serverBrand: form.serverBrand,
          warranty: form.warranty,
          serverProduct: form.serverProduct,
          serverPayment: form.serverPayment,
          serverProcess: form.serverProcess,
          specModel: form.specModel,
          cycle: form.cycle,
          networkSpec: form.networkSpec,
          idcName: form.idcName,
          idcLevel: form.idcLevel,
          cabinetPower: form.cabinetPower,
          bandwidth: form.bandwidth,
          projectScale: form.projectScale,
          serviceScope: form.serviceScope,
          dcName: form.dcName,
          attachments: this.data.attachments,
          publicDisplay: this.data.form.publicDisplay !== false
        }
        submitPromise = data.createProxySubmissionFlowAsync(payload, this.data.type, form, {
          clientPhone: phone,
          staffProfile: data.getUserProfile()
        })
      } else {
        submitPromise = data.saveUserProfile({
          company: company,
          role: role,
          region: region,
          contact: contact,
          phone: phone
        }).then(function() {
        var payload = {
          type: this.data.type,
          targetId: this.data.targetId,
          targetTitle: this.data.targetTitle,
          company: company,
          role: role,
          region: region,
          contact: contact,
          phone: phone,
          financePurpose: (form.financePurpose || "").trim(),
      financeScale: (form.financeScale || "").trim(),
      financeMode: (form.financeMode || "").trim(),
      description: description,
          title: form.title,
          listingType: form.listingType,
          scale: form.scale,
          budget: form.budget,
          price: form.price,
          delivery: form.delivery,
          startTime: form.startTime,
          deliveryTime: form.deliveryTime,
          configSpec: (form.configSpec || "").trim(),
          procurementRegion: (form.procurementRegion || "").trim(),
          serverBrand: form.serverBrand,
          warranty: form.warranty,
          serverProduct: form.serverProduct,
          serverPayment: form.serverPayment,
          serverProcess: form.serverProcess,
          specModel: form.specModel,
          cycle: form.cycle,
          networkSpec: form.networkSpec,
          idcName: form.idcName,
          idcLevel: form.idcLevel,
          cabinetPower: form.cabinetPower,
          bandwidth: form.bandwidth,
          projectScale: form.projectScale,
          serviceScope: form.serviceScope,
          dcName: form.dcName,
          attachments: this.data.attachments,
          publicDisplay: this.data.form.publicDisplay !== false
        }
        if (this.data.isConnectForm) {
          if (this.data.isResourceConnect) {
            payload.connectDirection = "resource_to_demand"
            payload.targetType = "demand"
            payload.sourceListingId = this.data.connectUseResource ? this.data.selectedResourceId : ""
            payload.sourceTitle = this.data.connectUseResource ? this.data.selectedResourceTitle : ""
            payload.title = "资源匹配需求：" + (this.data.targetTitle || "")
          } else {
            payload.connectDirection = "demand_to_resource"
            payload.targetType = "resource"
            payload.sourceListingId = this.data.connectUseDemand ? this.data.selectedDemandId : ""
            payload.sourceTitle = this.data.connectUseDemand ? this.data.selectedDemandTitle : ""
            payload.title = "需求对接资源：" + (this.data.targetTitle || "")
          }
        }
        return data.createSubmissionFlowAsync(payload, this.data.type, form)
      }.bind(this))
      }
      submitPromise.then(function(result) {
        wx.hideLoading()
        this.setData({ submitDone: true })
        var record = result.record
        var listing = result.listing
        wx.showToast({
          title: listing
            ? (this.data.isProxyMode
              ? (require("../../utils/config").autoApproveListing !== false
                ? "代发成功"
                : "代发成功，待平台审核")
              : (require("../../utils/config").autoApproveListing !== false
                ? "发布成功"
                : "已提交，待平台审核"))
            : (this.data.isConnectForm
              ? (this.data.isProxyConnectMode
                ? "已提交，等待需求方确认"
                : (record && record.status === "待平台审核"
                  ? "已提交，等待平台审批对接"
                  : (this.data.isResourceConnect ? "已发送，等待需求方确认" : "已发送，等待资源方确认")))
              : "提交成功"),
          icon: "success"
        })
        setTimeout(function() {
          if (this.data.isProxyConnectMode && record && record.id) {
            wx.redirectTo({
              url: "/pages/record/record?id=" + record.id,
              fail: function() {
                wx.navigateTo({ url: "/pages/record/record?id=" + record.id })
              }
            })
            return
          }
          if (listing && this.data.isProxyMode) {
            var app = getApp()
            if (app.globalData) {
              app.globalData.opsProxyNeedsRefresh = true
            }
            wx.redirectTo({
              url: "/pages/detail/detail?id=" + listing.id + "&from=staff-proxy&matchAnchor=" + listing.id,
              fail: function() {
                wx.navigateTo({
                  url: "/pages/detail/detail?id=" + listing.id + "&from=staff-proxy&matchAnchor=" + listing.id
                })
              }
            })
            return
          }
          if (listing && this.data.returnUrl) {
            wx.redirectTo({
              url: this.data.returnUrl,
              fail: function() {
                wx.navigateTo({
                  url: "/pages/detail/detail?id=" + listing.id
                })
              }
            })
            return
          }
          if (listing) {
            wx.redirectTo({
              url: "/pages/detail/detail?id=" + listing.id,
              fail: function() {
                wx.navigateTo({
                  url: "/pages/detail/detail?id=" + listing.id
                })
              }
            })
            return
          }
          if (this.data.isConnectForm) {
            data.clearShareIntent()
            if (!this.data.isResourceConnect && this.data.targetId) {
              data.markResourceViewed(this.data.targetId)
            }
            wx.redirectTo({
              url: "/pages/record/record?id=" + record.id,
              fail: function() {
                wx.navigateTo({ url: "/pages/record/record?id=" + record.id })
              }
            })
            return
          }
          wx.redirectTo({
            url: "/pages/record/record?id=" + record.id,
            fail: function() {
              wx.navigateTo({ url: "/pages/record/record?id=" + record.id })
            }
          })
        }, 700)
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

    if (this.data.isConnectForm) {
      data.requestConnectSubscribe().then(runSubmit).catch(runSubmit)
      return
    }
    runSubmit()
  }
})
