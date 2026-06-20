/**
 * 企业/名片认证门禁 — 唯一规则源（口径见 10_权限规则.md v1.13 §3.1）
 *
 * 对接、匹配、发布需求/资源：需名片或执照认证。
 * 查看资源附件：需名片或执照认证（走 promptLicenseCertification）。
 */

var CertAction = {
  SUBMIT_LISTING: "submit_listing",
  CONNECT: "connect",
  MATCH: "match",
  LICENSE_ATTACHMENT: "license_attachment"
}

var LISTING_PUBLISH_TYPES = {
  resource: true,
  demand: true,
  room: true,
  server: true
}

function isListingPublishType(type) {
  return !!LISTING_PUBLISH_TYPES[type]
}

function submitTypeToCertAction(type) {
  if (type === "connect") {
    return CertAction.CONNECT
  }
  if (type === "match") {
    return CertAction.MATCH
  }
  if (isListingPublishType(type)) {
    return CertAction.SUBMIT_LISTING
  }
  return ""
}

function requiresBusinessCert(action) {
  return action === CertAction.SUBMIT_LISTING
    || action === CertAction.CONNECT
    || action === CertAction.MATCH
}

function isConnectOrMatchAction(action) {
  return action === CertAction.CONNECT || action === CertAction.MATCH
}

/** 是否允许弹出名片认证引导 */
function canPromptBusinessCert(action) {
  return requiresBusinessCert(action)
}

/** 兼容旧 scene 字段：connect / match / submit */
function normalizeCertAction(options) {
  options = options || {}
  if (options.action) {
    return options.action
  }
  if (options.scene === "connect") {
    return CertAction.CONNECT
  }
  if (options.scene === "match") {
    return CertAction.MATCH
  }
  if (options.scene === "submit") {
    return CertAction.SUBMIT_LISTING
  }
  return options.scene || ""
}

module.exports = {
  CertAction: CertAction,
  isListingPublishType: isListingPublishType,
  submitTypeToCertAction: submitTypeToCertAction,
  requiresBusinessCert: requiresBusinessCert,
  isConnectOrMatchAction: isConnectOrMatchAction,
  canPromptBusinessCert: canPromptBusinessCert,
  normalizeCertAction: normalizeCertAction
}
