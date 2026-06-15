const config = require("./config")

function getTemplateIds() {
  var templates = (config && config.subscribeTemplates) || {}
  var ids = []
  if (templates.connectStatus) {
    ids.push(templates.connectStatus)
  }
  if (templates.connectPending) {
    ids.push(templates.connectPending)
  }
  return ids.filter(function(id, index, arr) {
    return id && arr.indexOf(id) === index
  })
}

function isEnabled() {
  return getTemplateIds().length > 0
}

/**
 * 在用户点击提交对接等关键操作前请求订阅授权。
 * 模板 ID 未配置时静默跳过（不影响主流程）。
 */
function requestConnectSubscribe(options) {
  options = options || {}
  var tmplIds = options.tmplIds || getTemplateIds()
  if (!tmplIds.length) {
    return Promise.resolve({ ok: true, skipped: true, reason: "no_template" })
  }
  if (!wx.requestSubscribeMessage) {
    return Promise.resolve({ ok: true, skipped: true, reason: "api_unavailable" })
  }
  return new Promise(function(resolve) {
    wx.requestSubscribeMessage({
      tmplIds: tmplIds.slice(0, 3),
      success: function(res) {
        resolve({ ok: true, skipped: false, result: res })
      },
      fail: function(err) {
        resolve({
          ok: true,
          skipped: true,
          reason: (err && err.errMsg) || "user_denied",
          error: err
        })
      }
    })
  })
}

function getSetupHint() {
  if (isEnabled()) {
    return ""
  }
  return "对接进度提醒：在 utils/config.js 的 subscribeTemplates 中填写微信订阅消息模板 ID 后启用。"
}

module.exports = {
  isEnabled,
  getTemplateIds,
  requestConnectSubscribe,
  getSetupHint
}
