const sessionKey = "compute_trade_user_session"
const localUsersKey = "compute_trade_local_users"
const MIN_PASSWORD_LEN = 8
const MAX_PASSWORD_LEN = 32

function formatDate(date) {
  function pad(value) {
    return value < 10 ? "0" + value : "" + value
  }
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes())
}

function validatePassword(password) {
  var text = String(password || "")
  if (!text) {
    return { ok: false, message: "请设置登录密码" }
  }
  if (text.length < MIN_PASSWORD_LEN) {
    return { ok: false, message: "密码至少" + MIN_PASSWORD_LEN + "位" }
  }
  if (text.length > MAX_PASSWORD_LEN) {
    return { ok: false, message: "密码不能超过" + MAX_PASSWORD_LEN + "位" }
  }
  if (!/[A-Za-z]/.test(text)) {
    return { ok: false, message: "密码需包含字母" }
  }
  if (!/\d/.test(text)) {
    return { ok: false, message: "密码需包含数字" }
  }
  return { ok: true }
}

function validatePasswordMatch(password, confirmPassword) {
  var check = validatePassword(password)
  if (!check.ok) {
    return check
  }
  if (password !== confirmPassword) {
    return { ok: false, message: "两次密码不一致" }
  }
  return { ok: true }
}

function saveSession(phone) {
  wx.setStorageSync(sessionKey, {
    loggedIn: true,
    phone: phone,
    loginAt: formatDate(new Date())
  })
}

function clearSession() {
  wx.removeStorageSync(sessionKey)
}

function isLoggedIn() {
  var session = wx.getStorageSync(sessionKey)
  return !!(session && session.loggedIn)
}

function getSessionPhone() {
  var session = wx.getStorageSync(sessionKey)
  return session && session.phone ? session.phone : ""
}

function simpleHashPassword(password, salt) {
  var str = salt + ":" + password + ":compute_trade_local"
  var hash = 0
  for (var i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return "lh_" + hash
}

function createLocalPasswordRecord(password) {
  var salt = "s_" + Date.now() + "_" + Math.floor(Math.random() * 100000)
  return {
    passwordSalt: salt,
    passwordHash: simpleHashPassword(password, salt)
  }
}

function verifyLocalPassword(password, salt, hash) {
  if (!salt || !hash) {
    return false
  }
  return simpleHashPassword(password, salt) === hash
}

function getLocalUsersMap() {
  return wx.getStorageSync(localUsersKey) || {}
}

function saveLocalUser(profile) {
  if (!profile || !profile.phone) {
    return
  }
  var map = getLocalUsersMap()
  map[profile.phone] = profile
  wx.setStorageSync(localUsersKey, map)
}

function findLocalUserByPhone(phone) {
  var map = getLocalUsersMap()
  return map[phone] || null
}

module.exports = {
  sessionKey: sessionKey,
  localUsersKey: localUsersKey,
  MIN_PASSWORD_LEN: MIN_PASSWORD_LEN,
  MAX_PASSWORD_LEN: MAX_PASSWORD_LEN,
  validatePassword: validatePassword,
  validatePasswordMatch: validatePasswordMatch,
  saveSession: saveSession,
  clearSession: clearSession,
  isLoggedIn: isLoggedIn,
  getSessionPhone: getSessionPhone,
  createLocalPasswordRecord: createLocalPasswordRecord,
  verifyLocalPassword: verifyLocalPassword,
  getLocalUsersMap: getLocalUsersMap,
  saveLocalUser: saveLocalUser,
  findLocalUserByPhone: findLocalUserByPhone
}
