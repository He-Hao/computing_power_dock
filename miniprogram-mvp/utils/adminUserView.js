var userIntentLabels = {
  demand: "找算力（提交需求）",
  supply: "供算力（发布资源）",
  browse: "先逛逛"
}

function formatCertStatusText(certStatus, certLevel) {
  if (certStatus === "verified") {
    return certLevel === "license" ? "已认证 · 营业执照" : (certLevel === "card" ? "已认证 · 名片" : "已认证")
  }
  if (certStatus === "pending") {
    return certLevel === "license" ? "审核中 · 营业执照" : (certLevel === "card" ? "审核中 · 名片" : "认证审核中")
  }
  if (certStatus === "rejected") {
    return "认证已驳回"
  }
  return "未认证"
}

function formatStaffRoleText(staffRole) {
  if (staffRole === "admin") {
    return "平台管理员"
  }
  if (staffRole === "manager") {
    return "运营专员"
  }
  return ""
}

function formatAccountStatusText(user) {
  if (user.accountStatus === "disabled") {
    return "已禁用"
  }
  if (user.staffRole) {
    return "运营账号 · 正常"
  }
  return "正常"
}

function pushDetailRow(rows, label, value) {
  var text = String(value || "").trim()
  if (!text) {
    return
  }
  rows.push({
    label: label,
    value: text
  })
}

function enrichAdminUserListItem(user) {
  if (!user) {
    return user
  }
  var detailRows = []
  pushDetailRow(detailRows, "联系人", user.contact)
  pushDetailRow(detailRows, "企业", user.company)
  pushDetailRow(detailRows, "角色", user.role)
  pushDetailRow(detailRows, "所在地", user.region)
  pushDetailRow(detailRows, "信用代码", user.creditCode)
  pushDetailRow(detailRows, "邮箱", user.email)
  pushDetailRow(detailRows, "网站", user.website)
  pushDetailRow(detailRows, "企业简介", user.description)
  pushDetailRow(detailRows, "认证", formatCertStatusText(user.certStatus, user.certLevel))
  if (user.certSubmittedAt) {
    pushDetailRow(detailRows, "认证提交", user.certSubmittedAt)
  }
  if (user.certVerifiedAt) {
    pushDetailRow(detailRows, "认证通过", user.certVerifiedAt)
  }
  pushDetailRow(detailRows, "账号状态", formatAccountStatusText(user))
  if (user.accountStatus === "disabled" && user.accountDisabledReason) {
    pushDetailRow(detailRows, "禁用原因", user.accountDisabledReason)
  }
  if (user.accountStatus === "disabled" && user.accountDisabledAt) {
    pushDetailRow(detailRows, "禁用时间", user.accountDisabledAt)
  }
  if (user.staffRole) {
    pushDetailRow(detailRows, "运营身份", formatStaffRoleText(user.staffRole))
  }
  if (user.userIntent) {
    pushDetailRow(detailRows, "注册意向", userIntentLabels[user.userIntent] || user.userIntent)
  }
  pushDetailRow(detailRows, "引导完成", user.onboardingCompleted ? "已完成" : "未完成")
  pushDetailRow(detailRows, "手机验证", user.phoneVerified === false ? "未验证" : "已验证")
  if (user.registeredAt) {
    pushDetailRow(detailRows, "注册时间", user.registeredAt)
  }
  if (user.lastLoginAt) {
    pushDetailRow(detailRows, "最近登录", user.lastLoginAt)
  }
  var activityText = [
    (user.resourceCount || 0) + " 资源",
    (user.demandCount || 0) + " 需求",
    (user.connectCount || 0) + " 对接",
    (user.submissionCount || 0) + " 提交"
  ].join(" · ")
  pushDetailRow(detailRows, "业务统计", activityText)
  return Object.assign({}, user, {
    certStatusText: formatCertStatusText(user.certStatus, user.certLevel),
    accountStatusText: formatAccountStatusText(user),
    staffRoleText: formatStaffRoleText(user.staffRole),
    userIntentText: userIntentLabels[user.userIntent] || "",
    activityText: activityText,
    detailRows: detailRows
  })
}

function enrichAdminUserListItems(items) {
  return (items || []).map(enrichAdminUserListItem)
}

function buildBriefMetaLine(user) {
  return user.region || ""
}

function enrichAdminUserListItemBrief(user) {
  if (!user) {
    return user
  }
  var activityText = [
    (user.resourceCount || 0) + " 资源",
    (user.demandCount || 0) + " 需求",
    (user.connectCount || 0) + " 对接"
  ].join(" · ")
  var contact = String(user.contact || "").trim()
  var company = String(user.company || "").trim()
  return {
    phone: user.phone,
    contact: contact,
    company: company,
    region: user.region || "",
    accountStatus: user.accountStatus || "active",
    certStatus: user.certStatus || "",
    certLevel: user.certLevel || "",
    staffRole: user.staffRole || "",
    registeredAt: user.registeredAt || "",
    lastLoginAt: user.lastLoginAt || "",
    certStatusText: formatCertStatusText(user.certStatus, user.certLevel),
    staffRoleText: formatStaffRoleText(user.staffRole),
    contactLine: contact || "未填写联系人",
    subtitle: company,
    metaLine: buildBriefMetaLine(user),
    activityText: activityText
  }
}

function enrichAdminUserListItemsBrief(items) {
  return (items || []).map(enrichAdminUserListItemBrief)
}

module.exports = {
  enrichAdminUserListItem: enrichAdminUserListItem,
  enrichAdminUserListItems: enrichAdminUserListItems,
  enrichAdminUserListItemBrief: enrichAdminUserListItemBrief,
  enrichAdminUserListItemsBrief: enrichAdminUserListItemsBrief
}
