/**
 * 对接流程 · 单一阶段视图（待办 / 展示状态 / 时间线共用）
 *
 * 所有 UI 层应通过 buildConnectStageView 获取对接进度，避免 status / displayStatus / 待办各算各的。
 */

var CONNECT_STAGES = {
  EXCHANGED: "exchanged",
  CLOSED: "closed",
  PLATFORM_REVIEW: "platform_review",
  WAIT_RECIPIENT_CONFIRM: "wait_recipient_confirm",
  WAIT_APPLICANT_EXCHANGE: "wait_applicant_exchange",
  WAIT_RECIPIENT_EXCHANGE: "wait_recipient_exchange",
  WAIT_APPLICANT_CONFIRM: "wait_applicant_confirm"
}

function isConnectRecord(submission) {
  return !!(submission && submission.type === "connect")
}

function isConnectContactsExchanged(submission) {
  return !!(submission && (submission.disclosedContacts || submission.status === "已交换名片"))
}

function isConnectRecipientResponded(submission) {
  if (!isConnectRecord(submission)) {
    return false
  }
  if (submission.recipientExchangeAgree === true || submission.recipientConfirmed === true) {
    return true
  }
  return ["待交换确认", "对方已确认", "已交换名片"].indexOf(submission.status) > -1
}

function isConnectRecipientInitiatedExchange(submission) {
  return !!(submission && submission.recipientExchangeAgree === true)
}

function isConnectSubmissionUnfinished(submission) {
  if (!isConnectRecord(submission)) {
    return false
  }
  if (isConnectContactsExchanged(submission)) {
    return false
  }
  if (submission.applicantExchangeAgree === true && submission.recipientExchangeAgree === true) {
    return false
  }
  return ["已关闭", "已流失", "已交换名片"].indexOf(submission.status) === -1
}

/** 与展示/待办一致的有效展示状态（不读本地 storage） */
function deriveConnectDisplayStatus(submission) {
  if (!isConnectRecord(submission)) {
    return submission ? (submission.status || "") : ""
  }
  if (isConnectContactsExchanged(submission)) {
    return "已交换名片"
  }
  if (submission.status === "待平台审核") {
    return "待平台审核"
  }
  if (submission.status === "待对方确认" && isConnectRecipientResponded(submission)) {
    return "待交换确认"
  }
  return submission.status || ""
}

/** 内存修复：status 与 recipientExchangeAgree 不一致时对齐（不写 storage） */
function normalizeConnectSubmissionFields(submission) {
  if (!isConnectRecord(submission)) {
    return submission
  }
  if (submission.status === "待对方确认" && isConnectRecipientResponded(submission)) {
    return Object.assign({}, submission, { status: "待交换确认" })
  }
  return submission
}

function resolveConnectStage(submission) {
  if (!isConnectRecord(submission)) {
    return ""
  }
  submission = normalizeConnectSubmissionFields(submission)
  if (isConnectContactsExchanged(submission)) {
    return CONNECT_STAGES.EXCHANGED
  }
  if (submission.status === "已关闭" || submission.status === "已流失") {
    return CONNECT_STAGES.CLOSED
  }
  if (submission.status === "待平台审核") {
    return CONNECT_STAGES.PLATFORM_REVIEW
  }
  if (submission.status === "待对方确认" && !isConnectRecipientResponded(submission)) {
    return CONNECT_STAGES.WAIT_RECIPIENT_CONFIRM
  }
  if (isConnectRecipientInitiatedExchange(submission) && submission.applicantExchangeAgree !== true) {
    return CONNECT_STAGES.WAIT_APPLICANT_EXCHANGE
  }
  if (submission.status === "待交换确认" || submission.status === "对方已确认") {
    if (isConnectRecipientInitiatedExchange(submission)) {
      return CONNECT_STAGES.WAIT_APPLICANT_EXCHANGE
    }
    return CONNECT_STAGES.WAIT_RECIPIENT_EXCHANGE
  }
  if (isConnectRecipientResponded(submission)) {
    return CONNECT_STAGES.WAIT_APPLICANT_EXCHANGE
  }
  return CONNECT_STAGES.WAIT_RECIPIENT_CONFIRM
}

function getConnectPendingBadgeClass(pendingSide) {
  if (pendingSide === "mine") {
    return "status-pending-mine"
  }
  if (pendingSide === "other") {
    return "status-pending-other"
  }
  if (pendingSide === "platform") {
    return "status-pending-platform"
  }
  return "status-pending"
}

