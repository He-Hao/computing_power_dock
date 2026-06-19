function enrichReviewItem(item, data) {
  var tagClass = "resource"
  var typeName = item.typeName || ""
  var isListingReport = item.submission && data.isListingReportSubmission(item.submission)
  var isProxyConnect = item.submission && data.isProxyConnectReviewSubmission(item.submission)
  if (isListingReport) {
    return Object.assign({}, item, {
      tagClass: "danger",
      typeName: "商机举报",
      statusLabel: "待处理",
      contactLine: [item.contact, item.phone].filter(Boolean).join(" · "),
      reportReason: item.reportReason || (item.submission && item.submission.reportReason) || ""
    })
  }
  if (isProxyConnect) {
    var summary = data.getProxyConnectReviewSummary(item.submission) || {}
    return Object.assign({}, item, {
      tagClass: "warning",
      typeName: "代发对接",
      statusLabel: "待平台审批",
      proxySide: summary.proxySide || item.proxySide || "",
      proxyClientPhone: summary.proxyClientPhone || item.proxyClientPhone || "",
      proxyListingTitle: summary.proxyListingTitle || item.proxyListingTitle || "",
      contactLine: [item.contact, item.phone].filter(Boolean).join(" · ")
    })
  }
  if (typeName.indexOf("需求") >= 0) {
    tagClass = "demand"
  } else if (typeName.indexOf("认证") >= 0) {
    tagClass = "cert"
  } else if (typeName.indexOf("对接") >= 0 || typeName.indexOf("撮合") >= 0 || typeName.indexOf("代发") >= 0) {
    tagClass = "warning"
  }
  return Object.assign({}, item, {
    tagClass: tagClass,
    typeName: typeName,
    contactLine: [item.contact, item.phone].filter(Boolean).join(" · "),
    statusLabel: item.reviewType === "submission" && typeName.indexOf("对接") >= 0 ? "待处理" : "待审核"
  })
}

function buildReviewQueueView(data, tab) {
  tab = tab || "all"
  var isProxyConnectTab = tab === "proxyConnect"
  var isReportTab = tab === "report"
  var emptyCopy = {
    all: {
      title: "暂无待审内容",
      text: "当前没有需要处理的审核项"
    },
    listing: {
      title: "暂无待审公示",
      text: "资源与需求公示暂无待处理项"
    },
    certify: {
      title: "暂无待审认证",
      text: "企业认证申请暂无待处理项"
    },
    business: {
      title: "暂无待审商机",
      text: "商机类提交暂无待处理项"
    },
    proxyConnect: {
      title: "暂无待审代发对接",
      text: "代发对接申请暂无待处理项"
    },
    report: {
      title: "暂无待处理举报",
      text: "用户举报的虚假信息暂无待处理项"
    }
  }
  var empty = emptyCopy[tab] || emptyCopy.all
  var items = data.getAdminReviewQueue(tab).map(function(item) {
    return enrichReviewItem(item, data)
  })
  return {
    tab: tab,
    items: items,
    isProxyConnectTab: isProxyConnectTab,
    isReportTab: isReportTab,
    emptyTitle: empty.title,
    emptyText: empty.text,
    approveLabel: isProxyConnectTab ? "批准" : (isReportTab ? "成立下架" : "通过"),
    rejectLabel: isReportTab ? "驳回举报" : "驳回"
  }
}

function buildProxyFeatureSection(proxyStats) {
  proxyStats = proxyStats || { total: 0, pending: 0 }
  var proxyBadge = ""
  if (proxyStats.pending > 0) {
    proxyBadge = proxyStats.pending + " 待审"
  } else if (proxyStats.total > 0) {
    proxyBadge = proxyStats.total + " 条"
  }
  return {
    key: "proxy",
    title: "代发业务",
    items: [
      {
        key: "proxy-hub",
        icon: "代",
        title: "代发管理",
        badge: proxyBadge,
        action: "proxy-hub"
      },
      {
        key: "proxy-resource",
        icon: "资",
        title: "代发资源",
        action: "proxy-resource"
      },
      {
        key: "proxy-demand",
        icon: "需",
        title: "代发需求",
        action: "proxy-demand"
      }
    ]
  }
}

