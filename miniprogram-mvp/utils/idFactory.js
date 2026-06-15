/**
 * 平台业务编号：前缀区分功能，后缀含时间 + 随机段，降低同毫秒重复概率。
 *
 * | 前缀   | 含义           | 示例 |
 * | ------ | -------------- | ---- |
 * | URES-  | 公示资源（池） | URES-2506101430-K7M |
 * | UDEM-  | 公示需求（池） | UDEM-2506101430-P2N |
 * | UCON-  | 对接/匹配记录  | UCON-2506101440-R5T |
 * | SRES-  | 资源发布提交   | SRES-2506101430-A1B |
 * | SDEM-  | 需求发布提交   | SDEM-2506101430-C3D |
 *
 * 后缀格式：YYMMDDHHMM-XXX（兼容旧版 YYYYMMDD-HHMMSS-XXXX）。
 */

var ID_PREFIX = {
  RESOURCE_LISTING: "URES-",
  DEMAND_LISTING: "UDEM-",
  CONNECT: "UCON-",
  RESOURCE_SUBMISSION: "SRES-",
  DEMAND_SUBMISSION: "SDEM-",
  CERTIFY_SUBMISSION: "SCER-",
  MATCH_SUBMISSION: "SMAT-",
  LEGACY_SUBMISSION: "SUB-"
}

var RANDOM_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTUVWXYZ"

function pad2(value) {
  return value < 10 ? "0" + value : String(value)
}

function formatIdDatePart(date) {
  date = date || new Date()
  var year = String(date.getFullYear())
  return year.slice(-2)
    + pad2(date.getMonth() + 1)
    + pad2(date.getDate())
    + pad2(date.getHours())
    + pad2(date.getMinutes())
}

function randomSuffix(length) {
  length = length || 3
  var out = ""
  for (var i = 0; i < length; i += 1) {
    out += RANDOM_ALPHABET.charAt(Math.floor(Math.random() * RANDOM_ALPHABET.length))
  }
  return out
}

function generateTradeId(prefix) {
  if (!prefix) {
    throw new Error("generateTradeId 需要前缀")
  }
  return prefix + formatIdDatePart() + "-" + randomSuffix()
}

function generateResourceListingId() {
  return generateTradeId(ID_PREFIX.RESOURCE_LISTING)
}

function generateDemandListingId() {
  return generateTradeId(ID_PREFIX.DEMAND_LISTING)
}

function generateConnectSubmissionId() {
  return generateTradeId(ID_PREFIX.CONNECT)
}

function generateResourceSubmissionId() {
  return generateTradeId(ID_PREFIX.RESOURCE_SUBMISSION)
}

function generateDemandSubmissionId() {
  return generateTradeId(ID_PREFIX.DEMAND_SUBMISSION)
}

function getSubmissionIdPrefix(submitType) {
  if (submitType === "connect") {
    return ID_PREFIX.CONNECT
  }
  if (submitType === "resource") {
    return ID_PREFIX.RESOURCE_SUBMISSION
  }
  if (submitType === "demand" || submitType === "server" || submitType === "room") {
    return ID_PREFIX.DEMAND_SUBMISSION
  }
  if (submitType === "certify") {
    return ID_PREFIX.CERTIFY_SUBMISSION
  }
  if (submitType === "match") {
    return ID_PREFIX.MATCH_SUBMISSION
  }
  return ID_PREFIX.LEGACY_SUBMISSION
}

function generateSubmissionId(submitType) {
  return generateTradeId(getSubmissionIdPrefix(submitType))
}

function isResourceListingId(id) {
  return !!(id && (id.indexOf(ID_PREFIX.RESOURCE_LISTING) === 0 || id.indexOf("RES-") === 0))
}

function isDemandListingId(id) {
  return !!(id && (id.indexOf(ID_PREFIX.DEMAND_LISTING) === 0 || id.indexOf("DEM-") === 0))
}

