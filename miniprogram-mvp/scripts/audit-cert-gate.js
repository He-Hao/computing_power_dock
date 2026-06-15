/**
 * 名片认证门禁规则审计
 */
var certGate = require("../utils/certGate")

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

console.log("=== 名片认证门禁审计 ===\n")

assert(certGate.requiresBusinessCert(certGate.CertAction.CONNECT), "对接需要名片认证")
assert(certGate.requiresBusinessCert(certGate.CertAction.MATCH), "匹配需要名片认证")
assert(certGate.requiresBusinessCert(certGate.CertAction.SUBMIT_LISTING), "发布需求/资源需要名片认证")
assert(certGate.canPromptBusinessCert(certGate.CertAction.CONNECT), "允许对接场景弹名片认证")
assert(certGate.canPromptBusinessCert(certGate.CertAction.MATCH), "允许匹配场景弹名片认证")
assert(certGate.canPromptBusinessCert(certGate.CertAction.SUBMIT_LISTING), "允许发布场景弹名片认证")
assert(certGate.submitTypeToCertAction("connect") === certGate.CertAction.CONNECT, "connect 类型映射正确")
assert(certGate.submitTypeToCertAction("match") === certGate.CertAction.MATCH, "match 类型映射正确")
assert(certGate.submitTypeToCertAction("demand") === certGate.CertAction.SUBMIT_LISTING, "demand 类型映射正确")
assert(certGate.normalizeCertAction({ scene: "connect" }) === certGate.CertAction.CONNECT, "旧 scene=connect 可识别")
assert(certGate.canPromptBusinessCert(certGate.normalizeCertAction({ scene: "connect" })), "旧 scene=connect 可弹认证")

console.log("全部认证门禁审计通过。")