function buildPendingView(stage, context) {
  var empty = {
    pendingSide: "none",
    pendingLabel: "",
    pendingHint: "",
    pendingBadgeClass: ""
  }
  var role = context.role || null
  var actions = context.actions || null
  var confirmRoleLabel = context.confirmRoleLabel || "对方"
  var canActAsRecipient = !!context.canActAsRecipient

  if (!isConnectSubmissionUnfinished(context.submission)) {
    return empty
  }
  if (context.submission.applicantExchangeAgree === true
    && context.submission.recipientExchangeAgree === true) {
    return empty
  }

  if (actions && actions.canReview) {
    return {
      pendingSide: "platform",
      pendingLabel: "待平台处理",
      pendingHint: "平台审批通过后进入对方确认",
      pendingBadgeClass: "platform"
    }
  }
  if (actions && (actions.canConfirm || actions.canExchange)) {
    return {
      pendingSide: "mine",
      pendingLabel: "待我方处理",
      pendingHint: actions.canConfirm
        ? "请确认是否愿意对接并发起交换名片"
        : "请确认是否交换联系方式",
      pendingBadgeClass: "mine"
    }
  }

  if (stage === CONNECT_STAGES.PLATFORM_REVIEW) {
    return {
      pendingSide: "platform",
      pendingLabel: "待平台处理",
      pendingHint: role === "applicant"
        ? "等待平台运营审批，通过后将通知对方"
        : "等待平台运营审批",
      pendingBadgeClass: "platform"
    }
  }
  if (stage === CONNECT_STAGES.WAIT_RECIPIENT_CONFIRM) {
    if (role === "recipient" || (role === "proxyStaff" && canActAsRecipient)) {
      return empty
    }
    if (role === "applicant" || (role === "proxyStaff" && !canActAsRecipient)) {
      return {
        pendingSide: "other",
        pendingLabel: "待对方处理",
        pendingHint: "等待" + confirmRoleLabel + "确认对接",
        pendingBadgeClass: "other"
      }
    }
  }
  if (stage === CONNECT_STAGES.WAIT_APPLICANT_EXCHANGE) {
    if (role === "applicant") {
      return {
        pendingSide: "mine",
        pendingLabel: "待我方处理",
        pendingHint: "请确认是否交换联系方式",
        pendingBadgeClass: "mine"
      }
    }
    if (role === "recipient") {
      return {
        pendingSide: "other",
        pendingLabel: "待对方处理",
        pendingHint: "等待申请方确认交换名片",
        pendingBadgeClass: "other"
      }
    }
  }
  if (stage === CONNECT_STAGES.WAIT_RECIPIENT_EXCHANGE) {
    if (role === "recipient") {
      return {
        pendingSide: "mine",
        pendingLabel: "待我方处理",
        pendingHint: "请确认是否交换联系方式",
        pendingBadgeClass: "mine"
      }
    }
    if (role === "applicant") {
      return {
        pendingSide: "other",
        pendingLabel: "待对方处理",
        pendingHint: "等待" + confirmRoleLabel + "确认交换",
        pendingBadgeClass: "other"
      }
    }
  }
  return empty
}

