function ensureCloudReady() {
  if (!wx.cloud) {
    return Promise.reject(new Error("当前微信版本过低，无法使用手机号授权"))
  }
  return Promise.resolve(true)
}

function getPhoneNumber(code) {
  return ensureCloudReady().then(function() {
    if (!code) {
      return Promise.reject(new Error("未获取到微信授权码"))
    }
    return new Promise(function(resolve, reject) {
      wx.cloud.callFunction({
        name: "getPhoneNumber",
        data: { code: code },
        success: function(res) {
          var result = res.result || {}
          if (result.ok && result.phone) {
            resolve(result.phone)
            return
          }
          reject(new Error(result.message || "获取手机号失败"))
        },
        fail: function(err) {
          var message = err && err.errMsg ? err.errMsg : "云函数调用失败"
          if (message.indexOf("Cloud API isn't enabled") > -1 || message.indexOf("cloud") > -1) {
            reject(new Error("请先在开发者工具开通云开发，并部署 getPhoneNumber 云函数"))
            return
          }
          reject(new Error(message))
        }
      })
    })
  })
}

module.exports = {
  getPhoneNumber: getPhoneNumber
}