function isConnectRecordId(id) {
  return !!(id && id.indexOf(ID_PREFIX.CONNECT) === 0)
}

function looksLikeTradeIdKeyword(keyword) {
  var text = String(keyword || "").trim()
  if (!text) {
    return false
  }
  if (/^(URES|UDEM|UCON|SRES|SDEM|SCER|SMAT|SUB|RES|DEM)-/i.test(text)) {
    return true
  }
  if (/^\d{10}-[0-9A-Z]{3}$/i.test(text)) {
    return true
  }
  return /^\d{8}-\d{6}-[0-9A-Z]{4}$/i.test(text)
}

function normalizeIdSearchKeyword(keyword) {
  return String(keyword || "").trim().toLowerCase()
}

function collectSearchableTradeIds(entity) {
  if (!entity) {
    return []
  }
  var ids = []
  ;["id", "submissionId", "listingId", "targetId", "sourceListingId"].forEach(function(key) {
    if (entity[key]) {
      ids.push(String(entity[key]))
    }
  })
  return ids
}

function itemMatchesTradeIdKeyword(item, keyword) {
  var normalizedKeyword = normalizeIdSearchKeyword(keyword)
  if (!item || !normalizedKeyword) {
    return false
  }
  var searchableIds = collectSearchableTradeIds(item)
  for (var i = 0; i < searchableIds.length; i += 1) {
    var id = searchableIds[i].toLowerCase()
    if (id === normalizedKeyword || id.indexOf(normalizedKeyword) > -1 || normalizedKeyword.indexOf(id) > -1) {
      return true
    }
  }
  return false
}

function appendListingIdSearchFields(listing) {
  if (!listing) {
    return ""
  }
  return [
    listing.id,
    listing.submissionId
  ].filter(Boolean).join(" ")
}

function getTradeIdTypeLabel(id) {
  if (!id) {
    return ""
  }
  if (isResourceListingId(id)) {
    return "资源"
  }
  if (isDemandListingId(id)) {
    return "需求"
  }
  if (id.indexOf(ID_PREFIX.CONNECT) === 0) {
    return "对接"
  }
  if (id.indexOf(ID_PREFIX.RESOURCE_SUBMISSION) === 0) {
    return "资源提交"
  }
  if (id.indexOf(ID_PREFIX.DEMAND_SUBMISSION) === 0) {
    return "需求提交"
  }
  if (id.indexOf(ID_PREFIX.CERTIFY_SUBMISSION) === 0) {
    return "认证"
  }
  if (id.indexOf(ID_PREFIX.MATCH_SUBMISSION) === 0) {
    return "人工撮合"
  }
  if (id.indexOf(ID_PREFIX.LEGACY_SUBMISSION) === 0) {
    return "提交记录"
  }
  return ""
}

module.exports = {
  ID_PREFIX: ID_PREFIX,
  generateTradeId: generateTradeId,
  generateResourceListingId: generateResourceListingId,
  generateDemandListingId: generateDemandListingId,
  generateConnectSubmissionId: generateConnectSubmissionId,
  generateResourceSubmissionId: generateResourceSubmissionId,
  generateDemandSubmissionId: generateDemandSubmissionId,
  generateSubmissionId: generateSubmissionId,
  getSubmissionIdPrefix: getSubmissionIdPrefix,
  isResourceListingId: isResourceListingId,
  isDemandListingId: isDemandListingId,
  isConnectRecordId: isConnectRecordId,
  getTradeIdTypeLabel: getTradeIdTypeLabel,
  looksLikeTradeIdKeyword: looksLikeTradeIdKeyword,
  normalizeIdSearchKeyword: normalizeIdSearchKeyword,
  collectSearchableTradeIds: collectSearchableTradeIds,
  itemMatchesTradeIdKeyword: itemMatchesTradeIdKeyword,
  appendListingIdSearchFields: appendListingIdSearchFields
}
