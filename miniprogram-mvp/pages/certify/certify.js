Page({
  _certifyRefreshing: false,
  _lastCertifyRefresh: 0,

  data: {
    certLevels: [],
    activeLevel: "card",
    levelConfig: null,
    currentCertLevel: "",
    canUpgrade: false,
    readOnly: false,
    isUpgradeMode: false,
    viewMode: "edit",
    statusText: "",
    fieldLocks: {},
    baseDescription: "",
    descriptionSupplement: "",
    regionOptions: [],
    roleOptions: [],
    certImages: [],
    certRecords: [],
    permissions: [],
    submitLocked: false,
    submitPending: false,
    form: {
      company: "",
      creditCode: "",
      region: "",
      role: "",
      contact: "",
      phone: "",
      email: "",
      website: "",
      description: "",
      cardImage: "",
      licenseImage: ""
    }
  },

  onLoad(options) {
    const data = require("../../utils/data")
    if (!data.isUserRegistered()) {
      wx.showModal({
        title: "请先登录",
        content: "企业认证需先登录账号。",
        confirmText: "去登录",
        cancelText: "返回",
        success: function(res) {
          if (res.confirm) {
            wx.redirectTo({
              url: data.buildLoginUrl("/pages/certify/certify")
            })
            return
          }
          wx.navigateBack({
            fail: function() {
              wx.switchTab({ url: "/pages/mine/mine" })
            }
          })
        }
      })
      return
    }
    if (data.isStaffUser()) {
      wx.showModal({
        title: "运营账号无需认证",
        content: "运营账号不能以个人身份做企业认证。请让客户使用普通账号登录后提交认证。",
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
    this.pageOptions = options || {}
    this.returnRedirect = options.redirect ? decodeURIComponent(options.redirect) : ""
    this.applyPageState(this.pageOptions)
  },

  onShow() {
    this.refreshCertifyFromCloud(false)
  },

  refreshCertifyFromCloud(force) {
    if (!this.pageOptions) {
      return Promise.resolve()
    }
    const data = require("../../utils/data")
    var applyLocal = function() {
      return data.repairProfileCertStatus().finally(function() {
        this.applyPageState(this.pageOptions)
      }.bind(this))
    }.bind(this)
    if (!data.isCloudEnabled()) {
      return applyLocal()
    }
    var now = Date.now()
    if (!force && (this._certifyRefreshing || now - this._lastCertifyRefresh < 12000)) {
      return applyLocal()
    }
    this._certifyRefreshing = true
    return data.refreshFromCloudForMine().then(function() {
      this._lastCertifyRefresh = Date.now()
      return applyLocal()
    }.bind(this)).catch(function(error) {
      console.warn("企业认证同步失败", error)
      if (force) {
        wx.showToast({ title: "同步失败，显示本地数据", icon: "none" })
      }
      return applyLocal()
    }.bind(this)).finally(function() {
      this._certifyRefreshing = false
    }.bind(this))
  },

  onPullDownRefresh() {
    this.refreshCertifyFromCloud(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },

  applyPageState(options) {
    const data = require("../../utils/data")
    const viewState = data.getCertViewState(options)
    const certSummary = viewState.certSummary
    const cert = viewState.cert
    const cardCert = viewState.cardCert
    const profile = data.getUserProfile()
    const isUpgradeMode = viewState.mode === "upgrade"
    var activeLevel = options.level === "license" ? "license" : "card"
    if (isUpgradeMode) {
      activeLevel = "license"
    } else if (cert && cert.certLevel) {
      activeLevel = cert.certLevel
    }

    var sourceCert = isUpgradeMode && cardCert ? cardCert : cert
    var currentForm = this.data.form || {}
    var form = Object.assign({}, profile || {})
    if (sourceCert) {
      form = Object.assign({}, form, {
        company: sourceCert.company || form.company,
        creditCode: sourceCert.creditCode || form.creditCode,
        region: sourceCert.region || form.region,
        role: sourceCert.role || form.role,
        contact: sourceCert.contact || form.contact,
        phone: sourceCert.phone || form.phone,
        email: sourceCert.email || form.email,
        website: sourceCert.website || form.website,
        description: sourceCert.description || form.description,
        cardImage: sourceCert.cardImage || form.cardImage,
        licenseImage: sourceCert.licenseImage || form.licenseImage
      })
    }
    if (form.region) {
      form.region = data.normalizeEnterpriseRegion(form.region)
    }
    if (form.role) {
      form.role = data.normalizeEnterpriseRole(form.role)
    }
    if (!viewState.readOnly) {
      var preserveKeys = [
        "company", "creditCode", "region", "role", "contact", "phone",
        "email", "website", "description", "cardImage", "licenseImage"
      ]
      preserveKeys.forEach(function(key) {
        if (currentForm[key]) {
          form[key] = currentForm[key]
        }
      })
    }
    var levelConfig = data.getCertLevelConfig(activeLevel)
    if (!levelConfig.requiresRegionRole) {
      form.region = ""
      form.role = ""
    }

    var certImages = []
    if (form.cardImage) {
      certImages.push({ label: "个人名片", url: form.cardImage })
    }
    if (form.licenseImage) {
      certImages.push({ label: "营业执照", url: form.licenseImage })
    }

    var submitPending = viewState.readOnly && (
      data.hasPendingCertApplication() ||
      certSummary.status === "pending"
    )

    this.setData({
      certLevels: data.getCertLevelOptions(),
      activeLevel: activeLevel,
      levelConfig: levelConfig,
      currentCertLevel: certSummary.certLevel || "",
      canUpgrade: !!certSummary.canUpgrade && viewState.mode === "view",
      readOnly: viewState.readOnly,
      isUpgradeMode: isUpgradeMode,
      viewMode: viewState.mode,
      statusText: certSummary.statusText || "",
      fieldLocks: viewState.fieldLocks || {},
      baseDescription: isUpgradeMode ? (form.description || "") : "",
      descriptionSupplement: !viewState.readOnly ? (this.data.descriptionSupplement || "") : "",
      regionOptions: data.getEnterpriseRegionOptions(),
      roleOptions: data.getEnterpriseRoleOptions(),
      certImages: certImages,
      certRecords: data.getCertifySubmissions().map(function(item) {
        return data.enrichCertifyForRecordsList(item)
      }),
      submitPending: submitPending,
      submitLocked: submitPending ? false : this.data.submitLocked,
      form: form
    })
  },

  goCertRecord(event) {
    var id = event.currentTarget.dataset.id
    if (!id) {
      return
    }
    wx.navigateTo({
      url: "/pages/cert-record/cert-record?id=" + id
    })
  },

  isFieldLocked(field) {
    if (!this.data.isUpgradeMode) {
      return false
    }
    return !!this.data.fieldLocks[field]
  },

  selectLevel(event) {
    if (this.data.readOnly || this.data.isUpgradeMode) {
      return
    }
    const level = event.currentTarget.dataset.level
    const data = require("../../utils/data")
    const levelConfig = data.getCertLevelConfig(level)
    var formPatch = {
      activeLevel: level,
      levelConfig: levelConfig
    }
    if (!levelConfig.requiresRegionRole) {
      formPatch["form.region"] = ""
      formPatch["form.role"] = ""
    }
    this.setData(formPatch)
  },

  onInput(event) {
    if (this.data.readOnly) {
      return
    }
    const field = event.currentTarget.dataset.field
    if (this.isFieldLocked(field)) {
      return
    }
    const patch = {}
    patch["form." + field] = event.detail.value
    this.setData(patch)
  },

  onDescriptionSupplement(event) {
    this.setData({
      descriptionSupplement: event.detail.value
    })
  },

  onRoleChange(event) {
    if (this.data.readOnly || this.isFieldLocked("role")) {
      return
    }
    this.setData({
      "form.role": this.data.roleOptions[event.detail.value]
    })
  },

  onRegionChange(event) {
    if (this.data.readOnly || this.isFieldLocked("region")) {
      return
    }
    this.setData({
      "form.region": this.data.regionOptions[event.detail.value]
    })
  },

  chooseCertImage() {
    if (this.data.readOnly) {
      return
    }
    const data = require("../../utils/data")
    const levelConfig = this.data.levelConfig || data.getCertLevelConfig(this.data.activeLevel)
    if (!levelConfig || !levelConfig.imageField) {
      wx.showToast({ title: "页面未就绪，请返回后重试", icon: "none" })
      return
    }
    const imageField = levelConfig.imageField
    if (this.isFieldLocked(imageField)) {
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: function(res) {
        const tempPath = res.tempFiles && res.tempFiles[0] ? res.tempFiles[0].tempFilePath : ""
        if (!tempPath) {
          return
        }
        wx.showLoading({ title: "上传中", mask: true })
        data.saveCertImage(tempPath, this.data.activeLevel).then(function(savedPath) {
          wx.hideLoading()
          const patch = {}
          patch["form." + imageField] = savedPath
          this.setData(patch)
          this.applyPageState(this.pageOptions || {})
          wx.showToast({
            title: data.isCloudEnabled() ? "已上传至云端" : "图片已选择",
            icon: "success"
          })
        }.bind(this)).catch(function(error) {
          wx.hideLoading()
          wx.showModal({
            title: "图片上传失败",
            content: error.message || "请检查云开发存储权限后重试",
            showCancel: false
          })
        })
      }.bind(this)
    })
  },

  previewCertImage(event) {
    const url = event.currentTarget.dataset.url
    const imagePath = url || (this.data.activeLevel === "license" ? this.data.form.licenseImage : this.data.form.cardImage)
    if (!imagePath) {
      return
    }
    wx.previewImage({
      current: imagePath,
      urls: [imagePath]
    })
  },

  goUpgrade() {
    wx.redirectTo({
      url: "/pages/certify/certify?level=license"
    })
  },

  submitCertify() {
    if (this.data.readOnly || this.data.submitLocked || this.data.submitPending) {
      return
    }
    const data = require("../../utils/data")
    if (data.hasPendingCertApplication({ level: this.data.activeLevel })) {
      wx.showToast({
        title: this.data.activeLevel === "license" ? "营业执照认证审核中" : "认证审核中，请查看已提交信息",
        icon: "none"
      })
      return
    }
    if (this.data.isUpgradeMode && !data.getApprovedCardCert()) {
      wx.showToast({ title: "请先完成名片认证", icon: "none" })
      return
    }
    const levelConfig = this.data.levelConfig || data.getCertLevelConfig(this.data.activeLevel)
    if (!levelConfig || !levelConfig.imageField) {
      wx.showToast({ title: "页面未就绪，请返回后重试", icon: "none" })
      return
    }
    const form = this.data.form || {}
    const imagePath = form[levelConfig.imageField]
    var description = form.description

    if (this.data.isUpgradeMode) {
      if (this.data.baseDescription) {
        description = data.mergeCertDescription(this.data.baseDescription, this.data.descriptionSupplement)
      } else {
        description = (this.data.descriptionSupplement || form.description || "").trim()
      }
    }

    if (!form.company || !form.contact || !form.phone) {
      wx.showToast({ title: "请补充完整信息", icon: "none" })
      return
    }
    if (levelConfig.requiresRegionRole) {
      if (!form.region || !form.role) {
        wx.showToast({ title: "请补充完整信息", icon: "none" })
        return
      }
    }
    if (form.region && !data.isValidEnterpriseRegion(form.region)) {
      wx.showToast({ title: "请重新选择企业所在地", icon: "none" })
      return
    }
    if (form.role && !data.isValidEnterpriseRole(form.role)) {
      wx.showToast({ title: "请重新选择企业角色", icon: "none" })
      return
    }
    if (!description) {
      wx.showToast({ title: "请填写认证说明", icon: "none" })
      return
    }
    if (levelConfig.requiresCreditCode && !form.creditCode) {
      wx.showToast({ title: "营业执照认证需填写信用代码", icon: "none" })
      return
    }
    if (!imagePath) {
      wx.showToast({ title: "请上传认证材料", icon: "none" })
      return
    }
    var imageCheck = data.validateCertImagesForSubmit(form, this.data.activeLevel)
    if (!imageCheck.ok) {
      wx.showModal({
        title: "图片未就绪",
        content: imageCheck.message,
        showCancel: false
      })
      return
    }
    if (!/^1\d{10}$/.test(form.phone)) {
      wx.showToast({ title: "请输入正确手机号", icon: "none" })
      return
    }

    wx.showModal({
      title: "确认认证材料",
      content: "请确认上传的" + levelConfig.uploadLabel.replace("上传", "") + "清晰可读，信息与企业填写一致。如需修改请返回重新上传。",
      confirmText: "确认提交",
      cancelText: "返回修改",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        this.doSubmitCertify(form, description, levelConfig, data)
      }.bind(this)
    })
  },

  doSubmitCertify(form, description, levelConfig, data) {
    this.setData({ submitLocked: true })
    wx.showLoading({ title: "提交中", mask: true })
    var profilePatch = {
      company: form.company,
      creditCode: form.creditCode,
      role: levelConfig.requiresRegionRole ? form.role : "",
      region: levelConfig.requiresRegionRole ? form.region : "",
      contact: form.contact,
      phone: form.phone,
      email: form.email,
      website: form.website,
      description: description
    }
    if (this.data.isUpgradeMode) {
      profilePatch.licenseUpgradeSubmittedAt = data.formatDate(new Date())
    } else {
      profilePatch.certStatus = "pending"
      profilePatch.certSubmittedAt = data.formatDate(new Date())
    }
    data.saveUserProfile(profilePatch).then(function() {
      return data.createSubmissionFlowAsync({
        type: "certify",
        certLevel: this.data.activeLevel,
        company: form.company,
        creditCode: form.creditCode,
        region: levelConfig.requiresRegionRole ? form.region : "",
        role: levelConfig.requiresRegionRole ? form.role : "",
        contact: form.contact,
        phone: form.phone,
        email: form.email,
        website: form.website,
        description: description,
        cardImage: form.cardImage,
        licenseImage: form.licenseImage,
        title: levelConfig.title,
        upgradedFrom: this.data.isUpgradeMode ? "card" : ""
      }, "", null)
    }.bind(this)).then(function() {
      wx.hideLoading()
      this.setData({
        submitLocked: false,
        submitPending: true,
        readOnly: true,
        statusText: "认证审核中"
      })
      wx.showToast({ title: "已提交，待审批", icon: "success" })
      setTimeout(function() {
        if (this.returnRedirect) {
          data.navigateToPath(this.returnRedirect)
          return
        }
        var shareUrl = data.resolveShareResumeUrl()
        if (shareUrl) {
          data.navigateToPath(shareUrl)
          return
        }
        wx.switchTab({ url: "/pages/mine/mine" })
      }.bind(this), 1200)
    }).catch(function(error) {
      wx.hideLoading()
      this.setData({ submitLocked: false })
      var message = error && error.message ? error.message : "提交失败，请重试"
      if (message.indexOf("Cannot read properties of undefined") > -1) {
        message = "提交异常，请确认已登录且云函数 tradeApi 已重新部署"
      }
      var localPending = data.hasPendingCertApplication({ level: this.data.activeLevel })
      if (localPending) {
        this.setData({
          submitPending: true,
          readOnly: true,
          statusText: "认证审核中"
        })
        wx.showToast({ title: "已提交，待审批", icon: "success" })
        return
      }
      wx.showToast({ title: message, icon: "none", duration: 3000 })
    }.bind(this))
  }
})