function buildFlowTimeline(submission, stage, context) {
  if (!isConnectRecord(submission)) {
    return []
  }
  submission = normalizeConnectSubmissionFields(submission)
  var role = context.role || null
  var confirmRoleLabel = context.confirmRoleLabel || "对方"
  var recipientInitiated = isConnectRecipientInitiatedExchange(submission)
  var exchanged = stage === CONNECT_STAGES.EXCHANGED
  var rejected = stage === CONNECT_STAGES.CLOSED
  var platformStage = stage === CONNECT_STAGES.PLATFORM_REVIEW
  var recipientConfirmed = stage !== CONNECT_STAGES.WAIT_RECIPIENT_CONFIRM
    && stage !== CONNECT_STAGES.PLATFORM_REVIEW
    && stage !== CONNECT_STAGES.CLOSED
    && !exchanged

  var applyHint = role === "applicant"
    ? "您已向对方发起对接申请"
    : (role === "recipient" ? "对方已向您发起对接申请" : "对接申请已提交")

  var platformStatus = "平台审批"
  var platformHint = "涉及平台代发商机，对接申请等待运营审批"
  var platformDot = platformStage ? "pending" : (rejected || recipientConfirmed || exchanged ? "done" : "muted")
  if (rejected && submission.status === "已关闭" && submission.needsPlatformConnectReview) {
    platformDot = submission.platformConnectApproved ? "done" : "current"
  }

  var confirmStatus = "等待" + confirmRoleLabel + "确认"
  var confirmHint = confirmRoleLabel + "可同意并发起交换名片，或标记暂不合适"
  var confirmTime = submission.recipientConfirmedAt || ""
  if (rejected) {
    confirmStatus = "对接未通过"
    confirmHint = "本次对接已关闭"
  } else if (recipientConfirmed) {
    if (role === "recipient") {
      confirmStatus = recipientInitiated ? "您已同意并发起交换" : "您已确认对接"
      confirmHint = recipientInitiated
        ? "已向对方发起交换名片，等待申请方确认"
        : "双方可进入交换联系方式环节"
    } else if (role === "applicant") {
      confirmStatus = recipientInitiated
        ? confirmRoleLabel + "已同意并发起交换"
        : confirmRoleLabel + "已确认对接"
      confirmHint = recipientInitiated
        ? "请确认是否交换名片"
        : "双方可进入交换联系方式环节"
    } else {
      confirmStatus = recipientInitiated
        ? confirmRoleLabel + "已同意并发起交换"
        : confirmRoleLabel + "已确认对接"
      confirmHint = recipientInitiated
        ? "等待申请方确认交换名片"
        : "双方可进入交换联系方式环节"
    }
  } else if (role === "recipient") {
    confirmStatus = "待您确认"
    confirmHint = "同意后即发起交换名片，等待申请方确认"
  } else if (platformStage) {
    confirmStatus = "等待" + confirmRoleLabel + "确认"
    confirmHint = "平台审批通过后将进入此环节"
  }

  var exchangeStatus = "交换名片"
  var exchangeHint = "申请方同意后双方可查看完整联系方式"
  var exchangeTime = submission.matchedAt || ""
  var exchangeDot = "muted"
  if (exchanged) {
    exchangeStatus = "已交换名片"
    exchangeHint = "双方已公示企业名称、联系人、手机号"
    exchangeDot = "done"
  } else if (rejected) {
    exchangeHint = "对接已关闭，未完成交换"
  } else if (recipientInitiated && recipientConfirmed) {
    if (role === "applicant" && submission.applicantExchangeAgree !== true) {
      exchangeStatus = "待您确认交换"
      exchangeHint = "对方已发起交换名片，请确认"
      exchangeDot = "pending"
    } else if (role === "recipient") {
      exchangeStatus = "已发起交换名片"
      exchangeHint = "等待申请方确认交换"
      exchangeDot = "pending"
    } else {
      exchangeStatus = "等待申请方确认交换"
      exchangeHint = "接收方已发起交换名片"
      exchangeDot = "pending"
    }
  } else if (recipientConfirmed) {
    exchangeStatus = "待双方确认交换"
    exchangeHint = "双方均同意后公示联系方式"
    exchangeDot = "pending"
  }

  var steps = [
    {
      status: "已申请对接",
      hint: applyHint,
      time: submission.createdAt || "",
      dotState: "done"
    }
  ]

  if (submission.needsPlatformConnectReview) {
    steps.push({
      status: platformStatus,
      hint: platformHint,
      time: submission.platformConnectApproved ? (submission.updatedAt || "") : "",
      dotState: platformDot
    })
  }

  steps.push(
    {
      status: confirmStatus,
      hint: confirmHint,
      time: confirmTime,
      dotState: rejected ? "done" : (recipientConfirmed ? "done" : (platformStage ? "muted" : "pending"))
    },
    {
      status: exchangeStatus,
      hint: exchangeHint,
      time: exchangeTime,
      dotState: exchangeDot
    }
  )
  return steps
}