var appConfig = require("./config")

function buildDemoDataSection() {
  if (!appConfig.useCloud || appConfig.enableDemoSeedTools === false) {
    return null
  }
  return {
    key: "demo",
    title: "测试数据",
    desc: "4 个演示账号（18800000000～18800000003），登录密码 Demo1234",
    items: [
      {
        key: "seed-demo",
        icon: "导",
        title: "导入演示数据",
        desc: "每人 1 条整机资源 + 1 条需求，已名片认证",
        action: "seed-demo"
      },
      {
        key: "clear-demo",
        icon: "清",
        title: "清空演示数据",
        desc: "删除 18800000000～18800000099 测试号段及关联商机",
        action: "clear-demo",
        danger: true
      }
    ]
  }
}

function buildAdminGovernanceSection() {
  return {
    key: "governance",
    title: "平台治理",
    items: [
      {
        key: "admin-users",
        icon: "用",
        title: "全部用户",
        action: "admin-users"
      },
      {
        key: "admin-listings",
        icon: "商",
        title: "全部商机",
        action: "admin-listings"
      }
    ]
  }
}

function buildMonitorFeatureSection(connectStats, reportStats) {
  connectStats = connectStats || { total: 0, active: 0, pendingPlatform: 0 }
  reportStats = reportStats || { pending: 0, history: 0 }
  var connectBadge = ""
  if (connectStats.pendingPlatform > 0) {
    connectBadge = connectStats.pendingPlatform + " 待审"
  } else if (connectStats.active > 0) {
    connectBadge = connectStats.active + " 进行中"
  } else if (connectStats.total > 0) {
    connectBadge = connectStats.total + " 条"
  }
  var reportBadge = ""
  if (reportStats.pending > 0) {
    reportBadge = reportStats.pending + " 待处理"
  } else if (reportStats.history > 0) {
    reportBadge = reportStats.history + " 条"
  }
  return {
    key: "monitor",
    title: "撮合监管",
    items: [
      {
        key: "global-connects",
        icon: "接",
        title: "全局对接",
        badge: connectBadge,
        action: "global-connects"
      },
      {
        key: "listing-reports",
        icon: "举",
        title: "举报处理",
        badge: reportBadge,
        action: "listing-reports"
      }
    ]
  }
}

function buildConnectActionView(data) {
  var items = data.getStaffConnectActionQueue()
  return {
    items: items,
    count: items.length,
    emptyTitle: "暂无对接待办",
    emptyText: "代发商机对接需您确认或交换名片时会出现在这里"
  }
}

function loadOpsWorkbenchData(data, reviewTab) {
  var stats = data.getAdminHubStats()
  var proxyStats = data.getStaffProxyHubStats()
  var connectStats = data.getStaffGlobalConnectStats()
  var reportHistory = data.getStaffListingReportHistory()
  var reviewQueue = buildReviewQueueView(data, reviewTab || "all")
  var connectActions = buildConnectActionView(data)
  var payload = {
    stats: stats,
    reviewQueue: reviewQueue,
    connectActions: connectActions,
    proxySection: buildProxyFeatureSection(proxyStats),
    monitorSection: buildMonitorFeatureSection(connectStats, {
      pending: stats.pendingReports || 0,
      history: reportHistory.length
    }),
    demoDataSection: buildDemoDataSection(),
    governanceSection: null
  }
  if (data.isPlatformAdminUser && data.isPlatformAdminUser()) {
    payload.governanceSection = buildAdminGovernanceSection()
  }
  return payload
}

module.exports = {
  enrichReviewItem: enrichReviewItem,
  buildReviewQueueView: buildReviewQueueView,
  buildConnectActionView: buildConnectActionView,
  buildProxyFeatureSection: buildProxyFeatureSection,
  buildMonitorFeatureSection: buildMonitorFeatureSection,
  buildAdminGovernanceSection: buildAdminGovernanceSection,
  buildDemoDataSection: buildDemoDataSection,
  loadOpsWorkbenchData: loadOpsWorkbenchData
}
