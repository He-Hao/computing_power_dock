/**
 * 运营权限：账号与角色一一对应，不可在同一账号内切换「常规用户 / 运营」。
 * - staffRole = manager：运营专员（审核、代发、撮合监管等）
 * - staffRole = admin：平台管理员（含 manager 全部能力 + 平台治理）
 * - 无 staffRole → 仅普通用户，发布/对接/认证等
 * 在云数据库 users 集合设置 staffRole 后重新登录生效。
 */
const C = require("./constants")
const fmt = require("./format")

const adminSessionKey = "compute_trade_admin_session"
const adminModeKey = "compute_trade_admin_mode_active"

function getUserProfile() {
  return wx.getStorageSync(C.userProfileKey) || null
}

function getStaffRole() {
  var profile = getUserProfile()
  if (!profile || !profile.staffRole || !C.staffRoleLabels[profile.staffRole]) {
    return ""
  }
  return profile.staffRole
}

function isStaffRoleAtLeast(minRole) {
  if (!minRole || !C.staffRoleRank[minRole]) {
    return false
  }
  var role = getStaffRole()
  if (!role || !C.staffRoleRank[role]) {
    return false
  }
  return C.staffRoleRank[role] >= C.staffRoleRank[minRole]
}

/** manager 与 admin 均可使用运营工作台能力 */
function isStaffUser() {
  return isStaffRoleAtLeast("manager")
}

function isPlatformAdminUser() {
  return getStaffRole() === "admin"
}

function getStaffRoleLabel() {
  var role = getStaffRole()
  if (!role) {
    return ""
  }
  return C.staffRoleLabels[role] || ""
}

function getAdminSession() {
  return wx.getStorageSync(adminSessionKey) || null
}

function isAdminModeActive() {
  return isStaffUser()
}

/** 运营账号已登录（manager / admin），非「平台管理员」专指 */
function isAdminLoggedIn() {
  return isStaffUser()
}

function enterAdminMode() {
  if (!isStaffUser()) {
    return {
      ok: false,
      message: "当前账号不是运营账号。请在云数据库 users 集合设置 staffRole 为 manager 或 admin 后重新登录。"
    }
  }
  var profile = getUserProfile()
  var session = {
    username: profile.staffRole,
    name: getStaffRoleLabel(),
    loginAt: fmt.formatDate(new Date()),
    staffMode: true
  }
  wx.setStorageSync(adminModeKey, true)
  wx.setStorageSync(adminSessionKey, session)
  return { ok: true, session: session }
}

function getAccountMode() {
  return isStaffUser() ? "staff" : "user"
}

function syncStaffSessionOnLogin() {
  if (isStaffUser()) {
    enterAdminMode()
    return "staff"
  }
  exitAdminMode()
  return "user"
}

function switchToStaffMode() {
  if (!isStaffUser()) {
    return { ok: false, message: "当前账号不是运营账号" }
  }
  return enterAdminMode()
}

function switchToUserMode() {
  if (isStaffUser()) {
    return {
      ok: false,
      message: "当前为运营账号，不能使用常规用户功能。请通过代发管理替客户录入资源或需求。"
    }
  }
  return { ok: true }
}

function ensureStaffAdminMode() {
  if (!isStaffUser()) {
    return { ok: false, message: "无运营权限" }
  }
  syncStaffSessionOnLogin()
  return { ok: true, session: getAdminSession() }
}

function exitAdminMode() {
  wx.removeStorageSync(adminModeKey)
  var session = getAdminSession()
  if (session && session.staffMode) {
    wx.removeStorageSync(adminSessionKey)
  }
}

function logoutAdmin() {
  exitAdminMode()
}

function getAdminAuthPayload() {
  return {}
}

function getAdminLoginHint() {
  return "请使用已在云端开通 staffRole 的运营账号登录。"
}

function guardStaffWorkMode(options) {
  options = options || {}
  if (!isStaffUser()) {
    if (options.toast !== false) {
      wx.showToast({ title: "无运营权限", icon: "none" })
    }
    var delay = options.toast === false ? 0 : 400
    setTimeout(function() {
      if (options.redirect === "back") {
        wx.navigateBack({
          fail: function() {
            wx.switchTab({ url: "/pages/mine/mine" })
          }
        })
        return
      }
      wx.switchTab({
        url: "/pages/mine/mine",
        fail: function() {
          wx.reLaunch({ url: "/pages/home/home" })
        }
      })
    }, delay)
    return false
  }
  syncStaffSessionOnLogin()
  return true
}

function guardStaffPageAccess(options) {
  return guardStaffWorkMode(options)
}

module.exports = {
  adminSessionKey,
  adminModeKey,
  getStaffRole,
  isStaffRoleAtLeast,
  isStaffUser,
  isPlatformAdminUser,
  getStaffRoleLabel,
  getAdminSession,
  isAdminModeActive,
  isAdminLoggedIn,
  enterAdminMode,
  ensureStaffAdminMode,
  exitAdminMode,
  logoutAdmin,
  getAdminAuthPayload,
  getAdminLoginHint,
  getAccountMode,
  syncStaffSessionOnLogin,
  switchToStaffMode,
  switchToUserMode,
  guardStaffPageAccess,
  guardStaffWorkMode
}
