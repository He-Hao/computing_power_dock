Page({
  data: {
    userTab: "login",
    redirect: "",
    showGateContext: false,
    loginContextAction: "default",
    heroTitle: "欢迎回来",
    heroSub: "登录后可浏览更多资源，名片认证后可申请对接",
    phone: "",
    password: "",
    submitLoading: false,
    regContact: "",
    regPhone: "",
    regPassword: "",
    regConfirmPassword: "",
    maskedPhone: "",
    phoneVerified: false,
    phoneLoading: false,
    legalDocList: [],
    allLegalAgreed: false,
    passwordStrength: { text: "", width: 0, level: 0 },
    cloudSetupHint: "",
    useWechatPhoneAuth: false,
    allowRegister: true,
    pageReady: false,
    phoneLocked: false,
    loginAgreed: false
  },

  onLoad(options) {
    this._loadOptions = options || {}
    this.bootstrapAuthPage(this._loadOptions)
  },

  bootstrapAuthPage(options) {
    const data = require("../../utils/data")
    const config = require("../../utils/config")
    var self = this
    wx.showLoading({ title: "加载中", mask: true })
    data.resolveAuthGateFromCloud().then(function(gate) {
      wx.hideLoading()
      if (gate.registered) {
        var registeredRedirect = options.redirect ? decodeURIComponent(options.redirect) : ""
        if (registeredRedirect) {
          data.navigateToPath(registeredRedirect)
        } else {
          var shareUrl = data.resolveShareResumeUrl()
          if (shareUrl) {
            data.navigateToPath(shareUrl)
          } else {
            wx.switchTab({ url: "/pages/mine/mine" })
          }
        }
        return
      }
      self.initAuthPage(options, gate, config)
    }).catch(function() {
      wx.hideLoading()
      self.initAuthPage(options, { allowRegister: true, boundPhone: "" }, config)
    })
  },

  initAuthPage(options, gate, config) {
    const data = require("../../utils/data")
    gate = gate || {}
    var redirect = options.redirect ? decodeURIComponent(options.redirect) : ""
    var action = options.action || data.inferLoginGateActionFromRedirect(redirect)
    var showGateContext = data.shouldShowLoginGateContext({
      action: options.action || "",
      redirect: redirect
    })
    var allowRegister = gate.allowRegister !== false
    var userTab = options.tab === "register" && allowRegister ? "register" : "login"
    var profile = data.getUserProfile()
    var useWechatPhoneAuth = !!config.useWechatPhoneAuth
    var prefillPhone = options.prefillPhone ? decodeURIComponent(options.prefillPhone) : ""
    var boundPhone = gate.boundPhone || prefillPhone || (profile && profile.phone ? profile.phone : "")
    var loginPhone = boundPhone || prefillPhone || ""
    var regPhone = boundPhone || (profile && profile.phone ? profile.phone : "")
    if (!regPhone && !useWechatPhoneAuth && config.defaultManualPhone) {
      regPhone = config.defaultManualPhone
    }

    this.setData({
      userTab: userTab,
      redirect: redirect,
      showGateContext: showGateContext,
      loginContextAction: action,
      phone: loginPhone,
      password: "",
      phoneLocked: !!boundPhone,
      regContact: profile && profile.contact ? profile.contact : "",
      regPhone: regPhone,
      maskedPhone: regPhone ? data.maskPhone(regPhone) : "",
      phoneVerified: !!(boundPhone || (profile && profile.phoneVerified && profile.phone)),
      cloudSetupHint: useWechatPhoneAuth ? this.getCloudSetupHint(config) : "",
      useWechatPhoneAuth: useWechatPhoneAuth,
      allowRegister: allowRegister,
      pageReady: true
    }, function() {
      this.applyUserTabCopy(userTab, action, showGateContext)
      this.refreshLegalAgreementStatus()
    }.bind(this))
  },

  refreshLegalAgreementStatus() {
    const legalAgree = require("../../utils/legalAgree")
    this.setData({
      legalDocList: legalAgree.getAgreementSummary(),
      allLegalAgreed: legalAgree.hasAllAgreements()
    })
  },

  openLegal(event) {
    const data = require("../../utils/data")
    var type = (event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.type) || "service"
    var from = this.data.userTab === "register" ? "register" : ""
    wx.navigateTo({ url: data.buildLegalPageUrl(type, from ? { from: from } : null) })
  },

  toggleLoginAgree() {
    this.setData({ loginAgreed: !this.data.loginAgreed })
  },

  onShow() {
    if (!this.data.pageReady) {
      return
    }
    if (this.data.userTab === "register") {
      this.refreshLegalAgreementStatus()
    }
    const data = require("../../utils/data")
    if (!data.isCloudEnabled()) {
      return
    }
    var self = this
    data.resolveAuthGateFromCloud().then(function(gate) {
      if (gate.registered) {
        return
      }
      var next = {
        allowRegister: gate.allowRegister !== false
      }
      if (gate.boundPhone) {
        next.phone = gate.boundPhone
        next.phoneLocked = true
        next.password = ""
        if (!gate.allowRegister) {
          next.userTab = "login"
        }
      }
      self.setData(next)
      if (next.userTab === "register" || self.data.userTab === "register") {
        self.refreshLegalAgreementStatus()
      }
    })
  },

  getCloudSetupHint(config) {
    if (!wx.cloud) {
      return "当前微信版本过低，请升级后重试。"
    }
    return ""
  },

  applyUserTabCopy(userTab, action, showGateContext) {
    wx.setNavigationBarTitle({ title: userTab === "register" ? "注册" : "登录" })
    const data = require("../../utils/data")
    var heroCopy = data.getLoginHeroCopy(action, userTab, !!showGateContext)
    this.setData({
      heroTitle: heroCopy.heroTitle,
      heroSub: heroCopy.heroSub
    })
  },

  setUserTab(event) {
    var tab = event.currentTarget.dataset.tab
    if (!tab || tab === this.data.userTab) {
      return
    }
    if (tab === "register" && !this.data.allowRegister) {
      wx.showToast({ title: "当前微信已绑定手机号，请使用绑定号码登录", icon: "none" })
      return
    }
    this.setData({ userTab: tab }, function() {
      this.applyUserTabCopy(tab, this.data.loginContextAction, this.data.showGateContext)
      if (tab === "register") {
        this.refreshLegalAgreementStatus()
      }
    }.bind(this))
  },

  onPhoneInput(event) {
    if (this.data.phoneLocked) {
      return
    }
    var value = (event.detail && event.detail.value) || ""
    value = value.replace(/\D/g, "").slice(0, 11)
    this.setData({ phone: value })
  },

  onPasswordInput(event) {
    this.setData({
      password: (event.detail && event.detail.value) || ""
    })
  },

  onRegContactInput(event) {
    this.setData({
      regContact: ((event.detail && event.detail.value) || "").trim()
    })
  },

  onRegPhoneInput(event) {
    var value = (event.detail && event.detail.value) || ""
    value = value.replace(/\D/g, "").slice(0, 11)
    this.setData({
      regPhone: value,
      phoneVerified: false,
      maskedPhone: ""
    })
  },

  onRegPasswordInput(event) {
    const data = require("../../utils/data")
    var password = (event.detail && event.detail.value) || ""
    this.setData({
      regPassword: password,
      passwordStrength: data.getPasswordStrength(password)
    })
  },

  onRegConfirmPasswordInput(event) {
    this.setData({
      regConfirmPassword: (event.detail && event.detail.value) || ""
    })
  },

  getPhoneAuthFailMessage(errMsg) {
    if (errMsg.indexOf("no permission") > -1 || errMsg.indexOf("permission") > -1) {
      return "微信获取手机号需小程序企业认证。请在 config 中保持 useWechatPhoneAuth: false，改用手动填写手机号。"
    }
    return "授权未成功，请重试或改用手动填写手机号。"
  },

  validateRegisterForm() {
    var contact = (this.data.regContact || "").trim()
    if (!contact) {
      return { ok: false, message: "请填写您的姓名" }
    }
    var phone = (this.data.regPhone || "").trim()
    if (!/^1\d{10}$/.test(phone)) {
      return { ok: false, message: "请输入11位有效手机号" }
    }
    const userAuth = require("../../utils/userAuth")
    var pwdCheck = userAuth.validatePasswordMatch(this.data.regPassword, this.data.regConfirmPassword)
    if (!pwdCheck.ok) {
      return pwdCheck
    }
    return { ok: true, contact: contact, phone: phone }
  },

  onGetPhoneNumber(event) {
    if (!this.data.allLegalAgreed) {
      wx.showToast({ title: "请先阅读并同意全部协议与申明", icon: "none" })
      return
    }
    var detail = event.detail || {}
    var errMsg = detail.errMsg || ""
    var code = detail.code
    if (errMsg.indexOf("user deny") > -1 || errMsg.indexOf("user cancel") > -1) {
      wx.showToast({ title: "你已取消手机号授权", icon: "none" })
      return
    }
    if (!code) {
      wx.showModal({
        title: "无法使用微信授权",
        content: this.getPhoneAuthFailMessage(errMsg),
        showCancel: false
      })
      return
    }
    this.setData({ phoneLoading: true })
    const phoneAuth = require("../../utils/phoneAuth")
    const data = require("../../utils/data")
    phoneAuth.getPhoneNumber(code).then(function(phone) {
      this.setData({
        regPhone: phone,
        maskedPhone: data.maskPhone(phone),
        phoneVerified: true,
        phoneLoading: false
      })
      wx.showToast({ title: "手机号已授权", icon: "success" })
    }.bind(this)).catch(function(error) {
      this.setData({ phoneLoading: false })
      wx.showModal({
        title: "无法使用微信授权",
        content: error.message || "微信获取手机号需小程序企业认证，请改用手动填写手机号注册。",
        showCancel: false
      })
    }.bind(this))
  },

  submitRegister() {
    if (!this.data.allowRegister) {
      wx.showToast({ title: "当前微信已绑定手机号，请使用绑定号码登录", icon: "none" })
      this.setData({ userTab: "login" })
      return
    }
    if (!this.data.allLegalAgreed) {
      wx.showToast({ title: "请先阅读并同意全部协议与申明", icon: "none" })
      return
    }
    if (this.data.useWechatPhoneAuth && (!this.data.phoneVerified || !this.data.regPhone)) {
      wx.showToast({ title: "请先授权手机号", icon: "none" })
      return
    }
    var check = this.validateRegisterForm()
    if (!check.ok) {
      wx.showToast({ title: check.message, icon: "none" })
      return
    }
    this.setData({ submitLoading: true })
    const data = require("../../utils/data")
    var self = this
    const legal = require("../../utils/legalContent")
    data.registerUserAsync({
      contact: check.contact,
      phone: check.phone,
      password: self.data.regPassword,
      confirmPassword: self.data.regConfirmPassword,
      phoneVerified: true,
      disclaimerAccepted: true,
      termsAccepted: true,
      termsVersion: legal.termsVersion,
      privacyAccepted: true,
      privacyVersion: legal.privacyVersion,
      phoneSource: self.data.useWechatPhoneAuth ? "wechat" : "manual"
    }).then(function(result) {
      self.setData({ submitLoading: false })
      if (!result.ok) {
        if (result.alreadyBound) {
          wx.showToast({ title: result.message || "请直接登录", icon: "none" })
          self.setData({ userTab: "login", allowRegister: false })
          return
        }
        wx.showToast({ title: result.message || "注册失败", icon: "none" })
        return
      }
      wx.showToast({ title: "注册成功", icon: "success", duration: 1200 })
      const legalAgree = require("../../utils/legalAgree")
      legalAgree.clearAll()
      data.navigateAfterRegister(self.data.redirect)
    }).catch(function(error) {
      self.setData({ submitLoading: false })
      if (error && error.alreadyBound) {
        wx.showToast({ title: error.message || "请直接登录", icon: "none" })
        self.setData({ userTab: "login", allowRegister: false })
        return
      }
      wx.showToast({ title: (error && error.message) || "注册失败", icon: "none" })
    })
  },

  submitUserLogin() {
    if (!this.data.loginAgreed) {
      wx.showToast({ title: "请先阅读并同意用户服务协议和隐私政策", icon: "none" })
      return
    }
    var phone = (this.data.phone || "").trim()
    var password = this.data.password || ""
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: "请输入11位有效手机号", icon: "none" })
      return
    }
    if (!password) {
      wx.showToast({ title: "请输入密码", icon: "none" })
      return
    }
    this.setData({ submitLoading: true })
    const data = require("../../utils/data")
    var self = this
    data.loginUserAsync({
      phone: phone,
      password: password
    }).then(function(result) {
      self.setData({ submitLoading: false })
      if (!result.ok) {
        wx.showToast({ title: result.message || "登录失败", icon: "none" })
        return
      }
      wx.showToast({ title: "登录成功", icon: "success", duration: 1200 })
      data.navigateAfterLogin(self.data.redirect)
    }).catch(function(error) {
      self.setData({ submitLoading: false })
      wx.showToast({ title: (error && error.message) || "登录失败", icon: "none" })
    })
  }
})
