const cloud = require("wx-server-sdk")

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

exports.main = async function(event) {
  var code = event && event.code
  if (!code) {
    return {
      ok: false,
      message: "缺少手机号授权 code"
    }
  }

  try {
    var result = await cloud.openapi.phonenumber.getPhoneNumber({
      code: code
    })
    var phoneInfo = result.phoneInfo || result.phone_info || {}
    var phone = phoneInfo.purePhoneNumber || phoneInfo.phoneNumber || phoneInfo.phone_number
    if (!phone) {
      return {
        ok: false,
        message: "微信未返回手机号"
      }
    }
    return {
      ok: true,
      phone: phone
    }
  } catch (error) {
    return {
      ok: false,
      message: error.message || "换取手机号失败"
    }
  }
}
