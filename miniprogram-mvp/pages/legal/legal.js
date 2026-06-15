Page({
  _readTimer: null,
  _timerStarted: false,
  _scrollBoxHeight: 0,
  _readSeconds: 6,

  data: {
    docType: "",
    title: "",
    updateDate: "",
    sections: [],
    numbered: false,
    agreeLabel: "",
    requireAgree: false,
    readStarted: false,
    scrolledToBottom: false,
    countdownDone: false,
    readReady: false,
    readSecondsLeft: 6,
    readStatusHint: "",
    agreed: false,
    alreadyAgreed: false
  },

  onLoad(options) {
    var type = (options && options.type) || "service"
    var fromRegister = (options && options.from) === "register"
    var requireAgree = fromRegister
    var legal = require("../../utils/legalContent")
    var legalAgree = require("../../utils/legalAgree")
    var doc = legal.getLegalDocument(type)
    var list = legal.getLegalDocumentList()
    var label = ""
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].type === type) {
        label = list[i].label
        break
      }
    }
    var already = requireAgree && legalAgree.isAgreed(type)
    this._readSeconds = legalAgree.getReadSeconds()
    this.setData({
      docType: type,
      title: doc.title,
      updateDate: doc.updateDate || "",
      sections: doc.sections || [],
      numbered: !!doc.numbered,
      agreeLabel: "我已阅读并同意" + label,
      requireAgree: requireAgree,
      alreadyAgreed: already,
      agreed: already,
      readStarted: already,
      scrolledToBottom: already,
      countdownDone: already,
      readReady: already,
      readSecondsLeft: already ? 0 : this._readSeconds,
      readStatusHint: requireAgree && !already ? this.buildReadStatusHint({
        readStarted: false,
        scrolledToBottom: false,
        countdownDone: false,
        readSecondsLeft: this._readSeconds
      }) : ""
    })
    wx.setNavigationBarTitle({ title: doc.title })
  },

  onReady() {
    if (this.data.requireAgree && !this.data.alreadyAgreed) {
      wx.nextTick(function() {
        this.ensureReadingStarted()
      }.bind(this))
    }
  },

  onUnload() {
    this.clearReadTimer()
  },

  onHide() {
    this.clearReadTimer()
  },

  clearReadTimer() {
    if (this._readTimer) {
      clearInterval(this._readTimer)
      this._readTimer = null
    }
  },

  buildReadStatusHint(state) {
    state = state || this.data
    if (!state.readStarted) {
      return "请点击正文区域开始阅读"
    }
    if (!state.scrolledToBottom) {
      return "请阅读至页面底部"
    }
    if (!state.countdownDone) {
      return "请继续阅读 " + state.readSecondsLeft + " 秒"
    }
    return ""
  },

  getReadBlockMessage(state) {
    state = state || this.data
    if (!state.readStarted) {
      return "请先开始阅读"
    }
    if (!state.scrolledToBottom) {
      return "请阅读至页面底部"
    }
    if (!state.countdownDone) {
      return "请继续阅读 " + state.readSecondsLeft + " 秒"
    }
    return "请先勾选同意"
  },

  applyReadState(patch) {
    patch = patch || {}
    var next = {
      readStarted: patch.readStarted != null ? patch.readStarted : this.data.readStarted,
      scrolledToBottom: patch.scrolledToBottom != null ? patch.scrolledToBottom : this.data.scrolledToBottom,
      countdownDone: patch.countdownDone != null ? patch.countdownDone : this.data.countdownDone,
      readSecondsLeft: patch.readSecondsLeft != null ? patch.readSecondsLeft : this.data.readSecondsLeft,
      agreed: patch.agreed != null ? patch.agreed : this.data.agreed
    }
    next.readReady = !!(next.scrolledToBottom && next.countdownDone)
    next.readStatusHint = this.buildReadStatusHint(next)
    if (!next.readReady && !this.data.alreadyAgreed) {
      next.agreed = false
    }
    this.setData(next)
  },

  ensureReadingStarted() {
    if (!this.data.requireAgree || this.data.alreadyAgreed || this._timerStarted) {
      return
    }
    this._timerStarted = true
    this.applyReadState({
      readStarted: true,
      scrolledToBottom: false,
      countdownDone: false,
      readSecondsLeft: this._readSeconds,
      agreed: false
    })
    this.startCountdown()
    wx.nextTick(function() {
      this.measureScroll()
    }.bind(this))
  },

  measureScroll() {
    var self = this
    wx.createSelectorQuery().in(this).select(".legal-doc-scroll-page").boundingClientRect(function(box) {
      if (!box) {
        return
      }
      self._scrollBoxHeight = box.height || 0
      wx.createSelectorQuery().in(self).select(".legal-doc-scroll-inner").boundingClientRect(function(inner) {
        if (!inner || !box) {
          return
        }
        if (inner.height <= box.height + 2) {
          self.applyReadState({ scrolledToBottom: true })
        }
      }).exec()
    }).exec()
  },

  startCountdown() {
    var self = this
    self.clearReadTimer()
    self._readTimer = setInterval(function() {
      var left = self.data.readSecondsLeft - 1
      if (left <= 0) {
        self.clearReadTimer()
        self.applyReadState({ readSecondsLeft: 0, countdownDone: true })
        return
      }
      self.applyReadState({ readSecondsLeft: left })
    }, 1000)
  },

  onContentTap() {
    if (!this.data.requireAgree || this.data.alreadyAgreed) {
      return
    }
    this.ensureReadingStarted()
  },

  onContentScroll(event) {
    if (!this.data.requireAgree || this.data.alreadyAgreed || this.data.scrolledToBottom) {
      return
    }
    this.ensureReadingStarted()
    var detail = event.detail || {}
    var scrollTop = detail.scrollTop || 0
    var scrollHeight = detail.scrollHeight || 0
    var viewHeight = this._scrollBoxHeight || 0
    if (viewHeight > 0 && scrollTop + viewHeight >= scrollHeight - 24) {
      this.applyReadState({ scrolledToBottom: true })
    }
  },

  onScrollToLower() {
    if (!this.data.requireAgree || this.data.alreadyAgreed) {
      return
    }
    this.ensureReadingStarted()
    if (!this.data.scrolledToBottom) {
      this.applyReadState({ scrolledToBottom: true })
    }
  },

  toggleAgree() {
    if (!this.data.requireAgree) {
      return
    }
    if (!this.data.readReady && !this.data.agreed) {
      wx.showToast({ title: this.getReadBlockMessage(), icon: "none" })
      return
    }
    var nextAgreed = !this.data.agreed
    var legalAgree = require("../../utils/legalAgree")
    if (nextAgreed) {
      legalAgree.setAgreed(this.data.docType)
      this.setData({ agreed: true, alreadyAgreed: true })
      wx.showToast({ title: "已同意", icon: "success", duration: 1200 })
      return
    }
    legalAgree.clearAgreed(this.data.docType)
    this.setData({ agreed: false, alreadyAgreed: false })
  },

  goBack() {
    wx.navigateBack({
      fail: function() {
        wx.switchTab({ url: "/pages/mine/mine" })
      }
    })
  }
})
