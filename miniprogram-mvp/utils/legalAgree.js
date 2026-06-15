/**
 * 协议 / 隐私 / 免责申明 — 阅读同意状态（注册前本地暂存）
 */
var legal = require("./legalContent")

var STORAGE_KEY = "legal_agreements_v1"
var READ_SECONDS = 6

function getStorage() {
  try {
    return wx.getStorageSync(STORAGE_KEY) || {}
  } catch (e) {
    return {}
  }
}

function isAgreed(type) {
  var store = getStorage()
  var doc = legal.getLegalDocument(type)
  if (!doc || !doc.version) {
    return false
  }
  var record = store[type]
  return !!(record && record.accepted && record.version === doc.version)
}

function setAgreed(type) {
  var doc = legal.getLegalDocument(type)
  var store = getStorage()
  store[type] = {
    accepted: true,
    version: doc.version,
    acceptedAt: new Date().toISOString()
  }
  wx.setStorageSync(STORAGE_KEY, store)
}

function clearAgreed(type) {
  var store = getStorage()
  delete store[type]
  wx.setStorageSync(STORAGE_KEY, store)
}

function hasAllAgreements() {
  var list = legal.getLegalDocumentList()
  for (var i = 0; i < list.length; i += 1) {
    if (!isAgreed(list[i].type)) {
      return false
    }
  }
  return true
}

function getAgreementSummary() {
  return legal.getLegalDocumentList().map(function(item) {
    return {
      type: item.type,
      title: item.title,
      label: item.label,
      agreed: isAgreed(item.type),
      statusText: isAgreed(item.type) ? "已同意" : "待阅读"
    }
  })
}

function clearAll() {
  try {
    wx.removeStorageSync(STORAGE_KEY)
  } catch (e) {
    // ignore
  }
}

function getReadSeconds() {
  return READ_SECONDS
}

module.exports = {
  getReadSeconds: getReadSeconds,
  isAgreed: isAgreed,
  setAgreed: setAgreed,
  clearAgreed: clearAgreed,
  hasAllAgreements: hasAllAgreements,
  getAgreementSummary: getAgreementSummary,
  clearAll: clearAll
}
