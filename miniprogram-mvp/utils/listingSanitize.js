/**
 * 公开展示池商机字段脱敏与本地缓存合并 — 客户端唯一实现
 * cloudStore / data/_core 共用，避免规则漂移
 */

var LISTING_SENSITIVE_IDENTITY_KEYS = [
  "clientCompany",
  "clientContact",
  "clientRole",
  "actualOwnerPhone",
  "ownerPhone",
  "ownerOpenid",
  "proxyStaffPhone",
  "proxyStaffOpenid"
]

/** 详情补充规格中不得对访客/路人展示的字段标签 */
var LISTING_PUBLISHER_SENSITIVE_SPEC_LABELS = {
  "企业名称": true,
  "企业全称": true,
  "联系人": true,
  "手机号": true,
  "联系电话": true
}

var LISTING_PRESERVE_MERGE_KEYS = LISTING_SENSITIVE_IDENTITY_KEYS.concat([
  "publishedByStaff",
  "ownerPhone",
  "ownerOpenid"
])

function getListingPoolFromId(id) {
  if (id && id.indexOf("URES-") === 0) {
    return "resource"
  }
  if (id && (id.indexOf("UDEM-") === 0 || id.indexOf("DEM-") === 0)) {
    return "demand"
  }
  return null
}

function normalizeListingPoolField(listing) {
  if (!listing) {
    return listing
  }
  var poolById = getListingPoolFromId(listing.id)
  if (poolById) {
    return Object.assign({}, listing, { pool: poolById })
  }
  return listing
}

/** 公开展示池 / 分享落地：剥离代发客户与归属手机号 */
function sanitizePublicListingFields(listing) {
  if (!listing) {
    return listing
  }
  var copy = Object.assign({}, listing)
  LISTING_SENSITIVE_IDENTITY_KEYS.forEach(function(key) {
    delete copy[key]
  })
  return copy
}

function filterPublisherSensitiveDetailRows(details) {
  if (!details || !details.length) {
    return details || []
  }
  return details.filter(function(row) {
    return !(row && LISTING_PUBLISHER_SENSITIVE_SPEC_LABELS[row.label])
  })
}

/** 云端公池数据优先，仅回填本地保留的代发归属等敏感字段 */
function mergePreservedListingWithPublic(preserved, pub) {
  if (!preserved) {
    return pub
  }
  if (!pub) {
    return preserved
  }
  var merged = Object.assign({}, preserved, pub)
  LISTING_PRESERVE_MERGE_KEYS.forEach(function(key) {
    if (preserved[key]) {
      merged[key] = preserved[key]
    }
  })
  return normalizeListingPoolField(merged)
}

module.exports = {
  LISTING_SENSITIVE_IDENTITY_KEYS: LISTING_SENSITIVE_IDENTITY_KEYS,
  LISTING_PUBLISHER_SENSITIVE_SPEC_LABELS: LISTING_PUBLISHER_SENSITIVE_SPEC_LABELS,
  LISTING_PRESERVE_MERGE_KEYS: LISTING_PRESERVE_MERGE_KEYS,
  getListingPoolFromId: getListingPoolFromId,
  normalizeListingPoolField: normalizeListingPoolField,
  sanitizePublicListingFields: sanitizePublicListingFields,
  filterPublisherSensitiveDetailRows: filterPublisherSensitiveDetailRows,
  mergePreservedListingWithPublic: mergePreservedListingWithPublic
}