function buildMiniTimeline(submission, stage, context) {
  if (!isConnectRecord(submission)) {
    return []
  }
  submission = normalizeConnectSubmissionFields(submission)
  var role = context.role || null
  var confirmRoleLabel = context.confirmRoleLabel || "对方"
  var recipientInitiated = isConnectRecipientInitiatedExchange(submission)

  if (stage === CONNECT_STAGES.EXCHANGED) {
    return [{ compact: true, text: "已申请 → 已同意对接 → 已交换名片" }]
  }
  if (stage === CONNECT_STAGES.CLOSED) {
    return [{ compact: true, text: "已申请 → 对接已关闭" }]
  }
  if (stage === CONNECT_STAGES.PLATFORM_REVIEW) {
    return [{ compact: true, text: "已申请 → 平台审批中 → 等待对方确认" }]
  }
  if (stage === CONNECT_STAGES.WAIT_APPLICANT_EXCHANGE) {
    if (role === "applicant") {
      return [{ compact: true, text: "已申请 → 对方已发起交换 → 待您确认" }]
    }
    if (role === "recipient") {
      return [{ compact: true, text: "已申请 → 您已发起交换 → 待申请方确认" }]
    }
    return [{ compact: true, text: "已申请 → 对方已发起交换 → 待申请方确认" }]
  }
  if (stage === CONNECT_STAGES.WAIT_RECIPIENT_EXCHANGE) {
    return [{ compact: true, text: "已申请 → 已确认对接 → 待确认交换" }]
  }

  var recipientDone = stage !== CONNECT_STAGES.WAIT_RECIPIENT_CONFIRM
  var confirmLabel = recipientDone
    ? (role === "recipient"
      ? (recipientInitiated ? "您已发起交换" : "您已确认")
      : (recipientInitiated ? confirmRoleLabel + "已发起交换" : confirmRoleLabel + "已确认"))
    : (role === "recipient" ? "待您确认" : "等待" + confirmRoleLabel + "确认")

  return [
    { label: "已申请", dotState: "done" },
    { label: confirmLabel, dotState: recipientDone ? "done" : "pending" }
  ]
}

function buildNoticeAction(submission, stage, context) {
  var actions = context.actions || null
  var role = context.role || null
  if (!actions || !isConnectSubmissionUnfinished(submission)) {
    return null
  }
  if (actions.canConfirm) {
    return { actionType: "confirm", actionLabel: "待同意并发起交换" }
  }
  if (actions.canExchange) {
    return { actionType: "exchange", actionLabel: "待确认交换名片" }
  }
  if (role === "applicant"
    && stage === CONNECT_STAGES.WAIT_RECIPIENT_CONFIRM
    && submission.platformConnectApproved) {
    return { actionType: "progress", actionLabel: "平台已通过" }
  }
  return null
}

/**
 * @param {object} submission 对接记录
 * @param {string} viewerPhone 当前用户手机号
 * @param {object} context { role, actions, confirmRoleLabel, canActAsRecipient }
 */
function buildConnectStageView(submission, viewerPhone, context) {
  context = context || {}
  if (!isConnectRecord(submission)) {
    return {
      stage: "",
      displayStatus: "",
      pendingSide: "none",
      pendingLabel: "",
      pendingHint: "",
      pendingBadgeClass: "",
      flowTimeline: [],
      miniTimeline: [],
      noticeAction: null,
      needsAction: false,
      isInProgress: false
    }
  }
  var normalized = normalizeConnectSubmissionFields(submission)
  var stage = resolveConnectStage(normalized)
  var displayStatus = deriveConnectDisplayStatus(normalized)
  var ctx = Object.assign({}, context, { submission: normalized })
  var pending = buildPendingView(stage, ctx)
  var flowTimeline = buildFlowTimeline(normalized, stage, ctx)
  var miniTimeline = buildMiniTimeline(normalized, stage, ctx)
  var noticeAction = buildNoticeAction(normalized, stage, ctx)

  return {
    stage: stage,
    displayStatus: displayStatus,
    pendingSide: pending.pendingSide,
    pendingLabel: pending.pendingLabel,
    pendingHint: pending.pendingHint,
    pendingBadgeClass: pending.pendingBadgeClass,
    flowTimeline: flowTimeline,
    miniTimeline: miniTimeline,
    noticeAction: noticeAction,
    needsAction: pending.pendingSide === "mine" || !!(noticeAction && noticeAction.actionType !== "progress"),
    isWatching: pending.pendingSide === "other" || pending.pendingSide === "platform",
    isInProgress: isConnectSubmissionUnfinished(normalized)
  }
}

module.exports = {
  CONNECT_STAGES: CONNECT_STAGES,
  isConnectContactsExchanged: isConnectContactsExchanged,
  isConnectRecipientResponded: isConnectRecipientResponded,
  isConnectSubmissionUnfinished: isConnectSubmissionUnfinished,
  deriveConnectDisplayStatus: deriveConnectDisplayStatus,
  normalizeConnectSubmissionFields: normalizeConnectSubmissionFields,
  getConnectPendingBadgeClass: getConnectPendingBadgeClass,
  buildConnectStageView: buildConnectStageView
}
