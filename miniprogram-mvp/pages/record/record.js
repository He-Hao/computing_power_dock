Page({

  _recordRefreshing: false,
  _lastRecordRefresh: 0,
  _recordId: "",

  data: {

    record: null,

    connectParties: [],

    connectActions: null,
    isResourceConnect: false,

    disclosedContacts: null,
    disclosedPartyViews: null,
    connectRiskNotice: null,
    connectNextSteps: null,
    rejectionResubmitGuide: null,

    flowTimeline: [],

    showFixedBar: false,

    listingPublishTip: "",

    listingButtonText: "预览提交内容",

    showListingButton: false,

    canTogglePublicDisplay: false,
    listingPublicDisplay: true,
    publicDisplayLoading: false,

    detailRows: [],

    attachments: [],

    canEditAttachments: false,

    maxAttachments: 5,

    linkedConnects: [],

    linkedConnectPending: 0,

    scrollToConnects: false,

    actionLoading: "",

    typeNames: {

      demand: "需求提交",

      resource: "资源发布",

      server: "整机需求",

      room: "机房项目",

      match: "人工撮合",

      connect: "对接申请",

      certify: "企业认证"

    }

  },



  onLoad(options) {

    this.scrollToConnects = !!(options && options.section === "connects")
    this._recordId = options.id || ""
    this.loadRecord(options.id)

  },

  formatConnectActionError(message) {
    var text = String(message || "操作失败，请稍后重试").trim()
    if (!text) {
      text = "操作失败，请稍后重试"
    }
    if (text.indexOf("未知操作") > -1
      || text.indexOf("FUNCTION_NOT_FOUND") > -1
      || text.indexOf("部署 tradeApi") > -1) {
      text += "\n\n请在微信开发者工具中右键 cloudfunctions/tradeApi →「上传并部署：云端安装依赖」，然后重新编译小程序。"
    }
    return text
  },

  showConnectActionError(message, title) {
    wx.showModal({
      title: title || "无法完成操作",
      content: this.formatConnectActionError(message),
      showCancel: false,
      confirmText: "知道了"
    })
  },

  getDisclosedPartyBySide(side) {
    var views = this.data.disclosedPartyViews
    if (!views || !side) {
      return null
    }
    return views[side] || null
  },

  buildContactCopyText(party) {
    if (!party) {
      return ""
    }
    var lines = []
    if (party.company) {
      lines.push("企业：" + party.company)
    }
    if (party.contact) {
      lines.push("联系人：" + party.contact)
    }
    if (party.phone) {
      lines.push("手机：" + party.phone)
    }
    return lines.join("\n")
  },

  copyToClipboard(text, emptyTip) {
    const copyText = require("../../utils/copyText")
    copyText.copyTextToClipboard(text, {
      emptyTip: emptyTip || "无内容可复制",
      successTip: "已复制"
    })
  },

  copyTradeId(event) {
    const copyText = require("../../utils/copyText")
    var text = event.currentTarget.dataset.text || ""
    copyText.copyTextToClipboard(text, {
      emptyTip: "暂无编号",
      successTip: "编号已复制"
    })
  },

  copyContactInfo(event) {
    var side = event.currentTarget.dataset.side
    var party = this.getDisclosedPartyBySide(side)
    this.copyToClipboard(this.buildContactCopyText(party), "暂无联系方式")
  },

  copyContactPhone(event) {
    var side = event.currentTarget.dataset.side
    var party = this.getDisclosedPartyBySide(side)
    this.copyToClipboard(party && party.phone, "暂无手机号")
  },

  onConnectNextStep(event) {
    const data = require("../../utils/data")
    var action = event.currentTarget.dataset.action
    var phone = event.currentTarget.dataset.phone || ""
    if (action === "call" && phone) {
      wx.makePhoneCall({ phoneNumber: String(phone) })
      return
    }
    if (action === "copyAll") {
      var views = this.data.disclosedPartyViews
      if (!views) {
        return
      }
      var lines = []
      if (views.demand) {
        lines.push("【需求方】")
        lines.push(this.buildContactCopyText(views.demand))
      }
      if (views.resource) {
        lines.push("【资源方】")
        lines.push(this.buildContactCopyText(views.resource))
      }
      this.copyToClipboard(lines.join("\n\n"), "暂无联系方式")
      return
    }
    if (action === "records") {
      wx.navigateTo({ url: "/pages/records/records?filter=connect" })
    }
  },

  onRejectionResubmit() {
    const data = require("../../utils/data")
    var guide = this.data.rejectionResubmitGuide
    if (!guide || !guide.action) {
      return
    }
    if (guide.action === "certify") {
      wx.navigateTo({ url: data.getCertifyPageUrl() })
      return
    }
    if (guide.action === "submitResource") {
      if (!data.ensureSubmitListingAccess("resource", { redirect: "/pages/submit/submit?type=resource" })) {
        return
      }
      wx.navigateTo({ url: "/pages/submit/submit?type=resource" })
      return
    }
    if (guide.action === "submitDemand") {
      var record = this.data.record
      var type = record && record.type === "server" ? "server" : (record && record.type === "room" ? "room" : "demand")
      var url = "/pages/submit/submit?type=" + type
      if (!data.ensureSubmitListingAccess(type, { redirect: url })) {
        return
      }
      wx.navigateTo({ url: url })
    }
  },



  onShow() {
    const data = require("../../utils/data")
    var id = this._recordId || (this.data.record && this.data.record.id)
    if (id) {
      this.loadRecord(id)
    }
    if (!data.isCloudEnabled() || !id) {
      return
    }
    var now = Date.now()
    if (this._recordRefreshing || now - this._lastRecordRefresh < 8000) {
      return
    }
    this._recordRefreshing = true
    var reload = function() {
      this.loadRecord(id)
    }.bind(this)
    data.refreshFromCloudForMine().then(function() {
      this._lastRecordRefresh = Date.now()
      reload()
    }.bind(this)).catch(reload).finally(function() {
      this._recordRefreshing = false
    }.bind(this))
  },

  refreshRecordFromCloud(force) {
    const data = require("../../utils/data")
    var id = this._recordId || (this.data.record && this.data.record.id)
    if (!id) {
      return Promise.resolve()
    }
    this.loadRecord(id)
    if (!data.isCloudEnabled()) {
      return Promise.resolve()
    }
    if (!force && this._recordRefreshing) {
      return Promise.resolve()
    }
    this._recordRefreshing = true
    return data.refreshFromCloudForMine().then(function() {
      this._lastRecordRefresh = Date.now()
      this.loadRecord(id)
    }.bind(this)).catch(function() {
      this.loadRecord(id)
    }.bind(this)).finally(function() {
      this._recordRefreshing = false
    }.bind(this))
  },

  onPullDownRefresh() {
    this.refreshRecordFromCloud(true).finally(function() {
      wx.stopPullDownRefresh()
    })
  },



  loadRecord(id) {

    try {

      const data = require("../../utils/data")

      const record = data.getSubmission(id)

      if (!record) {
        this.setData({
          record: null,
          recordTitle: "",
          statusHint: "",
          timeline: [],
          attachments: [],
          canEditAttachments: false
        })
        wx.showToast({ title: "记录不存在", icon: "none" })
        return
      }

      var profile = data.getUserProfile()
      if (!data.canViewSubmissionRecord(record, profile)) {
        this.setData({ record: null })
        wx.showToast({ title: "无权查看该记录", icon: "none" })
        return
      }

      data.markRejectionNoticeRead(record)

      if (record.type === "certify") {
        wx.redirectTo({
          url: "/pages/cert-record/cert-record?id=" + id
        })
        return
      }



      var certLevelName = ""
      var certImages = []

      var connectParties = record.type === "connect"
        ? data.buildConnectPartiesForView(record, { viewerPhone: profile ? profile.phone : "" })
        : []

      var connectActions = record.type === "connect" && profile ? data.getConnectRecordActions(record, profile.phone) : null

      var isResourceConnect = record.type === "connect" && data.isResourceToDemandConnect(record)

      var viewerPhone = profile ? profile.phone : ""
      var disclosedPartyViews = record.type === "connect"
        ? data.getConnectDisclosedPartyViews(record, viewerPhone)
        : null
      var disclosedContacts = disclosedPartyViews ? record.disclosedContacts : null
      var flowTimeline = data.getRecordPublishTimeline(record, viewerPhone)

      var detailRows = data.getRecordDetailRows(Object.assign({}, record, {
        certLevelName: certLevelName
      }))

      var displayStatus = data.getSubmissionDisplayStatus(record)

      if (record.type === "connect") {
        wx.setNavigationBarTitle({
          title: record.disclosedContacts ? "对接成功" : "对接记录"
        })
      }

      var canEditAttachments = data.canEditSubmissionAttachments(record)
      var linkedStats = record.listingId && (record.type === "resource" || data.isDemandSubmitType(record.type))
        ? data.getListingLinkedConnectStats(record.listingId)
        : { count: 0, pending: 0, connects: [] }
      var applyRecordState = function(attachments) {
        this.setData({
        record: Object.assign({}, data.enrichSubmissionForRecordsList(record, this.data.typeNames), {

          displayStatus: displayStatus,

          certLevelName: certLevelName,

          certImages: certImages,

          statusHint: record.type === "connect"
            ? data.getConnectDisplayHint(record, viewerPhone)
            : data.getSubmissionDisplayHint(record),

          statusTimeline: record.statusTimeline || [

            {

              status: record.status,

              time: record.createdAt,

              hint: record.type === "connect"
                ? data.getConnectDisplayHint(record, viewerPhone)
                : data.getSubmissionDisplayHint(record)

            }

          ]

        }),

        connectParties: connectParties,

        connectActions: connectActions,

        isResourceConnect: isResourceConnect,

        disclosedContacts: disclosedContacts,
        disclosedPartyViews: disclosedPartyViews,
        connectRiskNotice: disclosedPartyViews ? data.getConnectSuccessRiskNotice() : null,
        connectNextSteps: disclosedPartyViews
          ? data.getConnectSuccessNextSteps(record, disclosedPartyViews, viewerPhone)
          : null,
        rejectionResubmitGuide: data.getSubmissionRejectionResubmitGuide(record),

        flowTimeline: flowTimeline,

        detailRows: detailRows,

        showFixedBar: !!(connectActions && (connectActions.canConfirm || connectActions.canExchange || connectActions.canCancel || connectActions.canReapply || connectActions.canReview)),

        listingPublishTip: data.getListingPublishTip(record),

        listingButtonText: data.getListingPreviewButtonText(record),

        showListingButton: data.shouldShowListingButton(record),

        canTogglePublicDisplay: record.listingId
          && (record.type === "resource" || data.isDemandSubmitType(record.type))
          && data.canToggleListingPublicDisplay(record.listingId),
        listingPublicDisplay: record.publicDisplay !== false
          && (!record.listingId || !data.getItem(record.listingId) || data.getItem(record.listingId).publicDisplay !== false),

        attachments: attachments || [],

        canEditAttachments: canEditAttachments,

        maxAttachments: data.MAX_SUBMISSION_ATTACHMENTS,

        linkedConnects: linkedStats.connects,

        linkedConnectPending: linkedStats.pending

      })
      if (this.scrollToConnects && linkedStats.count > 0) {
        this.scrollToConnects = false
        wx.nextTick(function() {
          wx.pageScrollTo({ selector: "#linked-connects", duration: 300 })
        })
      }
      data.updateMineTabBadge()
      }.bind(this)

      data.resolveSubmissionAttachments(record.attachments || []).then(applyRecordState).catch(function() {
        applyRecordState(record.attachments || [])
      })

    } catch (error) {

      wx.showToast({ title: "记录加载失败", icon: "none" })

    }

  },



  goListing() {
    if (!this.data.record || !this.data.record.listingId) {
      return
    }
    wx.navigateTo({
      url: "/pages/detail/detail?id=" + this.data.record.listingId
    })
  },

  onPublicDisplayChange(event) {
    if (this.data.publicDisplayLoading || !this.data.canTogglePublicDisplay) {
      return
    }
    const data = require("../../utils/data")
    const record = this.data.record
    if (!record || !record.listingId) {
      return
    }
    const enabled = !!event.detail.value
    const poolLabel = record.type === "resource" ? "资源池" : "需求池"
    const content = enabled
      ? "开启后，他人可在" + poolLabel + "脱敏查看并申请对接。"
      : "关闭后，将不再在" + poolLabel + "展示；仅你可在提交记录中查看。"
    wx.showModal({
      title: enabled ? "开启公开展示" : "关闭公开展示",
      content: content,
      confirmText: enabled ? "确认开启" : "确认关闭",
      success: function(res) {
        if (!res.confirm) {
          this.setData({ listingPublicDisplay: !enabled })
          return
        }
        this.setData({ publicDisplayLoading: true })
        data.setListingPublicDisplay(record.listingId, enabled).then(function(result) {
          if (!result.ok) {
            this.setData({ listingPublicDisplay: !enabled })
            wx.showToast({ title: result.message || "设置失败", icon: "none" })
            return
          }
          this.loadRecord(record.id)
          wx.showToast({ title: enabled ? "已开启公开展示" : "已关闭公开展示", icon: "success" })
        }.bind(this)).catch(function(error) {
          this.setData({ listingPublicDisplay: !enabled })
          wx.showToast({ title: (error && error.message) || "设置失败", icon: "none" })
        }.bind(this)).finally(function() {
          this.setData({ publicDisplayLoading: false })
        }.bind(this))
      }.bind(this)
    })
  },

  goConnectPartyListing(event) {
    const data = require("../../utils/data")
    var listingId = event.currentTarget.dataset.id
    var record = this.data.record
    if (!listingId || !record || record.type !== "connect" || !record.id) {
      return
    }
    var url = data.buildConnectListingPreviewUrl(record.id, listingId)
    if (!url) {
      return
    }
    wx.navigateTo({ url: url })
  },



  previewCertImage(event) {

    const url = event.currentTarget.dataset.url

    if (!url) {

      return

    }

    wx.previewImage({

      current: url,

      urls: [url]

    })

  },



  confirmConnect() {
    const data = require("../../utils/data")
    const recordId = this._recordId || (this.data.record && this.data.record.id)
    if (!recordId) {
      this.showConnectActionError("未找到对接记录编号，请返回列表后重新进入。")
      return
    }
    if (!this.data.connectActions || !this.data.connectActions.canConfirm) {
      this.showConnectActionError("当前页面状态已变化，请下拉刷新后再试。")
      return
    }
    var precheck = data.getConnectConfirmPrecheck(recordId)
    if (!precheck.ok) {
      this.showConnectActionError(precheck.message, "暂时无法同意")
      return
    }
    var runConfirm = function() {
      this.setData({ actionLoading: "confirm" })
      data.confirmConnectByRecipient(recordId).then(function(result) {
        if (!result || !result.ok) {
          this.showConnectActionError((result && result.message) || "确认失败", "同意失败")
          return
        }
        wx.showToast({ title: "已发起交换名片", icon: "success" })
        this.loadRecord(recordId)
        if (data.isCloudEnabled()) {
          this.refreshRecordFromCloud(true)
        }
      }.bind(this)).catch(function(error) {
        this.showConnectActionError(error.message || "操作失败", "同意失败")
      }.bind(this)).finally(function() {
        this.setData({ actionLoading: "" })
      }.bind(this))
    }.bind(this)
    wx.showModal({
      title: "同意并发起交换名片",
      content: "确认后将同时向对方发起交换名片，等待申请方确认。",
      confirmText: "确认",
      cancelText: "取消",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        data.requestConnectSubscribe().then(runConfirm).catch(runConfirm)
      }.bind(this),
      fail: function(err) {
        this.showConnectActionError((err && err.errMsg) || "无法打开确认窗口", "操作中断")
      }.bind(this)
    })
  },



  rejectConnect() {

    const data = require("../../utils/data")

    wx.showModal({

      title: "拒绝对接",

      content: "确认拒绝该对接申请？",

      confirmText: "确认拒绝",

      success: function(res) {

        if (!res.confirm) {

          return

        }

        this.setData({ actionLoading: "reject" })
        data.rejectConnectByRecipient(this.data.record.id).then(function(result) {
          if (!result.ok) {
            this.showConnectActionError(result.message, "拒绝失败")
            return
          }
          wx.showToast({ title: "已拒绝", icon: "success" })
          this.loadRecord(this.data.record.id)
          if (data.isCloudEnabled()) {
            this.refreshRecordFromCloud(true)
          }
        }.bind(this)).catch(function(error) {
          this.showConnectActionError(error.message || "操作失败", "拒绝失败")
        }.bind(this)).finally(function() {
          this.setData({ actionLoading: "" })
        }.bind(this))

      }.bind(this)

    })

  },

  cancelConnectApply() {
    const data = require("../../utils/data")
    const record = this.data.record
    if (!record || !this.data.connectActions || !this.data.connectActions.canCancel) {
      return
    }
    wx.showModal({
      title: "取消对接",
      content: "取消后本次对接申请将关闭，您可重新向该商机发起申请。",
      confirmText: "确认取消",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        this.setData({ actionLoading: "cancel" })
        data.cancelConnectByApplicant(record.id).then(function(result) {
          if (!result.ok) {
            wx.showToast({ title: result.message, icon: "none" })
            return
          }
          wx.showToast({ title: "已取消对接", icon: "success" })
          data.repairProfileCertStatus().finally(function() {
            this.loadRecord(record.id)
          }.bind(this))
        }.bind(this)).catch(function(error) {
          wx.showToast({ title: error.message || "取消失败", icon: "none" })
        }).finally(function() {
          this.setData({ actionLoading: "" })
        }.bind(this))
      }.bind(this)
    })
  },

  goAdminReviewConnect() {
    const record = this.data.record
    if (!record || !this.data.connectActions || !this.data.connectActions.canReview) {
      return
    }
    wx.navigateTo({
      url: "/pages/admin-review/admin-review?reviewType=submission&id=" + record.id
    })
  },

  continueConnectApply() {
    const data = require("../../utils/data")
    const record = this.data.record
    if (!record || !this.data.connectActions || !this.data.connectActions.canReapply) {
      return
    }
    var applyUrl = data.getConnectApplyUrl(record)
    if (!applyUrl) {
      wx.showToast({ title: "无法继续申请", icon: "none" })
      return
    }
    if (data.isActiveConnectSubmission(record)) {
      wx.showModal({
        title: "继续申请",
        content: "重新提交需要先取消当前对接申请，是否取消并继续填写？",
        confirmText: "继续",
        success: function(res) {
          if (!res.confirm) {
            return
          }
          this.setData({ actionLoading: "reapply" })
          data.cancelConnectByApplicant(record.id).then(function(result) {
            if (!result.ok) {
              wx.showToast({ title: result.message, icon: "none" })
              return
            }
            wx.navigateTo({ url: applyUrl })
          }).catch(function(error) {
            wx.showToast({ title: error.message || "操作失败", icon: "none" })
          }).finally(function() {
            this.setData({ actionLoading: "" })
          }.bind(this))
        }
      })
      return
    }
    wx.navigateTo({ url: applyUrl })
  },



  agreeExchange() {
    const data = require("../../utils/data")
    const recordId = this._recordId || (this.data.record && this.data.record.id)
    if (!recordId) {
      this.showConnectActionError("未找到对接记录编号，请返回列表后重新进入。")
      return
    }
    if (!this.data.connectActions || !this.data.connectActions.canExchange) {
      this.showConnectActionError("当前页面状态已变化，请下拉刷新后再试。")
      return
    }
    var precheck = data.getConnectExchangePrecheck(recordId)
    if (!precheck.ok) {
      this.showConnectActionError(precheck.message, "暂时无法同意")
      return
    }
    wx.showModal({
      title: "同意交换名片",
      content: "确认后双方可查看对方企业名称、联系人与手机号。",
      confirmText: "确认",
      cancelText: "取消",
      success: function(res) {
        if (!res.confirm) {
          return
        }
        this.setExchangeConsent(true)
      }.bind(this),
      fail: function(err) {
        this.showConnectActionError((err && err.errMsg) || "无法打开确认窗口", "操作中断")
      }.bind(this)
    })
  },



  declineExchange() {

    this.setExchangeConsent(false)

  },



  setExchangeConsent(agree) {
    const data = require("../../utils/data")
    var runExchange = function() {
      this.setData({ actionLoading: agree ? "agree" : "decline" })
      data.setConnectExchangeConsent(this.data.record.id, agree).then(function(result) {
        if (!result.ok) {
          this.showConnectActionError(result.message, agree ? "同意失败" : "操作失败")
          return
        }
        if (result.exchanged) {
          wx.showToast({ title: "已交换名片", icon: "success" })
        } else if (result.closed) {
          wx.showToast({ title: "对接已关闭", icon: "none" })
        } else {
          wx.showToast({ title: agree ? "已同意，等待对方" : "已关闭", icon: "success" })
        }
        var reload = function() {
          this.loadRecord(this.data.record.id)
          if (data.isCloudEnabled()) {
            this.refreshRecordFromCloud(true)
          }
        }.bind(this)
        data.repairProfileCertStatus().finally(reload)
      }.bind(this)).catch(function(error) {
        this.showConnectActionError(error.message || "操作失败", agree ? "同意失败" : "操作失败")
      }.bind(this)).finally(function() {
        this.setData({ actionLoading: "" })
      }.bind(this))
    }.bind(this)
    if (!agree) {
      runExchange()
      return
    }
    data.requestConnectSubscribe().then(runExchange).catch(runExchange)
  },



  goRecords() {
    wx.navigateTo({
      url: "/pages/records/records"
    })
  },

  goConnectRecord(event) {
    var id = event.currentTarget.dataset.id
    if (!id) {
      return
    }
    wx.navigateTo({
      url: "/pages/record/record?id=" + id
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
          return { path: item.tempFilePath, name: "图片" + (index + 1) + ".jpg" }
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
          return { path: item.path, name: item.name || "附件" }
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
    const url = item.displayUrl || item.url
    if (item.fileType === "image") {
      const urls = this.data.attachments
        .filter(function(entry) { return entry.fileType === "image" })
        .map(function(entry) { return entry.displayUrl || entry.url })
      wx.previewImage({ current: url, urls: urls })
      return
    }
    wx.openDocument({
      filePath: url,
      showMenu: true,
      fail: function() {
        wx.showToast({ title: "暂不支持预览该文件", icon: "none" })
      }
    })
  },

  saveAttachments() {
    const data = require("../../utils/data")
    if (!this.data.record || !this.data.canEditAttachments) {
      return
    }
    this.setData({ actionLoading: "save" })
    data.updateSubmissionAttachments(this.data.record.id, this.data.attachments).then(function() {
      wx.showToast({ title: "附件已更新", icon: "success" })
      this.loadRecord(this.data.record.id)
    }.bind(this)).catch(function(error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" })
    }).finally(function() {
      this.setData({ actionLoading: "" })
    }.bind(this))
  }

})


