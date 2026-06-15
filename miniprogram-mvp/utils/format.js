function pad2(value) {
  return value < 10 ? "0" + value : "" + value
}

function formatDate(date) {
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) + " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes())
}

function formatDateOnly(date) {
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate())
}

function isDateOnlyString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim())
}

function parseDateTime(value) {
  if (!value) {
    return NaN
  }
  var str = String(value).trim()
  if (isDateOnlyString(str)) {
    return Date.parse(str.replace(/-/g, "/") + " 12:00:00")
  }
  return Date.parse(str.replace(/-/g, "/"))
}

function maskPhone(phone) {
  if (!phone || phone.length < 7) {
    return phone || "未填写"
  }
  return phone.slice(0, 3) + "****" + phone.slice(-4)
}

/** 整机数量：未带「台」时自动补上（如 128 → 128台） */
function normalizeServerScale(scale) {
  var text = String(scale || "").trim()
  if (!text) {
    return ""
  }
  if (/台/.test(text)) {
    return text
  }
  if (/^\d+(\.\d+)?$/.test(text)) {
    return text + "台"
  }
  var match = text.match(/^(\d+(?:\.\d+)?)(\s*)(.+)$/)
  if (match) {
    return match[1] + "台" + (match[2] || "") + match[3]
  }
  return text
}

function maskCompany(name) {
  if (!name) {
    return "已登记企业"
  }
  if (name.length <= 2) {
    return name.charAt(0) + "*"
  }
  if (name.length <= 4) {
    return name.slice(0, 1) + "**" + name.slice(-1)
  }
  return name.slice(0, 2) + "***" + name.slice(-2)
}

function formatRelativeTime(timeStr) {
  if (!timeStr) {
    return ""
  }
  var parsed = parseDateTime(timeStr)
  if (isNaN(parsed)) {
    return timeStr
  }
  var diff = Date.now() - parsed
  if (diff < 60000) {
    return "刚刚"
  }
  if (diff < 3600000) {
    return Math.floor(diff / 60000) + " 分钟前"
  }
  if (diff < 86400000) {
    return Math.floor(diff / 3600000) + " 小时前"
  }
  if (diff < 604800000) {
    return Math.floor(diff / 86400000) + " 天前"
  }
  return timeStr.slice(0, 10)
}

/** 将时间戳格式化为北京时间（东八区） */
function formatBeijingDateTime(value) {
  if (!value) {
    return ""
  }
  var str = String(value).trim()
  if (isDateOnlyString(str)) {
    return str
  }
  var parsed = Date.parse(str)
  if (isNaN(parsed)) {
    parsed = parseDateTime(str)
  }
  if (isNaN(parsed)) {
    return str
  }
  var offsetMs = parsed + 8 * 60 * 60 * 1000
  var date = new Date(offsetMs)
  return date.getUTCFullYear() + "-" + pad2(date.getUTCMonth() + 1) + "-" + pad2(date.getUTCDate())
    + " " + pad2(date.getUTCHours()) + ":" + pad2(date.getUTCMinutes())
}

function getPasswordStrength(password) {
  if (!password) {
    return { text: "", width: 0, level: 0 }
  }
  var score = 0
  if (password.length >= 8) {
    score += 1
  }
  if (password.length >= 10) {
    score += 1
  }
  if (/[A-Za-z]/.test(password) && /\d/.test(password)) {
    score += 1
  }
  if (/[^A-Za-z0-9]/.test(password)) {
    score += 1
  }
  var presets = [
    { text: "密码过短", width: 20, level: 1 },
    { text: "弱 · 至少 8 位且含字母与数字", width: 33, level: 1 },
    { text: "中等 · 建议 10 位以上", width: 66, level: 2 },
    { text: "强", width: 100, level: 3 }
  ]
  return presets[Math.min(score, presets.length - 1)]
}

module.exports = {
  formatDate,
  formatDateOnly,
  isDateOnlyString,
  parseDateTime,
  maskPhone,
  normalizeServerScale,
  maskCompany,
  formatRelativeTime,
  formatBeijingDateTime,
  getPasswordStrength
}
