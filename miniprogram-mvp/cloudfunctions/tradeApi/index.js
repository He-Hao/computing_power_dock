const cloud = require("wx-server-sdk")
const crypto = require("crypto")

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

const COL_USERS = "users"
const COL_LISTINGS = "listings"
const COL_SUBMISSIONS = "submissions"
const COL_FAVORITES_LEGACY = "favorites"
const MAX_FAVORITES = 200

const PROFILE_ALLOWED_FIELDS = [
  "company",
  "creditCode",
  "role",
  "region",
  "contact",
  "email",
  "website",
  "description",
  "onboardingCompleted",
  "userIntent",
  "onboardingCompletedAt",
  "certStatus",
  "certLevel",
  "certSubmittedAt",
  "certVerifiedAt",
  "licenseUpgradeSubmittedAt"
]

/** 客户端 updateProfile 允许写入的字段（认证终态仅服务端/审核写入） */
const PROFILE_CLIENT_PATCH_FIELDS = [
  "company",
  "creditCode",
  "role",
  "region",
  "contact",
  "email",
  "website",
  "description",
  "onboardingCompleted",
  "userIntent",
  "onboardingCompletedAt",
  "certSubmittedAt",
  "licenseUpgradeSubmittedAt"
]

const STAFF_PHONE_WHITELIST = []

const STAFF_ROLE_LABELS = {
  manager: "运营专员",
  admin: "平台管理员"
}

const STAFF_ROLE_RANK = {
  manager: 1,
  admin: 2
}

function createPasswordRecord(password) {
  var salt = crypto.randomBytes(16).toString("hex")
  var hash = crypto.pbkdf2Sync(String(password), salt, 10000, 64, "sha512").toString("hex")
  return {
    passwordSalt: salt,
    passwordHash: hash
  }
}

function verifyPassword(password, salt, hash) {
  if (!password || !salt || !hash) {
    return false
  }
  var check = crypto.pbkdf2Sync(String(password), salt, 10000, 64, "sha512").toString("hex")
  return check === hash
}

var MIN_PASSWORD_LEN = 8
var MAX_PASSWORD_LEN = 32

function validatePasswordComplexity(password) {
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

function sanitizeUserProfile(profile, openid) {
  var next = Object.assign({}, profile || {})
  delete next.passwordHash
  delete next.passwordSalt
  if (profile && profile._id) {
    next.userId = profile._id
  }
  delete next._id
  delete next.favoriteResources
  delete next.favoriteDemands
  delete next.favoritesUpdatedAt
  if (openid) {
    next.openid = openid
  }
  if (next.staffRole && !STAFF_ROLE_LABELS[next.staffRole]) {
    delete next.staffRole
  }
  return next
}

function normalizeStaffRole(role) {
  return STAFF_ROLE_LABELS[role] ? role : ""
}

function isStaffRoleAtLeast(minRole, userRole) {
  if (!normalizeStaffRole(minRole)) {
    return false
  }
  var role = normalizeStaffRole(userRole)
  if (!role) {
    return false
  }
  return STAFF_ROLE_RANK[role] >= STAFF_ROLE_RANK[minRole]
}

async function applyStaffRoleIfEligible(user) {
  if (!user || !user._id) {
    return user
  }
  if (normalizeStaffRole(user.staffRole)) {
    return user
  }
  var phone = String(user.phone || "").trim()
  if (!phone) {
    return user
  }
  var shouldPromote = false
  for (var i = 0; i < STAFF_PHONE_WHITELIST.length; i += 1) {
    if (STAFF_PHONE_WHITELIST[i] === phone) {
      shouldPromote = true
      break
    }
  }
  if (!shouldPromote) {
    return user
  }
  await db.collection(COL_USERS).doc(user._id).update({
    data: {
      staffRole: "manager",
      updatedAt: formatDate(new Date())
    }
  })
  return Object.assign({}, user, { staffRole: "manager" })
}

// 云函数容器默认 UTC；业务展示统一按北京时间（东八区）
var CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000

function padDatePart(value) {
  return value < 10 ? "0" + value : "" + value
}

function toChinaWallClock(date) {
  var d = date || new Date()
  return new Date(d.getTime() + CHINA_TZ_OFFSET_MS)
}

function formatDate(date) {
  var china = toChinaWallClock(date)
  return china.getUTCFullYear() + "-" + padDatePart(china.getUTCMonth() + 1) + "-" + padDatePart(china.getUTCDate())
    + " " + padDatePart(china.getUTCHours()) + ":" + padDatePart(china.getUTCMinutes())
}

function formatDateOnly(date) {
  var china = toChinaWallClock(date)
  return china.getUTCFullYear() + "-" + padDatePart(china.getUTCMonth() + 1) + "-" + padDatePart(china.getUTCDate())
}

function isListingClosed(item) {
  return !!(item && (item.status === "closed" || item.verification === "已关闭"))
}

function isListingPendingReview(item) {
  return !!(item && item.verification === "待审核")
}

function isListingPubliclyVisible(item) {
  if (!item || isListingClosed(item)) {
    return false
  }
  if (isListingPendingReview(item)) {
    return false
  }
  if (item.publicDisplay === false) {
    return false
  }
  return true
}

function buildApprovedListingUpdate(listing) {
  var verification = listing.pool === "resource" ? "资源已初审" : "需求已初审"
  var highlights = (listing.highlights || []).map(function(item) {
    return item === "待平台核验" ? "平台已初审" : item
  })
  return {
    verification: verification,
    matchScore: computeListingQualityScore(listing),
    highlights: highlights.length ? highlights : ["平台已初审"],
    publishedAt: formatDate(new Date())
  }
}

function computeListingQualityScore(listing) {
  if (!listing) {
    return 0
  }
  var score = 28
  if (listing.title && listing.title.length >= 4) {
    score += 8
  }
  if (listing.type) {
    score += 6
  }
  if (listing.region) {
    score += 8
  }
  var summary = String(listing.summary || "").trim()
  if (summary.length >= 20) {
    score += 10
  } else if (summary.length >= 8) {
    score += 5
  }
  if (listing.scale) {
    score += 6
  }
  if (listing.price || listing.budget) {
    score += 5
  }
  if (listing.details && listing.details.length >= 3) {
    score += 6
  }
  if (listing.highlights && listing.highlights.length >= 2) {
    score += 4
  }
  if (listing.publisherCertLevel === "license") {
    score += 10
  } else if (listing.publisherCertLevel === "card") {
    score += 5
  }
  if (listing.verification && listing.verification.indexOf("已初审") > -1) {
    score += 4
  }
  return Math.min(100, Math.max(0, Math.round(score)))
}

function isResourceId(id) {
  return id && (id.indexOf("RES-") === 0 || id.indexOf("URES-") === 0)
}

function isDemandId(id) {
  return id && (id.indexOf("UDEM-") === 0 || id.indexOf("DEM-") === 0)
}

function pickProfilePatch(payload) {
  var patch = {}
  if (!payload || typeof payload !== "object") {
    return patch
  }
  for (var i = 0; i < PROFILE_CLIENT_PATCH_FIELDS.length; i += 1) {
    var key = PROFILE_CLIENT_PATCH_FIELDS[i]
    if (payload[key] === undefined) {
      continue
    }
    patch[key] = payload[key]
  }
  if (payload.certStatus === "pending") {
    patch.certStatus = "pending"
  }
  return patch
}

function compareUpdatedAt(left, right) {
  var a = left ? String(left) : ""
  var b = right ? String(right) : ""
  if (!a && !b) {
    return 0
  }
  if (!a) {
    return -1
  }
  if (!b) {
    return 1
  }
  return a.localeCompare(b)
}

function protectProfileCertFields(patch, existing) {
  if (!patch || !existing) {
    return patch
  }
  if (existing.certStatus === "verified") {
    delete patch.certStatus
    delete patch.certLevel
    delete patch.certVerifiedAt
    delete patch.certSubmittedAt
  }
  if (patch.certStatus === "rejected") {
    delete patch.certStatus
    delete patch.certLevel
  }
  if (patch.certStatus === "verified") {
    delete patch.certStatus
    delete patch.certLevel
    delete patch.certVerifiedAt
  }
  return patch
}

function splitListings(listings) {
  var activeListings = (listings || []).filter(function(item) {
    return !isListingClosed(item)
  })
  var resources = activeListings.filter(function(item) {
    return item.pool === "resource" || isResourceId(item.id)
  })
  var demands = activeListings.filter(function(item) {
    return item.pool === "demand" || isDemandId(item.id)
  })
  return {
    resources: resources,
    demands: demands
  }
}

function normalizePhone(phone) {
  return String(phone || "").trim()
}

async function collectUsersByOpenid(openid) {
  if (!openid) {
    return []
  }
  var map = {}
  var byBind = await db.collection(COL_USERS).where({ openid: openid }).get()
  ;(byBind.data || []).forEach(function(item) {
    if (item && item._id) {
      map[item._id] = item
    }
  })
  var bySystem = await db.collection(COL_USERS).where({ _openid: openid }).get()
  ;(bySystem.data || []).forEach(function(item) {
    if (item && item._id) {
      map[item._id] = item
    }
  })
  return Object.keys(map).map(function(key) {
    return map[key]
  })
}

function pickLatestLoggedInUser(users) {
  var list = (users || []).filter(function(item) {
    return item && item._id
  })
  if (!list.length) {
    return null
  }
  if (list.length === 1) {
    return list[0]
  }
  list.sort(function(a, b) {
    return compareUpdatedAt(b.lastLoginAt || b.updatedAt || "", a.lastLoginAt || a.updatedAt || "")
  })
  return list[0]
}

async function getUserByOpenid(openid) {
  if (!openid) {
    return null
  }
  var byBind = await db.collection(COL_USERS).where({ openid: openid }).get()
  var bound = (byBind.data || []).filter(function(item) {
    return item && item.openid === openid
  })
  return pickLatestLoggedInUser(bound)
}

function maskPhoneCloud(phone) {
  var text = String(phone || "").trim()
  if (text.length < 7) {
    return text
  }
  return text.slice(0, 3) + "****" + text.slice(-4)
}

/** 本机微信用户（openid 为唯一身份，一 openid 仅绑定一个手机号） */
async function getDeviceActiveUser(openid) {
  return getUserByOpenid(openid)
}

function isBindConfirmAccepted(payload) {
  payload = payload || {}
  return payload.confirmChangePhone === true
    || payload.confirmRebind === true
    || payload.confirmSwitch === true
}

function buildPhoneBindConflict(kind, message, data) {
  return {
    ok: false,
    needSwitch: true,
    needChangePhone: kind === "change",
    needRebind: kind === "rebind",
    message: message,
    data: data || {}
  }
}

/** 会话用户：以 openid 为准（全局用户标识） */
async function resolveSessionUser(openid, payload) {
  if (!openid) {
    return null
  }
  var user = await getUserByOpenid(openid)
  if (!user || !user._id) {
    return null
  }
  var disabledCheck = assertActiveUserAccount(user)
  if (!disabledCheck.ok) {
    return null
  }
  return user
}

async function getUserByPhone(phone) {
  var normalized = normalizePhone(phone)
  if (!normalized) {
    return null
  }
  var res = await db.collection(COL_USERS).where({ phone: normalized }).limit(1).get()
  return res.data && res.data[0] ? res.data[0] : null
}

/** 将手机号从其它 openid 账号解绑，保证一手机号仅归属一个 openid */
async function releasePhoneFromOtherOpenid(phone, keepOpenid) {
  var normalized = normalizePhone(phone)
  if (!normalized || !keepOpenid) {
    return
  }
  var res = await db.collection(COL_USERS).where({ phone: normalized }).get()
  for (var i = 0; i < (res.data || []).length; i += 1) {
    var entry = res.data[i]
    if (!entry || !entry._id) {
      continue
    }
    if (String(entry.openid || "").trim() === keepOpenid) {
      continue
    }
    await db.collection(COL_USERS).doc(entry._id).update({
      data: {
        phone: _.remove(),
        phoneVerified: false,
        updatedAt: formatDate(new Date())
      }
    })
  }
}

async function dedupeOpenidUsers(openid, keepDocId) {
  var users = await collectUsersByOpenid(openid)
  for (var i = 0; i < users.length; i += 1) {
    var entry = users[i]
    if (!entry || !entry._id || entry._id === keepDocId) {
      continue
    }
    await db.collection(COL_USERS).doc(entry._id).update({
      data: {
        openid: "",
        updatedAt: formatDate(new Date())
      }
    })
  }
}

async function touchUserLogin(user) {
  if (!user || !user._id) {
    return user
  }
  var now = formatDate(new Date())
  await db.collection(COL_USERS).doc(user._id).update({
    data: {
      lastLoginAt: now,
      updatedAt: now
    }
  })
  return Object.assign({}, user, { lastLoginAt: now, updatedAt: now })
}

/** 启动/拉取前校验：当前 openid 须已绑定手机号 */
async function validateDeviceSession(openid, payload) {
  var user = await getUserByOpenid(openid)
  if (!user || !user._id) {
    return {
      ok: false,
      message: "尚未绑定手机号",
      sessionInvalid: true,
      needBindPhone: true
    }
  }
  if (!normalizePhone(user.phone) || !user.phoneVerified) {
    return {
      ok: false,
      message: "尚未完成手机号绑定",
      sessionInvalid: true,
      needBindPhone: true
    }
  }
  var disabledCheck = assertActiveUserAccount(user)
  if (!disabledCheck.ok) {
    return disabledCheck
  }
  user = await applyStaffRoleIfEligible(Object.assign({}, user, { _id: user._id }))
  user = await touchUserLogin(user)
  return {
    ok: true,
    data: {
      userProfile: sanitizeUserProfile(user, openid),
      rebound: false
    }
  }
}

/** @deprecated 兼容旧客户端，行为同 validateDeviceSession */
async function ensureOpenidBound(openid, payload) {
  return validateDeviceSession(openid, payload)
}

function submissionBelongsToPhone(submission, userPhone) {
  if (!submission || !userPhone) {
    return false
  }
  if (submission.ownerPhone && submission.ownerPhone === userPhone) {
    return true
  }
  if (submission.phone && submission.phone === userPhone) {
    return true
  }
  return false
}

function incomingConnectBelongsToPhone(submission, userPhone) {
  if (!submission || submission.type !== "connect" || !userPhone) {
    return false
  }
  if (submission.targetOwnerPhone && submission.targetOwnerPhone === userPhone) {
    return true
  }
  return false
}

async function incomingConnectBelongsToUser(submission, openid, userPhone) {
  return userIsConnectRecipient(openid, userPhone, submission)
}

async function getListingOwnerPhoneCloud(listingId) {
  if (!listingId) {
    return ""
  }
  var listing = await getListingById(listingId)
  if (!listing) {
    return ""
  }
  var phone = listing.actualOwnerPhone || listing.ownerPhone || listing.phone || ""
  if (phone) {
    return phone
  }
  if (listing.submissionId) {
    var publishSubmission = await getSubmissionById(listing.submissionId)
    if (publishSubmission) {
      return publishSubmission.actualOwnerPhone || publishSubmission.ownerPhone || publishSubmission.phone || ""
    }
  }
  return ""
}

async function getConnectRecipientPhoneCloud(submission) {
  if (!submission || submission.type !== "connect") {
    return ""
  }
  if (!submission.targetId) {
    return submission.targetOwnerPhone || ""
  }
  var ownerPhone = await getListingOwnerPhoneCloud(submission.targetId)
  if (ownerPhone) {
    return ownerPhone
  }
  return submission.targetOwnerPhone || ""
}

async function userIsConnectRecipient(openid, userPhone, submission) {
  if (!submission || submission.type !== "connect") {
    return false
  }
  var recipientPhone = await getConnectRecipientPhoneCloud(submission)
  if (userPhone && recipientPhone && userPhone === recipientPhone) {
    return true
  }
  if (openid && submission.targetOwnerOpenid === openid) {
    return true
  }
  if (userPhone && submission.targetOwnerPhone && submission.targetOwnerPhone === userPhone) {
    return true
  }
  if (!submission.targetId) {
    return false
  }
  var targetListing = await getListingById(submission.targetId)
  if (!targetListing) {
    return false
  }
  if (openid && targetListing.ownerOpenid === openid) {
    return true
  }
  if (userPhone && recipientPhone) {
    var ownerUser = await getUserByPhone(recipientPhone)
    if (ownerUser && ownerUser.openid === openid) {
      return true
    }
  }
  return false
}

function mergeSubmissionIntoMap(map, item) {
  if (!item || !item.id) {
    return
  }
  var existing = map[item.id]
  if (!existing) {
    map[item.id] = item
    return
  }
  var existingTime = existing.updatedAt || existing.createdAt || ""
  var itemTime = item.updatedAt || item.createdAt || ""
  if (compareUpdatedAt(itemTime, existingTime) >= 0) {
    map[item.id] = item
  }
}

function sortSubmissionsByRecent(list) {
  return (list || []).slice().sort(function(a, b) {
    var ta = a.updatedAt || a.createdAt || ""
    var tb = b.updatedAt || b.createdAt || ""
    return tb.localeCompare(ta)
  })
}

function isLoginLocked(user) {
  if (!user || !user.loginLockedUntil) {
    return false
  }
  var lockedUntil = Date.parse(user.loginLockedUntil)
  if (!lockedUntil || lockedUntil <= Date.now()) {
    return false
  }
  return true
}

function loginLockRemainingMinutes(user) {
  if (!isLoginLocked(user)) {
    return 0
  }
  var lockedUntil = Date.parse(user.loginLockedUntil)
  return Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000))
}

async function recordLoginFailure(user) {
  if (!user || !user._id) {
    return
  }
  var attempts = (user.loginFailCount || 0) + 1
  var patch = {
    loginFailCount: attempts,
    updatedAt: formatDate(new Date())
  }
  if (attempts >= LOGIN_MAX_FAIL_ATTEMPTS) {
    patch.loginLockedUntil = new Date(Date.now() + LOGIN_LOCKOUT_MINUTES * 60000).toISOString()
  }
  await db.collection(COL_USERS).doc(user._id).update({ data: patch })
}

async function clearLoginFailures(user) {
  if (!user || !user._id) {
    return
  }
  if (!user.loginFailCount && !user.loginLockedUntil) {
    return
  }
  await db.collection(COL_USERS).doc(user._id).update({
    data: {
      loginFailCount: _.remove(),
      loginLockedUntil: _.remove(),
      updatedAt: formatDate(new Date())
    }
  })
}

function syncConnectQuery(where) {
  return db.collection(COL_SUBMISSIONS).where(where)
    .orderBy("updatedAt", "desc")
    .limit(SYNC_CONNECT_LIMIT)
    .get()
    .catch(function(err) {
      console.warn("syncConnectQuery orderBy fallback", err && err.message)
      return db.collection(COL_SUBMISSIONS).where(where)
        .limit(SYNC_CONNECT_LIMIT)
        .get()
    })
}

function syncOwnSubmissionQuery(where) {
  return db.collection(COL_SUBMISSIONS).where(where)
    .orderBy("updatedAt", "desc")
    .limit(SYNC_OWN_SUBMISSION_LIMIT)
    .get()
    .catch(function(err) {
      console.warn("syncOwnSubmissionQuery orderBy fallback", err && err.message)
      return db.collection(COL_SUBMISSIONS).where(where)
        .limit(SYNC_OWN_SUBMISSION_LIMIT)
        .get()
    })
}

async function assertDailyConnectQuota(user) {
  if (!user || !user.phone) {
    return { ok: true }
  }
  var today = formatDateOnly(new Date())
  var res = await db.collection(COL_SUBMISSIONS).where({
    type: "connect",
    ownerPhone: user.phone,
    createdAt: db.RegExp({
      regexp: "^" + today.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      options: "i"
    })
  }).count()
  var count = res && res.total ? res.total : 0
  if (count >= DAILY_CONNECT_SUBMIT_LIMIT) {
    return {
      ok: false,
      message: "今日对接申请已达上限（" + DAILY_CONNECT_SUBMIT_LIMIT + " 次），请明日再试或联系平台运营"
    }
  }
  return { ok: true }
}

const SYNC_CONNECT_LIMIT = 200
const SYNC_OWN_SUBMISSION_LIMIT = 300
const SYNC_LITE_OWN = 80
const SYNC_LITE_CONNECT = 50
const SYNC_LITE_LISTINGS = 40

const LOGIN_MAX_FAIL_ATTEMPTS = 5
const LOGIN_LOCKOUT_MINUTES = 15
const DAILY_CONNECT_SUBMIT_LIMIT = 30
const LISTINGS_FETCH_BATCH = 100
const LISTINGS_FETCH_MAX = 1000

/** 正式上线须保持 false；仅开发/冷启动时在云函数环境变量 DEMO_SEED_TOOLS_ENABLED=true 临时开启 */
const DEMO_SEED_TOOLS_ENABLED = process.env.DEMO_SEED_TOOLS_ENABLED === "true"

async function upsertUser(openid, patch) {
  if (!openid) {
    return null
  }
  var existing = await getUserByOpenid(openid)
  var next = Object.assign({}, existing || {}, patch || {}, {
    openid: openid,
    updatedAt: formatDate(new Date())
  })
  delete next._id
  if (existing && existing._id) {
    await db.collection(COL_USERS).doc(existing._id).update({ data: next })
    return next
  }
  next.createdAt = formatDate(new Date())
  await db.collection(COL_USERS).add({ data: next })
  return next
}

async function upsertUserByPhone(phone, openid, patch) {
  var normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) {
    return null
  }
  var existing = await getUserByPhone(normalizedPhone)
  var next = Object.assign({}, existing || {}, patch || {}, {
    phone: normalizedPhone,
    updatedAt: formatDate(new Date())
  })
  if (openid) {
    next.openid = openid
  }
  delete next._id
  if (existing && existing._id) {
    await db.collection(COL_USERS).doc(existing._id).update({ data: next })
    return next
  }
  next.createdAt = formatDate(new Date())
  await db.collection(COL_USERS).add({ data: next })
  return next
}

async function getListingById(id) {
  var res = await db.collection(COL_LISTINGS).where({ id: id }).limit(1).get()
  return res.data && res.data[0] ? res.data[0] : null
}

async function getListingsByIds(ids) {
  var map = {}
  var unique = []
  var seen = {}
  ;(ids || []).forEach(function(id) {
    if (id && !seen[id]) {
      seen[id] = true
      unique.push(id)
    }
  })
  for (var i = 0; i < unique.length; i += 10) {
    var chunk = unique.slice(i, i + 10)
    if (!chunk.length) {
      continue
    }
    var res = await db.collection(COL_LISTINGS).where({ id: _.in(chunk) }).get()
    ;(res.data || []).forEach(function(item) {
      if (item && item.id) {
        map[item.id] = item
      }
    })
  }
  return map
}

function collectConnectListingIds(submissions) {
  var ids = []
  var seen = {}
  ;(submissions || []).forEach(function(item) {
    if (!item || item.type !== "connect") {
      return
    }
    ;[item.targetId, item.sourceListingId].forEach(function(id) {
      if (id && !seen[id]) {
        seen[id] = true
        ids.push(id)
      }
    })
  })
  return ids
}

async function mergeConnectLinkedListings(ownListings, submissions) {
  var connectIds = collectConnectListingIds(submissions)
  if (!connectIds.length) {
    return ownListings || []
  }
  var ownMap = {}
  ;(ownListings || []).forEach(function(item) {
    if (item && item.id) {
      ownMap[item.id] = item
    }
  })
  var missingIds = connectIds.filter(function(id) {
    return !ownMap[id]
  })
  if (!missingIds.length) {
    return ownListings || []
  }
  var linkedMap = await getListingsByIds(missingIds)
  missingIds.forEach(function(id) {
    if (linkedMap[id]) {
      ownMap[id] = linkedMap[id]
    }
  })
  return Object.keys(ownMap).map(function(key) {
    return ownMap[key]
  })
}

async function getSubmissionsByIds(ids) {
  var map = {}
  var unique = []
  var seen = {}
  ;(ids || []).forEach(function(id) {
    if (id && !seen[id]) {
      seen[id] = true
      unique.push(id)
    }
  })
  for (var i = 0; i < unique.length; i += 10) {
    var chunk = unique.slice(i, i + 10)
    if (!chunk.length) {
      continue
    }
    var res = await db.collection(COL_SUBMISSIONS).where({ id: _.in(chunk) }).get()
    ;(res.data || []).forEach(function(item) {
      if (item && item.id) {
        map[item.id] = item
      }
    })
  }
  return map
}

function getConnectRecipientPhoneCached(submission, listingMap, publishSubmissionMap) {
  if (!submission || submission.type !== "connect") {
    return ""
  }
  if (!submission.targetId) {
    return submission.targetOwnerPhone || ""
  }
  var listing = listingMap[submission.targetId]
  if (listing) {
    var phone = listing.actualOwnerPhone || listing.ownerPhone || listing.phone || ""
    if (phone) {
      return phone
    }
    if (listing.submissionId) {
      var publishSubmission = publishSubmissionMap[listing.submissionId]
      if (publishSubmission) {
        return publishSubmission.actualOwnerPhone || publishSubmission.ownerPhone || publishSubmission.phone || ""
      }
    }
  }
  return submission.targetOwnerPhone || ""
}

function fastIncomingConnectMatch(submission, openid, userPhone) {
  if (!submission || submission.type !== "connect") {
    return false
  }
  if (openid && submission.targetOwnerOpenid === openid) {
    return true
  }
  if (userPhone && submission.targetOwnerPhone && submission.targetOwnerPhone === userPhone) {
    return true
  }
  return false
}

function incomingConnectBelongsToUserCached(submission, openid, userPhone, listingMap, publishSubmissionMap) {
  if (fastIncomingConnectMatch(submission, openid, userPhone)) {
    return true
  }
  var recipientPhone = getConnectRecipientPhoneCached(submission, listingMap, publishSubmissionMap)
  if (userPhone && recipientPhone && userPhone === recipientPhone) {
    return true
  }
  if (!submission.targetId) {
    return false
  }
  var targetListing = listingMap[submission.targetId]
  if (!targetListing) {
    return false
  }
  if (openid && targetListing.ownerOpenid === openid) {
    return true
  }
  return false
}

async function filterIncomingConnectForUser(candidates, openid, userPhone) {
  var incomingConnect = []
  var needDeepCheck = []
  ;(candidates || []).forEach(function(item) {
    if (fastIncomingConnectMatch(item, openid, userPhone)) {
      incomingConnect.push(item)
    } else {
      needDeepCheck.push(item)
    }
  })
  if (!needDeepCheck.length) {
    return incomingConnect
  }
  var targetIds = needDeepCheck.map(function(item) {
    return item.targetId
  }).filter(Boolean)
  var listingMap = await getListingsByIds(targetIds)
  var publishSubmissionIds = []
  Object.keys(listingMap).forEach(function(listingId) {
    var listing = listingMap[listingId]
    if (listing && listing.submissionId) {
      publishSubmissionIds.push(listing.submissionId)
    }
  })
  var publishSubmissionMap = await getSubmissionsByIds(publishSubmissionIds)
  needDeepCheck.forEach(function(item) {
    if (incomingConnectBelongsToUserCached(item, openid, userPhone, listingMap, publishSubmissionMap)) {
      incomingConnect.push(item)
    }
  })
  return incomingConnect
}

async function getSubmissionById(id) {
  var res = await db.collection(COL_SUBMISSIONS).where({ id: id }).limit(1).get()
  return res.data && res.data[0] ? res.data[0] : null
}

async function saveListingDoc(listing) {
  var existing = await getListingById(listing.id)
  if (existing) {
    var existingTime = existing.updatedAt || existing.createdAt || ""
    var incomingTime = listing.updatedAt || listing.createdAt || ""
    if (existingTime && incomingTime && compareUpdatedAt(incomingTime, existingTime) < 0) {
      return existing
    }
  }
  var data = Object.assign({}, existing || {}, listing, { updatedAt: formatDate(new Date()) })
  delete data._id
  if (existing && existing._id) {
    await db.collection(COL_LISTINGS).doc(existing._id).update({ data: data })
    return data
  }
  data.createdAt = data.createdAt || formatDate(new Date())
  await db.collection(COL_LISTINGS).add({ data: data })
  return data
}

async function saveSubmissionDoc(submission) {
  var existing = await getSubmissionById(submission.id)
  if (existing) {
    var existingTime = existing.updatedAt || existing.createdAt || ""
    var incomingTime = submission.updatedAt || submission.createdAt || ""
    if (existingTime && incomingTime && compareUpdatedAt(incomingTime, existingTime) < 0) {
      return existing
    }
  }
  var data = Object.assign({}, existing || {}, submission, { updatedAt: formatDate(new Date()) })
  delete data._id
  if (existing && existing._id) {
    await db.collection(COL_SUBMISSIONS).doc(existing._id).update({ data: data })
    return data
  }
  data.createdAt = data.createdAt || formatDate(new Date())
  await db.collection(COL_SUBMISSIONS).add({ data: data })
  return data
}

async function removeListingById(id) {
  var existing = await getListingById(id)
  if (!existing || !existing._id) {
    return false
  }
  await db.collection(COL_LISTINGS).doc(existing._id).remove()
  return true
}

async function removeSubmissionById(id) {
  var existing = await getSubmissionById(id)
  if (!existing || !existing._id) {
    return false
  }
  await db.collection(COL_SUBMISSIONS).doc(existing._id).remove()
  return true
}

function isResourceListingId(listingId) {
  var id = String(listingId || "")
  return id.indexOf("RES-") === 0 || id.indexOf("URES-") === 0
}

function getFavoritePoolKey(listingId) {
  return isResourceListingId(listingId) ? "resources" : "demands"
}

function normalizeFavoriteIds(list) {
  var seen = {}
  var result = []
  ;(list || []).forEach(function(id) {
    if (!id || seen[id]) {
      return
    }
    seen[id] = true
    result.push(id)
  })
  return result
}

function emptyFavoritesStore() {
  return { resources: [], demands: [] }
}

function formatFavoriteTimestamp(date) {
  var d = date || new Date()
  var pad = function(n) {
    return n < 10 ? "0" + n : String(n)
  }
  return d.getFullYear() + "-"
    + pad(d.getMonth() + 1) + "-"
    + pad(d.getDate()) + " "
    + pad(d.getHours()) + ":"
    + pad(d.getMinutes())
}

function sanitizeFavoritesStore(raw) {
  if (!raw || typeof raw !== "object") {
    return emptyFavoritesStore()
  }
  return {
    resources: normalizeFavoriteIds(raw.resources).slice(0, MAX_FAVORITES),
    demands: normalizeFavoriteIds(raw.demands).slice(0, MAX_FAVORITES)
  }
}

function extractFavoritesFromUser(user) {
  if (!user) {
    return emptyFavoritesStore()
  }
  return sanitizeFavoritesStore({
    resources: user.favoriteResources,
    demands: user.favoriteDemands
  })
}

function userHasEmbeddedFavorites(user) {
  return !!(user && (
    user.favoritesUpdatedAt
    || Array.isArray(user.favoriteResources)
    || Array.isArray(user.favoriteDemands)
  ))
}

async function getLegacyFavoritesDoc(openid, phone) {
  try {
    if (phone) {
      var byPhone = await db.collection(COL_FAVORITES_LEGACY).where({ phone: phone }).limit(1).get()
      if (byPhone.data && byPhone.data.length) {
        return byPhone.data[0]
      }
    }
    if (openid) {
      var byOpenid = await db.collection(COL_FAVORITES_LEGACY).where({ ownerOpenid: openid }).limit(1).get()
      if (byOpenid.data && byOpenid.data.length) {
        return byOpenid.data[0]
      }
    }
  } catch (legacyError) {
    console.warn("legacy favorites lookup skipped", legacyError)
  }
  return null
}

async function removeLegacyFavoritesDoc(doc) {
  if (!doc || !doc._id) {
    return
  }
  try {
    await db.collection(COL_FAVORITES_LEGACY).doc(doc._id).remove()
  } catch (cleanupError) {
    console.warn("legacy favorites cleanup failed", cleanupError)
  }
}

async function saveFavoritesToUser(openid, phone, store) {
  if (!openid) {
    return sanitizeFavoritesStore(store)
  }
  var nextStore = sanitizeFavoritesStore(store)
  await upsertUserByPhone(phone || "", openid, {
    favoriteResources: nextStore.resources,
    favoriteDemands: nextStore.demands,
    favoritesUpdatedAt: formatFavoriteTimestamp(new Date())
  })
  return nextStore
}

async function fetchFavoritesForUser(openid, phone) {
  var user = phone ? await getUserByPhone(phone) : null
  if (!user) {
    user = await getUserByOpenid(openid)
  }
  if (userHasEmbeddedFavorites(user)) {
    return extractFavoritesFromUser(user)
  }
  var legacyDoc = await getLegacyFavoritesDoc(openid, phone)
  if (legacyDoc) {
    var migrated = sanitizeFavoritesStore(legacyDoc)
    if (openid) {
      await saveFavoritesToUser(openid, phone, migrated)
      await removeLegacyFavoritesDoc(legacyDoc)
    }
    return migrated
  }
  return emptyFavoritesStore()
}

async function setFavoriteForUser(openid, phone, listingId, favorited) {
  if (!listingId) {
    return { ok: false, message: "缺少商机编号" }
  }
  if (!phone) {
    return { ok: false, message: "请先完成注册" }
  }
  var store = await fetchFavoritesForUser(openid, phone)
  var poolKey = getFavoritePoolKey(listingId)
  var list = store[poolKey].slice()
  var index = list.indexOf(listingId)
  if (favorited && index === -1) {
    list.unshift(listingId)
  } else if (!favorited && index > -1) {
    list.splice(index, 1)
  }
  store[poolKey] = normalizeFavoriteIds(list).slice(0, MAX_FAVORITES)
  var saved = await saveFavoritesToUser(openid, phone, store)
  return {
    ok: true,
    data: {
      favorited: !!favorited,
      favorites: saved
    }
  }
}

async function toggleFavoriteCloud(openid, payload) {
  payload = payload || {}
  var user = await resolveSessionUser(openid, payload)
  if (!user || !user.registered || !user.phone) {
    return { ok: false, message: "请先完成注册" }
  }
  var favoriteActiveCheck = assertActiveUserAccount(user)
  if (!favoriteActiveCheck.ok) {
    return favoriteActiveCheck
  }
  var listingId = String(payload.listingId || "").trim()
  if (!listingId) {
    return { ok: false, message: "缺少商机编号" }
  }
  if (typeof payload.favorited !== "boolean") {
    return { ok: false, message: "收藏状态无效" }
  }
  return setFavoriteForUser(openid, user.phone, listingId, payload.favorited)
}

async function mergeFavoritesFromMigrate(openid, phone, localStore) {
  if (!phone || !localStore) {
    return emptyFavoritesStore()
  }
  var remote = await fetchFavoritesForUser(openid, phone)
  var merged = {
    resources: normalizeFavoriteIds((remote.resources || []).concat(localStore.resources || [])).slice(0, MAX_FAVORITES),
    demands: normalizeFavoriteIds((remote.demands || []).concat(localStore.demands || [])).slice(0, MAX_FAVORITES)
  }
  if (
    merged.resources.length === (remote.resources || []).length
    && merged.demands.length === (remote.demands || []).length
    && (localStore.resources || []).length === 0
    && (localStore.demands || []).length === 0
  ) {
    return remote
  }
  return saveFavoritesToUser(openid, phone, merged)
}

async function removeAllByWhere(collectionName, where) {
  var removed = 0
  var round = 0
  while (round < 50) {
    var res = await db.collection(collectionName).where(where).limit(20).get()
    var docs = res.data || []
    if (!docs.length) {
      break
    }
    for (var i = 0; i < docs.length; i += 1) {
      await db.collection(collectionName).doc(docs[i]._id).remove()
      removed += 1
    }
    round += 1
  }
  return removed
}

async function healEmptyOpenidBinding(user, openid) {
  return user
}

async function syncDataLite(openid, payload) {
  payload = payload || {}
  try {
    var user = await resolveSessionUser(openid, payload)
    if (user) {
      user = await healEmptyOpenidBinding(user, openid)
      user = await applyStaffRoleIfEligible(user)
    }
    var userPhone = user ? user.phone : ""

    function safeQuery(promise) {
      return promise.catch(function(error) {
        console.warn("sync lite query failed", error)
        return { data: [] }
      })
    }

    var queries = [
      safeQuery(db.collection(COL_SUBMISSIONS).where({ ownerOpenid: openid }).limit(SYNC_LITE_OWN).get()),
      safeQuery(db.collection(COL_SUBMISSIONS).where({
        type: "connect",
        targetOwnerOpenid: openid
      }).limit(SYNC_LITE_CONNECT).get()),
      safeQuery(db.collection(COL_LISTINGS).where({ ownerOpenid: openid }).limit(SYNC_LITE_LISTINGS).get())
    ]
    if (userPhone) {
      queries.push(
        safeQuery(db.collection(COL_SUBMISSIONS).where({ ownerPhone: userPhone }).limit(SYNC_LITE_OWN).get()),
        safeQuery(db.collection(COL_SUBMISSIONS).where({ type: "connect", phone: userPhone }).limit(SYNC_LITE_CONNECT).get()),
        safeQuery(db.collection(COL_SUBMISSIONS).where({ type: "connect", ownerPhone: userPhone }).limit(SYNC_LITE_CONNECT).get())
      )
    }

    var queryResults = await Promise.all(queries)
    var ownSubmissions = (queryResults[0].data || []).filter(function(item) {
      if (!userPhone) {
        return true
      }
      if (item.type === "connect" && item.ownerOpenid === openid) {
        return true
      }
      return submissionBelongsToPhone(item, userPhone)
    })
    var outgoingConnect = []
    var ownListings = queryResults[2].data || []

    if (userPhone && queryResults[3]) {
      ownSubmissions = ownSubmissions.concat((queryResults[3].data || []).filter(function(item) {
        return submissionBelongsToPhone(item, userPhone)
      }))
      outgoingConnect = (queryResults[4].data || []).concat(queryResults[5].data || []).filter(function(item) {
        return submissionBelongsToPhone(item, userPhone)
      })
    }

    var incomingConnect = await filterIncomingConnectForUser(
      queryResults[1].data || [],
      openid,
      userPhone
    )

    var submissionMap = {}
    ownSubmissions.concat(incomingConnect).concat(outgoingConnect).forEach(function(item) {
      mergeSubmissionIntoMap(submissionMap, item)
    })
    var submissions = sortSubmissionsByRecent(Object.keys(submissionMap).map(function(key) {
      return submissionMap[key]
    }))

    var ownListingMap = {}
    ownListings.forEach(function(item) {
      if (item && item.id) {
        ownListingMap[item.id] = item
      }
    })
    ownListings = Object.keys(ownListingMap).map(function(key) {
      return ownListingMap[key]
    })
    ownListings = await mergeConnectLinkedListings(ownListings, submissions)

    var favorites = emptyFavoritesStore()
    if (user && user.phone) {
      favorites = userHasEmbeddedFavorites(user)
        ? extractFavoritesFromUser(user)
        : await fetchFavoritesForUser(openid, user.phone)
    }

    return {
      ok: true,
      data: {
        userProfile: user ? sanitizeUserProfile(user, openid) : null,
        submissions: submissions,
        ownListings: ownListings,
        staffProxyListings: [],
        favorites: favorites,
        syncMode: "lite"
      }
    }
  } catch (error) {
    var msg = error.message || "同步失败"
    if (msg.indexOf("not exist") > -1 || msg.indexOf("-502005") > -1) {
      msg = "数据库集合未创建，请在云开发控制台新建 users、listings、submissions"
    }
    return { ok: false, message: msg }
  }
}

async function syncData(openid, payload) {
  payload = payload || {}
  if (payload.lite) {
    return syncDataLite(openid, payload)
  }
  try {
  var user = await resolveSessionUser(openid, payload)
  if (user) {
    user = await healEmptyOpenidBinding(user, openid)
    user = await applyStaffRoleIfEligible(user)
  }
  var userPhone = user ? user.phone : ""
  var isStaff = !!(user && isStaffRoleAtLeast("manager", user.staffRole))

  function safeQuery(promise) {
    return promise.catch(function(error) {
      console.warn("sync query failed", error)
      return { data: [] }
    })
  }

  var baseQueries = [
    safeQuery(syncOwnSubmissionQuery({ ownerOpenid: openid })),
    safeQuery(syncConnectQuery({
      type: "connect",
      targetOwnerOpenid: openid
    })),
    safeQuery(db.collection(COL_LISTINGS).where({ ownerOpenid: openid }).limit(100).get())
  ]
  if (userPhone) {
    baseQueries.push(
      safeQuery(syncOwnSubmissionQuery({ ownerPhone: userPhone })),
      safeQuery(syncConnectQuery({ type: "connect", phone: userPhone })),
      safeQuery(syncConnectQuery({ type: "connect", ownerPhone: userPhone })),
      safeQuery(syncConnectQuery({ type: "connect", targetOwnerPhone: userPhone })),
      safeQuery(db.collection(COL_LISTINGS).where({ ownerPhone: userPhone }).limit(100).get())
    )
  }
  if (isStaff) {
    baseQueries.push(
      safeQuery(syncConnectQuery({ type: "connect", proxyStaffOpenid: openid })),
      safeQuery(syncConnectQuery({ type: "connect", recipientProxyStaffOpenid: openid })),
      safeQuery(syncConnectQuery({ type: "connect", applicantProxyStaffOpenid: openid })),
      safeQuery(syncConnectQuery({ publishedByStaff: true, proxyStaffOpenid: openid })),
      safeQuery(db.collection(COL_LISTINGS).where({ proxyStaffOpenid: openid }).limit(100).get())
    )
    if (userPhone) {
      baseQueries.push(
        safeQuery(syncConnectQuery({ type: "connect", recipientProxyStaffPhone: userPhone })),
        safeQuery(syncConnectQuery({ type: "connect", applicantProxyStaffPhone: userPhone }))
      )
    }
  }

  var queryResults = await Promise.all(baseQueries)
  var queryIndex = 0
  var ownSubmissionsRes = queryResults[queryIndex++]
  var incomingConnectRes = queryResults[queryIndex++]
  var ownListingsRes = queryResults[queryIndex++]

  var ownSubmissions = (ownSubmissionsRes.data || []).filter(function(item) {
    if (!userPhone) {
      return true
    }
    if (item.type === "connect" && item.ownerOpenid === openid) {
      return true
    }
    return submissionBelongsToPhone(item, userPhone)
  })

  var outgoingConnect = []
  var incomingByPhone = []
  var ownListings = ownListingsRes.data || []
  var proxyStaffConnect = []
  var recipientProxyConnect = []
  var applicantProxyConnect = []
  var proxyStaffPublish = []
  var staffProxyListings = []

  if (userPhone) {
    var ownSubmissionsByPhoneRes = queryResults[queryIndex++]
    var outgoingByPhoneRes = queryResults[queryIndex++]
    var outgoingByOwnerPhoneRes = queryResults[queryIndex++]
    var incomingByPhoneRes = queryResults[queryIndex++]
    var ownListingsByPhoneRes = queryResults[queryIndex++]
    ownSubmissions = ownSubmissions.concat((ownSubmissionsByPhoneRes.data || []).filter(function(item) {
      return submissionBelongsToPhone(item, userPhone)
    }))
    outgoingConnect = outgoingConnect.concat(outgoingByPhoneRes.data || [], outgoingByOwnerPhoneRes.data || [])
    outgoingConnect = outgoingConnect.filter(function(item) {
      return submissionBelongsToPhone(item, userPhone)
    })
    incomingByPhone = (incomingByPhoneRes.data || []).filter(function(item) {
      return incomingConnectBelongsToPhone(item, userPhone)
    })
    ownListings = ownListings.concat(ownListingsByPhoneRes.data || [])
  }

  if (isStaff) {
    var proxyConnectRes = queryResults[queryIndex++]
    var recipientProxyRes = queryResults[queryIndex++]
    var applicantProxyRes = queryResults[queryIndex++]
    var proxyPublishRes = queryResults[queryIndex++]
    var proxyListingsRes = queryResults[queryIndex++]
    proxyStaffConnect = proxyConnectRes.data || []
    recipientProxyConnect = recipientProxyRes.data || []
    applicantProxyConnect = applicantProxyRes.data || []
    proxyStaffPublish = proxyPublishRes.data || []
    staffProxyListings = proxyListingsRes.data || []
    if (userPhone && queryResults[queryIndex]) {
      var recipientProxyPhoneRes = queryResults[queryIndex++]
      recipientProxyConnect = recipientProxyConnect.concat(recipientProxyPhoneRes.data || [])
    }
    if (userPhone && queryResults[queryIndex]) {
      var applicantProxyPhoneRes = queryResults[queryIndex++]
      applicantProxyConnect = applicantProxyConnect.concat(applicantProxyPhoneRes.data || [])
    }
  }

  var incomingConnect = await filterIncomingConnectForUser(
    incomingConnectRes.data || [],
    openid,
    userPhone
  )

  var submissionMap = {}
  ownSubmissions.concat(incomingConnect).concat(incomingByPhone).concat(outgoingConnect).concat(proxyStaffConnect)
    .concat(recipientProxyConnect).concat(applicantProxyConnect).concat(proxyStaffPublish).forEach(function(item) {
    mergeSubmissionIntoMap(submissionMap, item)
  })
  var submissions = sortSubmissionsByRecent(Object.keys(submissionMap).map(function(key) {
    return submissionMap[key]
  }))

  var userProfile = user ? sanitizeUserProfile(user, openid) : null

  var ownListingMap = {}
  ownListings.forEach(function(item) {
    if (item && item.id) {
      ownListingMap[item.id] = item
    }
  })
  ownListings = Object.keys(ownListingMap).map(function(key) {
    return ownListingMap[key]
  })
  ownListings = await mergeConnectLinkedListings(ownListings, submissions)

  var favorites = emptyFavoritesStore()
  if (user && user.phone) {
    favorites = userHasEmbeddedFavorites(user)
      ? extractFavoritesFromUser(user)
      : await fetchFavoritesForUser(openid, user.phone)
  }

  return {
    ok: true,
    data: {
      userProfile: userProfile,
      submissions: submissions,
      ownListings: ownListings,
      staffProxyListings: staffProxyListings,
      favorites: favorites
    }
  }
  } catch (error) {
    var msg = error.message || "同步失败"
    if (msg.indexOf("not exist") > -1 || msg.indexOf("-502005") > -1) {
      msg = "数据库集合未创建，请在云开发控制台新建 users、listings、submissions"
    }
    return { ok: false, message: msg }
  }
}

function sanitizePublicListingFields(listing) {
  if (!listing) {
    return listing
  }
  var copy = Object.assign({}, listing)
  ;["clientCompany", "clientContact", "clientRole", "actualOwnerPhone", "ownerPhone", "ownerOpenid", "proxyStaffPhone", "proxyStaffOpenid"].forEach(function(key) {
    delete copy[key]
  })
  if (copy.details && copy.details.length) {
    copy.details = filterPublisherSensitiveDetailRows(copy.details)
  }
  return copy
}

var LISTING_PUBLISHER_SENSITIVE_SPEC_LABELS = {
  "企业名称": true,
  "企业全称": true,
  "联系人": true,
  "手机号": true,
  "联系电话": true
}

function filterPublisherSensitiveDetailRows(details) {
  if (!details || !details.length) {
    return details || []
  }
  return details.filter(function(row) {
    return !(row && LISTING_PUBLISHER_SENSITIVE_SPEC_LABELS[row.label])
  })
}

async function getStaffListingPublisherInfo(openid, payload) {
  var admin = await verifyPlatformAdminAccess(openid)
  if (!admin) {
    return { ok: false, message: "仅平台管理员可查看发布方完整信息" }
  }
  var listingId = String(payload.listingId || "").trim()
  if (!listingId) {
    return { ok: false, message: "缺少商机编号" }
  }
  if (!isResourceId(listingId) && !isDemandId(listingId)) {
    return { ok: false, message: "商机编号无效" }
  }
  var listing = await getListingById(listingId)
  if (!listing) {
    return { ok: false, message: "商机不存在" }
  }
  if (listing.publishedByStaff) {
    return { ok: false, message: "代发商机请通过代发管理查看客户信息" }
  }
  var publishSubmission = listing.submissionId
    ? await getSubmissionById(listing.submissionId)
    : null
  var party = listingPartyProfileServer(listing, publishSubmission)
  var ownerPhone = party.phone || listing.ownerPhone || listing.actualOwnerPhone || ""
  if (ownerPhone) {
    var ownerUser = await getUserByPhone(ownerPhone)
    if (ownerUser) {
      if (!party.company) {
        party.company = ownerUser.company || ""
      }
      if (!party.contact) {
        party.contact = ownerUser.contact || ""
      }
      if (!party.role) {
        party.role = ownerUser.role || ""
      }
      if (!party.phone) {
        party.phone = ownerUser.phone || ownerPhone
      }
    }
  }
  return {
    ok: true,
    data: {
      listingId: listingId,
      publisher: party,
      publisherCertLevel: listing.publisherCertLevel || "",
      publisherCertBadge: listing.publisherCertBadge || null,
      description: publishSubmission && publishSubmission.description ? publishSubmission.description : (listing.summary || "")
    }
  }
}

function normalizeListingFilters(raw) {
  raw = raw || {}
  return {
    keyword: String(raw.keyword || "").trim(),
    activeType: raw.activeType || "全部",
    activeRegion: raw.activeRegion || "全部",
    activeCert: raw.activeCert || "all",
    activeTime: raw.activeTime || "all",
    activeDeliveryKind: raw.activeDeliveryKind || "all",
    sortBy: raw.sortBy === "latest" ? "latest" : "match"
  }
}

var LISTING_TYPE_OPTIONS = [
  "算力整机", "硬件配件", "算力租赁", "运维维保", "机房建设", "托管运营", "资金支持", "综合资源"
]
var LEGACY_RESOURCE_TYPE_ALIAS = {
  "服务器整机": "算力整机",
  "整机": "算力整机",
  "整机销售": "算力整机",
  "配件": "硬件配件",
  "配件供应": "硬件配件",
  "租赁": "算力租赁",
  "GPU 算力": "算力租赁",
  "GPU算力": "算力租赁",
  "国产算力": "算力租赁",
  "租赁算力": "算力租赁",
  "IDC 机柜": "算力租赁",
  "IDC托管": "算力租赁",
  "维保": "运维维保",
  "代运营": "托管运营",
  "数据中心运营": "托管运营",
  "其他": "综合资源",
  "其他资源": "综合资源",
  "资金": "资金支持",
  "融资": "资金支持"
}
var LEGACY_DEMAND_TYPE_ALIAS = {
  "服务器整机": "算力整机",
  "整机": "算力整机",
  "配件": "硬件配件",
  "配件供应": "硬件配件",
  "训练算力": "算力租赁",
  "推理部署": "算力租赁",
  "IDC 托管": "算力租赁",
  "IDC托管": "算力租赁",
  "代理合作": "综合资源",
  "租赁": "算力租赁",
  "GPU 算力": "算力租赁",
  "GPU算力": "算力租赁",
  "国产算力": "算力租赁",
  "租赁算力": "算力租赁",
  "IDC 机柜": "算力租赁",
  "维保": "运维维保",
  "代运营": "托管运营",
  "数据中心运营": "托管运营",
  "其他": "综合资源",
  "其他资源": "综合资源",
  "资金": "资金支持",
  "融资": "资金支持"
}

function normalizeListingType(type) {
  if (!type) {
    return type
  }
  var value = String(type).trim()
  if (LEGACY_RESOURCE_TYPE_ALIAS[value] !== undefined) {
    return LEGACY_RESOURCE_TYPE_ALIAS[value]
  }
  if (LEGACY_DEMAND_TYPE_ALIAS[value] !== undefined) {
    return LEGACY_DEMAND_TYPE_ALIAS[value]
  }
  if (LISTING_TYPE_OPTIONS.indexOf(value) > -1) {
    return value
  }
  return value
}

function getListingTypeFilterValues(canonicalType) {
  var values = [canonicalType]
  Object.keys(LEGACY_RESOURCE_TYPE_ALIAS).forEach(function(key) {
    if (LEGACY_RESOURCE_TYPE_ALIAS[key] === canonicalType && values.indexOf(key) === -1) {
      values.push(key)
    }
  })
  Object.keys(LEGACY_DEMAND_TYPE_ALIAS).forEach(function(key) {
    if (LEGACY_DEMAND_TYPE_ALIAS[key] === canonicalType && values.indexOf(key) === -1) {
      values.push(key)
    }
  })
  return values
}

function hasActiveListingFilters(filters) {
  if (!filters) {
    return false
  }
  return !!(
    filters.keyword
    || (filters.activeType && filters.activeType !== "全部")
    || (filters.activeRegion && filters.activeRegion !== "全部")
    || (filters.activeCert && filters.activeCert !== "all")
    || (filters.activeTime && filters.activeTime !== "all")
    || (filters.activeDeliveryKind && filters.activeDeliveryKind !== "all")
    || filters.sortBy === "latest"
  )
}

function escapeRegexText(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function looksLikeTradeIdKeywordCloud(keyword) {
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

function listingBelongsToPool(item, pool) {
  if (!item || !item.id) {
    return false
  }
  if (item.pool === pool) {
    return true
  }
  if (pool === "demand") {
    return isDemandId(item.id)
  }
  return isResourceId(item.id)
}

function listingRegionMatched(itemRegion, activeRegion) {
  if (!activeRegion || activeRegion === "全部") {
    return true
  }
  if (!itemRegion) {
    return false
  }
  if (itemRegion === activeRegion) {
    return true
  }
  if (activeRegion === "华中" && itemRegion === "中部") {
    return true
  }
  return false
}

function getPublishedAtCutoff(activeTime) {
  if (!activeTime || activeTime === "all") {
    return ""
  }
  var now = Date.now()
  if (activeTime === "24h") {
    return formatDate(new Date(now - 24 * 60 * 60 * 1000))
  }
  if (activeTime === "7d") {
    return formatDate(new Date(now - 7 * 24 * 60 * 60 * 1000))
  }
  if (activeTime === "30d") {
    return formatDate(new Date(now - 30 * 24 * 60 * 60 * 1000))
  }
  return ""
}

function resolveListingDeliveryKindCloud(item) {
  if (!item) {
    return ""
  }
  if (item.deliveryKind === "现货" || item.deliveryKind === "准现货" || item.deliveryKind === "期货") {
    return item.deliveryKind
  }
  var fields = [
    item.title,
    item.cycle,
    item.deliveryTime,
    (item.highlights || []).join(" "),
    (item.tags || []).join(" "),
    item.summary
  ]
  for (var i = 0; i < fields.length; i += 1) {
    var text = String(fields[i] || "")
    if (text.indexOf("准现货") >= 0) {
      return "准现货"
    }
    if (text.indexOf("现货") >= 0) {
      return "现货"
    }
    if (text.indexOf("期货") >= 0) {
      return "期货"
    }
  }
  return ""
}

function listingKeywordMatchedCloud(item, keyword) {
  var text = String(keyword || "").trim()
  if (!text) {
    return true
  }
  if (looksLikeTradeIdKeywordCloud(text)) {
    var normalized = text.toLowerCase()
    var ids = [item.id, item.submissionId, item.listingId, item.targetId, item.sourceListingId]
    for (var i = 0; i < ids.length; i += 1) {
      if (!ids[i]) {
        continue
      }
      var id = String(ids[i]).toLowerCase()
      if (id === normalized || id.indexOf(normalized) > -1 || normalized.indexOf(id) > -1) {
        return true
      }
    }
    return false
  }
  var haystack = (
    (item.id || "") + " " + (item.submissionId || "") + " " + (item.title || "") + " "
    + (item.city || "") + " " + (item.region || "") + " " + (item.summary || "") + " "
    + ((item.tags || []).join(" "))
  ).toLowerCase()
  return haystack.indexOf(text.toLowerCase()) > -1
}

function listingMatchesServerFilters(item, pool, filters, matchOptions) {
  matchOptions = matchOptions || {}
  if (!listingBelongsToPool(item, pool)) {
    return false
  }
  if (!isListingPubliclyVisible(item)) {
    return false
  }
  if (!filters) {
    return true
  }
  if (filters.activeType && filters.activeType !== "全部" && normalizeListingType(item.type) !== filters.activeType) {
    return false
  }
  if (!listingRegionMatched(item.region, filters.activeRegion)) {
    return false
  }
  if (filters.activeCert === "license") {
    var certLevel = matchOptions.resolvedCertLevel !== undefined && matchOptions.resolvedCertLevel !== null
      ? matchOptions.resolvedCertLevel
      : item.publisherCertLevel
    if (certLevel !== "license") {
      return false
    }
  }
  var cutoff = getPublishedAtCutoff(filters.activeTime)
  if (cutoff) {
    var publishedAt = item.publishedAt || item.createdAt || ""
    if (!publishedAt || publishedAt < cutoff) {
      return false
    }
  }
  if (filters.activeDeliveryKind && filters.activeDeliveryKind !== "all") {
    if (resolveListingDeliveryKindCloud(item) !== filters.activeDeliveryKind) {
      return false
    }
  }
  if (!listingKeywordMatchedCloud(item, filters.keyword)) {
    return false
  }
  return true
}

function normalizeListingForResponse(item, pool) {
  var copy = sanitizePublicListingFields(item)
  if (!copy.pool) {
    copy.pool = isResourceId(copy.id) ? "resource" : (isDemandId(copy.id) ? "demand" : pool)
  }
  if (!copy.matchScore) {
    copy.matchScore = computeListingQualityScore(copy)
  }
  return copy
}

function sortListingRows(items, sortBy) {
  var list = (items || []).slice()
  if (sortBy === "latest") {
    list.sort(function(a, b) {
      return (b.publishedAt || b.createdAt || "").localeCompare(a.publishedAt || a.createdAt || "")
    })
    return list
  }
  list.sort(function(a, b) {
    var diff = (b.matchScore || 0) - (a.matchScore || 0)
    if (diff !== 0) {
      return diff
    }
    return (b.publishedAt || b.createdAt || "").localeCompare(a.publishedAt || a.createdAt || "")
  })
  return list
}

function buildListingDbWhere(filters) {
  var conditions = [
    { verification: _.neq("待审核") }
  ]
  if (filters.activeType && filters.activeType !== "全部") {
    conditions.push({ type: _.in(getListingTypeFilterValues(filters.activeType)) })
  }
  if (filters.activeRegion && filters.activeRegion !== "全部") {
    if (filters.activeRegion === "华中") {
      conditions.push({ region: _.in(["华中", "中部"]) })
    } else {
      conditions.push({ region: filters.activeRegion })
    }
  }
  var cutoff = getPublishedAtCutoff(filters.activeTime)
  if (cutoff) {
    conditions.push({ publishedAt: _.gte(cutoff) })
  }
  if (filters.keyword) {
    if (looksLikeTradeIdKeywordCloud(filters.keyword)) {
      conditions.push({
        id: db.RegExp({
          regexp: "^" + escapeRegexText(filters.keyword),
          options: "i"
        })
      })
    } else {
      var kw = escapeRegexText(filters.keyword)
      conditions.push(_.or([
        { title: db.RegExp({ regexp: kw, options: "i" }) },
        { summary: db.RegExp({ regexp: kw, options: "i" }) }
      ]))
    }
  }
  if (conditions.length === 1) {
    return conditions[0]
  }
  return _.and(conditions)
}

async function fetchOrderedListings(where, orderField, skip, limit) {
  try {
    var res = await db.collection(COL_LISTINGS).where(where)
      .orderBy(orderField, "desc")
      .skip(skip)
      .limit(limit)
      .get()
    return res.data || []
  } catch (error) {
    console.warn("fetchOrderedListings orderBy fallback", error && error.message)
    var fallback = await db.collection(COL_LISTINGS).where(where)
      .skip(skip)
      .limit(limit)
      .get()
    return fallback.data || []
  }
}

async function shouldExcludeListingForViewer(item, viewer) {
  if (!item || !viewer || !viewer.phone) {
    return false
  }
  if (isStaffRoleAtLeast("manager", viewer.staffRole)) {
    if (item.publishedByStaff) {
      return false
    }
  }
  var ownerPhone = item.actualOwnerPhone || item.ownerPhone || ""
  if (ownerPhone && ownerPhone === viewer.phone) {
    return true
  }
  if (item.ownerOpenid && viewer.openid && item.ownerOpenid === viewer.openid) {
    return true
  }
  return false
}

async function collectVisibleListings(pool, filters, openid, targetCount) {
  var viewer = openid ? await resolveSessionUser(openid, {}) : null
  var where = hasActiveListingFilters(filters)
    ? buildListingDbWhere(filters)
    : { verification: _.neq("待审核") }
  var orderField = filters.sortBy === "latest" ? "publishedAt" : "matchScore"
  var matched = []
  var dbSkip = 0
  var truncated = false
  var lastBatchSize = 0

  while (matched.length < targetCount && dbSkip < LISTINGS_FETCH_MAX) {
    var batch = await fetchOrderedListings(where, orderField, dbSkip, LISTINGS_FETCH_BATCH)
    lastBatchSize = batch.length
    if (!batch.length) {
      break
    }
    for (var i = 0; i < batch.length; i += 1) {
      var item = batch[i]
      var matchOptions = {}
      if (filters.activeCert === "license") {
        var ownerPhone = item.actualOwnerPhone || item.ownerPhone || item.phone || ""
        var certFields = await resolvePublisherCertFieldsForPhone(ownerPhone)
        matchOptions.resolvedCertLevel = certFields.publisherCertLevel || item.publisherCertLevel || ""
      }
      if (!listingMatchesServerFilters(item, pool, filters, matchOptions)) {
        continue
      }
      if (await shouldExcludeListingForViewer(item, viewer)) {
        continue
      }
      matched.push(normalizeListingForResponse(item, pool))
    }
    dbSkip += batch.length
    if (batch.length < LISTINGS_FETCH_BATCH) {
      break
    }
    if (dbSkip >= LISTINGS_FETCH_MAX) {
      truncated = true
    }
  }

  matched = sortListingRows(matched, filters.sortBy)
  var hasMore = matched.length > targetCount
    || (lastBatchSize === LISTINGS_FETCH_BATCH && dbSkip < LISTINGS_FETCH_MAX)
  return {
    items: matched,
    truncated: truncated,
    hasMore: hasMore
  }
}

async function listListings(payload, openid) {
  payload = payload || {}
  var pool = payload.pool === "demand" ? "demand" : "resource"
  var page = payload.page > 0 ? payload.page : 1
  var pageSize = payload.pageSize > 0 ? Math.min(payload.pageSize, 50) : 30
  var filters = normalizeListingFilters(payload.filters)
  var targetCount = page * pageSize
  var collected = await collectVisibleListings(pool, filters, openid, targetCount)
  var matched = collected.items || []
  var start = (page - 1) * pageSize
  var items = matched.slice(start, start + pageSize)
  var hasMore = matched.length > start + pageSize || collected.hasMore

  return {
    ok: true,
    data: {
      pool: pool,
      items: items,
      page: page,
      pageSize: pageSize,
      total: matched.length,
      hasMore: hasMore,
      truncated: collected.truncated,
      serverFiltered: hasActiveListingFilters(filters)
    }
  }
}

async function verifyStaffAccess(openid, payload) {
  var user = await resolveSessionUser(openid, payload || {})
  if (user) {
    user = await applyStaffRoleIfEligible(user)
  }
  if (user && isStaffRoleAtLeast("manager", user.staffRole)) {
    return {
      username: user.staffRole,
      name: STAFF_ROLE_LABELS[user.staffRole],
      staffAuth: true,
      phone: user.phone || ""
    }
  }
  return null
}

async function verifyPlatformAdminAccess(openid, payload) {
  var staff = await verifyStaffAccess(openid, payload)
  if (!staff || !isStaffRoleAtLeast("admin", staff.username)) {
    return null
  }
  return staff
}

function isAccountDisabled(user) {
  return !!(user && user.accountStatus === "disabled")
}

function assertActiveUserAccount(user, message) {
  if (isAccountDisabled(user)) {
    return {
      ok: false,
      message: message || (user.accountDisabledReason
        ? "账号已被禁用：" + user.accountDisabledReason
        : "账号已被禁用，请联系平台管理员")
    }
  }
  return { ok: true }
}

async function updateUserRecordByPhone(phone, patch) {
  var user = await getUserByPhone(phone)
  if (!user || !user._id) {
    return null
  }
  var next = Object.assign({}, user, patch || {}, {
    updatedAt: formatDate(new Date())
  })
  delete next._id
  await db.collection(COL_USERS).doc(user._id).update({ data: next })
  return next
}

async function applyListingTakeDownInternal(listing, reason, options) {
  options = options || {}
  if (!listing || !listing.id) {
    return { ok: false, message: "商机不存在" }
  }
  if (isListingClosed(listing)) {
    return { ok: false, message: "该商机已下架" }
  }
  var takeDownReason = String(reason || "").trim() || "平台管理员下架"
  var listingNext = Object.assign({}, listing, {
    status: "closed",
    verification: "已关闭",
    adminTakenDown: true,
    adminTakeDownReason: takeDownReason,
    adminTakeDownAt: formatDate(new Date()),
    updatedAt: formatDate(new Date())
  })
  delete listingNext._id
  await saveListingDoc(listingNext)
  if (listing.submissionId) {
    var sub = await getSubmissionById(listing.submissionId)
    if (sub && sub.status !== "已关闭") {
      var statusTimeline = (sub.statusTimeline || []).slice()
      statusTimeline.push({
        status: "已关闭",
        time: formatDate(new Date()),
        hint: takeDownReason
      })
      var subNext = Object.assign({}, sub, {
        status: "已关闭",
        statusTimeline: statusTimeline,
        adminTakenDown: true,
        reviewResult: sub.reviewResult || "平台下架",
        updatedAt: formatDate(new Date())
      })
      delete subNext._id
      await saveSubmissionDoc(subNext)
    }
  }
  await closeUnfinishedConnectsForListingCloud(listing.id)
  return { ok: true, listing: listingNext }
}

async function adminTakeDownAllListingsForPhone(phone, reason) {
  if (!phone) {
    return 0
  }
  var seen = {}
  var takenDown = 0
  async function takeDownFromQuery(field) {
    var res = await db.collection(COL_LISTINGS).where({ [field]: phone }).limit(100).get()
    var rows = res.data || []
    for (var i = 0; i < rows.length; i += 1) {
      var listing = rows[i]
      if (!listing || !listing.id || seen[listing.id]) {
        continue
      }
      seen[listing.id] = true
      if (isListingClosed(listing)) {
        continue
      }
      var result = await applyListingTakeDownInternal(listing, reason, { bulk: true })
      if (result.ok) {
        takenDown += 1
      }
    }
  }
  await takeDownFromQuery("ownerPhone")
  await takeDownFromQuery("actualOwnerPhone")
  return takenDown
}

async function adminTakeDownListing(openid, payload) {
  var admin = await verifyPlatformAdminAccess(openid)
  if (!admin) {
    return { ok: false, message: "仅平台管理员可下架商机" }
  }
  var listingId = String(payload.listingId || "").trim()
  if (!listingId) {
    return { ok: false, message: "缺少商机编号" }
  }
  var listing = await getListingById(listingId)
  if (!listing) {
    return { ok: false, message: "商机不存在" }
  }
  var reason = String(payload.reason || "").trim() || "平台管理员下架，不再公开展示。"
  var result = await applyListingTakeDownInternal(listing, reason)
  if (!result.ok) {
    return result
  }
  return { ok: true, data: { listing: result.listing } }
}

async function adminDisableAccount(openid, payload) {
  var admin = await verifyPlatformAdminAccess(openid)
  if (!admin) {
    return { ok: false, message: "仅平台管理员可禁用账号" }
  }
  var phone = normalizePhone(payload.phone)
  if (!/^1\d{10}$/.test(phone)) {
    return { ok: false, message: "请输入11位有效手机号" }
  }
  if (admin.phone && admin.phone === phone) {
    return { ok: false, message: "不能禁用当前登录的管理员账号" }
  }
  var user = await getUserByPhone(phone)
  if (!user) {
    return { ok: false, message: "未找到该手机号对应的账号" }
  }
  if (normalizeStaffRole(user.staffRole)) {
    return { ok: false, message: "不能禁用运营账号" }
  }
  if (isAccountDisabled(user)) {
    return { ok: false, message: "该账号已处于禁用状态" }
  }
  var reason = String(payload.reason || "").trim() || "违反平台规则，账号已禁用。"
  var takenDownCount = await adminTakeDownAllListingsForPhone(
    phone,
    "关联账号已禁用，商机自动下架。"
  )
  await updateUserRecordByPhone(phone, {
    accountStatus: "disabled",
    accountDisabledAt: formatDate(new Date()),
    accountDisabledReason: reason,
    accountDisabledBy: admin.phone || openid
  })
  return {
    ok: true,
    data: {
      phone: phone,
      takenDownCount: takenDownCount
    }
  }
}

async function adminEnableAccount(openid, payload) {
  var admin = await verifyPlatformAdminAccess(openid)
  if (!admin) {
    return { ok: false, message: "仅平台管理员可解禁账号" }
  }
  var phone = normalizePhone(payload.phone)
  if (!/^1\d{10}$/.test(phone)) {
    return { ok: false, message: "请输入11位有效手机号" }
  }
  var user = await getUserByPhone(phone)
  if (!user) {
    return { ok: false, message: "未找到该手机号对应的账号" }
  }
  if (!isAccountDisabled(user)) {
    return { ok: false, message: "该账号当前未禁用" }
  }
  await updateUserRecordByPhone(phone, {
    accountStatus: "active",
    accountEnabledAt: formatDate(new Date()),
    accountEnabledBy: admin.phone || openid,
    accountDisabledReason: "",
    accountDisabledAt: ""
  })
  return { ok: true, data: { phone: phone } }
}

async function adminSearchPublishedListings(openid, payload) {
  var admin = await verifyPlatformAdminAccess(openid)
  if (!admin) {
    return { ok: false, message: "仅平台管理员可查询公开展示商机" }
  }
  var pool = payload.pool === "demand" ? "demand" : (payload.pool === "resource" ? "resource" : "all")
  var keyword = String(payload.keyword || "").trim().toLowerCase()
  var includeClosed = payload.includeClosed === true
  var res = await db.collection(COL_LISTINGS).limit(300).get()
  var items = (res.data || []).filter(function(item) {
    if (!item || !item.id) {
      return false
    }
    if (pool === "resource" && item.pool !== "resource" && !isResourceId(item.id)) {
      return false
    }
    if (pool === "demand" && item.pool !== "demand" && !isDemandId(item.id)) {
      return false
    }
    if (!includeClosed && isListingClosed(item)) {
      return false
    }
    if (!keyword) {
      return true
    }
    var haystack = [
      item.id,
      item.title,
      item.type,
      item.region,
      item.summary,
      item.ownerPhone,
      item.maskedCompany
    ].join(" ").toLowerCase()
    return haystack.indexOf(keyword) > -1
  }).map(function(item) {
    return {
      id: item.id,
      pool: item.pool || (isResourceId(item.id) ? "resource" : "demand"),
      type: item.type || "",
      title: item.title || "",
      region: item.region || "",
      verification: item.verification || "",
      publishedAt: item.publishedAt || item.createdAt || "",
      ownerPhone: item.ownerPhone || item.actualOwnerPhone || "",
      publishedByStaff: !!item.publishedByStaff,
      adminTakenDown: !!item.adminTakenDown
    }
  })
  items.sort(function(a, b) {
    return (b.publishedAt || "").localeCompare(a.publishedAt || "")
  })
  return {
    ok: true,
    data: {
      items: items.slice(0, 50),
      total: items.length
    }
  }
}

async function adminLookupUser(openid, payload) {
  var admin = await verifyPlatformAdminAccess(openid)
  if (!admin) {
    return { ok: false, message: "仅平台管理员可查询用户账号" }
  }
  var phone = normalizePhone(payload.phone)
  if (!/^1\d{10}$/.test(phone)) {
    return { ok: false, message: "请输入11位有效手机号" }
  }
  var user = await getUserByPhone(phone)
  if (!user) {
    return { ok: false, message: "未找到该手机号对应的账号" }
  }
  return {
    ok: true,
    data: {
      user: {
        phone: user.phone || phone,
        contact: user.contact || "",
        company: user.company || "",
        role: user.role || "",
        region: user.region || "",
        accountStatus: user.accountStatus || "active",
        accountDisabledAt: user.accountDisabledAt || "",
        accountDisabledReason: user.accountDisabledReason || "",
        certStatus: user.certStatus || "",
        certLevel: user.certLevel || "",
        staffRole: user.staffRole || "",
        registeredAt: user.registeredAt || "",
        lastLoginAt: user.lastLoginAt || ""
      }
    }
  }
}

function isCloudImageFileId(fileID) {
  var lower = String(fileID || "").toLowerCase()
  if (!lower || lower.indexOf("cloud://") !== 0) {
    return false
  }
  return /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/.test(lower) || lower.indexOf("/cert/") > -1 || lower.indexOf("/attachments/") > -1
}

async function buildCloudImagePreviewDataUrl(fileID) {
  if (!isCloudImageFileId(fileID)) {
    return ""
  }
  var download = await cloud.downloadFile({ fileID: fileID })
  var content = download && download.fileContent
  if (!content || !content.length) {
    return ""
  }
  if (content.length > 3 * 1024 * 1024) {
    return ""
  }
  var lower = String(fileID).toLowerCase()
  var mime = lower.indexOf(".png") > -1 ? "image/png" : "image/jpeg"
  return "data:" + mime + ";base64," + content.toString("base64")
}

async function resolveSingleCloudFileForAdmin(fileID, options) {
  options = options || {}
  var result = {
    fileID: fileID,
    status: -1,
    tempFileURL: "",
    previewDataUrl: "",
    errMsg: ""
  }
  try {
    var tempRes = await cloud.getTempFileURL({
      fileList: [{ fileID: fileID, maxAge: 7200 }]
    })
    var tempEntry = (tempRes.fileList || [])[0]
    if (tempEntry && tempEntry.status === 0 && tempEntry.tempFileURL) {
      result.tempFileURL = tempEntry.tempFileURL
      result.status = 0
      result.errMsg = tempEntry.errMsg || ""
    } else if (tempEntry && tempEntry.errMsg) {
      result.errMsg = tempEntry.errMsg
    }
  } catch (tempErr) {
    result.errMsg = tempErr.message || "临时链接获取失败"
  }

  if (options.includePreview !== false) {
    try {
      var preview = await buildCloudImagePreviewDataUrl(fileID)
      if (preview) {
        result.previewDataUrl = preview
        result.status = 0
        result.errMsg = ""
      }
    } catch (previewErr) {
      if (!result.tempFileURL && !result.previewDataUrl) {
        result.errMsg = previewErr.message || result.errMsg || "无法读取云端文件"
      }
    }
  }

  if (!result.tempFileURL && !result.previewDataUrl && result.status !== 0) {
    result.status = -1
  }
  return result
}

async function resolveCloudFileUrls(openid, payload) {
  var admin = await verifyStaffAccess(openid)
  if (!admin) {
    return { ok: false, message: "无运营权限，无法读取认证材料" }
  }
  var fileList = (payload && payload.fileList) || []
  fileList = fileList.filter(function(id) {
    return id && String(id).indexOf("cloud://") === 0
  })
  if (!fileList.length) {
    return { ok: true, data: { fileList: [] } }
  }
  var unique = []
  var seen = {}
  fileList.forEach(function(id) {
    if (!seen[id]) {
      seen[id] = true
      unique.push(id)
    }
  })
  var includePreview = payload.includePreview !== false
  var resolved = await Promise.all(unique.slice(0, 20).map(function(fileID) {
    return resolveSingleCloudFileForAdmin(fileID, { includePreview: includePreview })
  }))
  return {
    ok: true,
    data: {
      fileList: resolved
    }
  }
}

function isResourceToDemandConnect(submission) {
  return !!(submission && submission.connectDirection === "resource_to_demand")
}

function isConnectRecipientResponded(submission) {
  return !!(submission && (submission.recipientConfirmed === true || submission.recipientExchangeAgree === true))
}

function isConnectContactsExchangedCloud(submission) {
  return !!(submission && (submission.disclosedContacts || submission.status === "已交换名片"))
}

function isConnectSubmissionUnfinishedCloud(submission) {
  if (!submission || submission.type !== "connect") {
    return false
  }
  if (isConnectContactsExchangedCloud(submission)) {
    return false
  }
  if (submission.applicantExchangeAgree === true && submission.recipientExchangeAgree === true) {
    return false
  }
  return ["已关闭", "已流失", "已交换名片"].indexOf(submission.status) === -1
}

function getConnectDisplayStatus(submission) {
  if (!submission) {
    return ""
  }
  if (submission.type === "connect" && isConnectContactsExchangedCloud(submission)) {
    return "已交换名片"
  }
  if (submission.status === "待对方确认" && isConnectRecipientResponded(submission)) {
    return "待交换确认"
  }
  return submission.status || ""
}

function listingPartyProfileServer(listing, publishSubmission) {
  if (!listing) {
    return { company: "", contact: "", phone: "", role: "" }
  }
  var company = listing.clientCompany || (publishSubmission && publishSubmission.company) || ""
  var contact = listing.clientContact || (publishSubmission && publishSubmission.contact) || ""
  var role = listing.clientRole || (publishSubmission && publishSubmission.role) || ""
  var phone = listing.actualOwnerPhone || listing.ownerPhone || ""
  if (publishSubmission) {
    if (!phone) {
      phone = publishSubmission.actualOwnerPhone || publishSubmission.ownerPhone || publishSubmission.phone || ""
    }
    if (!company) {
      company = publishSubmission.clientCompany || publishSubmission.company || ""
    }
    if (!contact) {
      contact = publishSubmission.clientContact || publishSubmission.contact || ""
    }
  }
  return { company: company, contact: contact, phone: phone, role: role }
}

function buildConnectPartyListingMetaServer(listingId) {
  if (!listingId) {
    return {
      listingId: "",
      poolTypeLabel: "",
      canOpenListing: false
    }
  }
  return {
    listingId: listingId,
    poolTypeLabel: isResourceListingId(listingId) ? "资源" : "需求",
    canOpenListing: true
  }
}

function buildConnectPartiesServer(submission, listingsMap, submissionsMap) {
  var target = submission.targetId ? listingsMap[submission.targetId] : null
  var source = submission.sourceListingId ? listingsMap[submission.sourceListingId] : null
  var applicantSubmission = source && source.submissionId ? submissionsMap[source.submissionId] : null
  var targetSubmission = target && target.submissionId ? submissionsMap[target.submissionId] : null
  var sourceProfile = listingPartyProfileServer(source, applicantSubmission)
  var targetProfile = listingPartyProfileServer(target, targetSubmission)
  var applicantListingId = source ? source.id : (submission.sourceListingId || "")
  var recipientListingId = target ? target.id : (submission.targetId || "")
  if (isResourceToDemandConnect(submission)) {
    return [
      Object.assign({
        side: "申请方",
        partyRole: "applicant",
        roleLabel: "资源方",
        title: source ? source.title : (submission.sourceTitle || "未关联已发布资源"),
        type: source ? source.type : "",
        region: source ? source.region : submission.region,
        company: submission.company || sourceProfile.company || (applicantSubmission ? applicantSubmission.company : ""),
        contact: submission.contact || sourceProfile.contact || (applicantSubmission ? applicantSubmission.contact : ""),
        phone: submission.phone || sourceProfile.phone || (applicantSubmission ? applicantSubmission.phone : ""),
        summary: source ? source.summary : (submission.description || "")
      }, buildConnectPartyListingMetaServer(applicantListingId)),
      Object.assign({
        side: "对接方",
        partyRole: "recipient",
        roleLabel: "需求方",
        title: target ? target.title : submission.targetTitle,
        type: target ? target.type : "",
        region: target ? target.region : "",
        company: targetProfile.company || (targetSubmission ? targetSubmission.company : ""),
        contact: targetProfile.contact || (targetSubmission ? targetSubmission.contact : ""),
        phone: targetProfile.phone || (targetSubmission ? targetSubmission.phone : ""),
        summary: target ? target.summary : ""
      }, buildConnectPartyListingMetaServer(recipientListingId))
    ]
  }
  return [
    Object.assign({
      side: "申请方",
      partyRole: "applicant",
      roleLabel: "需求方",
      title: source ? source.title : (submission.sourceTitle || "未关联已发布需求"),
      type: source ? source.type : "",
      region: source ? source.region : submission.region,
      company: submission.company || sourceProfile.company || (applicantSubmission ? applicantSubmission.company : ""),
      contact: submission.contact || sourceProfile.contact || (applicantSubmission ? applicantSubmission.contact : ""),
      phone: submission.phone || sourceProfile.phone || (applicantSubmission ? applicantSubmission.phone : ""),
      summary: source ? source.summary : (submission.description || "")
    }, buildConnectPartyListingMetaServer(applicantListingId)),
    Object.assign({
      side: "对接方",
      partyRole: "recipient",
      roleLabel: "资源方",
      title: target ? target.title : submission.targetTitle,
      type: target ? target.type : "",
      region: target ? target.region : "",
      company: targetProfile.company || (targetSubmission ? targetSubmission.company : ""),
      contact: targetProfile.contact || (targetSubmission ? targetSubmission.contact : ""),
      phone: targetProfile.phone || (targetSubmission ? targetSubmission.phone : ""),
      summary: target ? target.summary : ""
    }, buildConnectPartyListingMetaServer(recipientListingId))
  ]
}

function buildStaffGlobalConnectViewServer(submission, listingsMap, submissionsMap) {
  var parties = buildConnectPartiesServer(submission, listingsMap, submissionsMap)
  var applicant = parties[0] || {}
  var recipient = parties[1] || {}
  var displayStatus = getConnectDisplayStatus(submission)
  var direction = isResourceToDemandConnect(submission) ? "资源方 → 需求方" : "需求方 → 资源方"
  return {
    id: submission.id,
    displayStatus: displayStatus,
    rawStatus: submission.status || "",
    direction: direction,
    directionShort: isResourceToDemandConnect(submission) ? "资源匹配需求" : "需求申请资源",
    applicantRoleLabel: applicant.roleLabel || "",
    applicantCompany: applicant.company || "",
    applicantContact: applicant.contact || "",
    applicantPhone: applicant.phone || "",
    applicantTitle: applicant.title || "",
    recipientRoleLabel: recipient.roleLabel || "",
    recipientCompany: recipient.company || "",
    recipientContact: recipient.contact || "",
    recipientPhone: recipient.phone || "",
    recipientTitle: recipient.title || "",
    connectParties: parties,
    description: submission.description || "",
    createdAt: submission.createdAt || "",
    isProxyConnect: !!(submission.needsPlatformConnectReview || submission.matchedByStaff),
    matchedByStaff: !!submission.matchedByStaff,
    needsPlatformReview: !!(submission.status === "待平台审核" && submission.needsPlatformConnectReview),
    targetId: submission.targetId || "",
    sourceListingId: submission.sourceListingId || "",
    isInProgress: isConnectSubmissionUnfinishedCloud(submission)
  }
}

async function fetchDocsByIds(collectionName, ids) {
  var map = {}
  if (!ids || !ids.length) {
    return map
  }
  for (var i = 0; i < ids.length; i += 10) {
    var chunk = ids.slice(i, i + 10)
    var res = await db.collection(collectionName).where({
      id: _.in(chunk)
    }).limit(10).get()
    ;(res.data || []).forEach(function(doc) {
      if (doc && doc.id) {
        map[doc.id] = doc
      }
    })
  }
  return map
}

async function listStaffGlobalConnects(openid, payload) {
  var admin = await verifyStaffAccess(openid)
  if (!admin) {
    return { ok: false, message: "无运营权限，请使用运营账号（manager 或 admin）登录" }
  }

  var connectLimit = (payload && payload.skipRepair) ? 100 : 500
  var res = await db.collection(COL_SUBMISSIONS).where({
    type: "connect"
  }).orderBy("createdAt", "desc").limit(connectLimit).get()
  var connects = res.data || []
  var listingIds = {}
  connects.forEach(function(item) {
    if (item.targetId) {
      listingIds[item.targetId] = true
    }
    if (item.sourceListingId) {
      listingIds[item.sourceListingId] = true
    }
  })
  var listingsMap = await fetchDocsByIds(COL_LISTINGS, Object.keys(listingIds))
  var submissionIds = {}
  Object.keys(listingsMap).forEach(function(listingId) {
    var listing = listingsMap[listingId]
    if (listing && listing.submissionId) {
      submissionIds[listing.submissionId] = true
    }
  })
  var submissionsMap = await fetchDocsByIds(COL_SUBMISSIONS, Object.keys(submissionIds))
  var skipRepair = !!(payload && payload.skipRepair)
  var repairedConnects = []
  if (skipRepair) {
    repairedConnects = connects
  } else {
  for (var rc = 0; rc < connects.length; rc += 1) {
    var connectRow = connects[rc]
    var targetListingRow = listingsMap[connectRow.targetId]
    var sourceListingRow = listingsMap[connectRow.sourceListingId]
    if (isConnectSubmissionUnfinishedCloud(connectRow)) {
      var closedListingId = findClosedListingIdForConnectCloud(connectRow, listingsMap, submissionsMap)
      if (closedListingId) {
        connectRow = await closeConnectDocDueToListingClosed(connectRow, closedListingId) || connectRow
      }
    }
    if (connectRow.matchedByStaff
      && isProxyToProxyConnectCloud(connectRow, targetListingRow, sourceListingRow)
      && !connectRow.proxyAutoCompleted
      && connectRow.status !== "已交换名片"
      && ["待交换确认", "对方已确认", "待对方确认"].indexOf(connectRow.status) > -1) {
      var repairedRow = Object.assign({}, connectRow)
      applyStaffProxyToProxyExchangeReadyCloud(
        repairedRow, targetListingRow, sourceListingRow, submissionsMap
      )
      if (repairedRow.status !== connectRow.status
        || !!repairedRow.proxyAutoCompleted !== !!connectRow.proxyAutoCompleted
        || (!connectRow.disclosedContacts && repairedRow.disclosedContacts)) {
        repairedRow.updatedAt = formatDate(new Date())
        await saveSubmissionDoc(repairedRow)
        connectRow = repairedRow
      }
    } else if (isProxyToProxyConnectCloud(connectRow, targetListingRow, sourceListingRow)
      && !connectRow.matchedByStaff
      && !connectRow.proxyAutoCompleted
      && connectRow.status !== "已交换名片"
      && ["待交换确认", "对方已确认", "待对方确认"].indexOf(connectRow.status) > -1) {
      var autoCompleteRow = Object.assign({}, connectRow)
      applyProxyToProxyAutoCompleteCloud(
        autoCompleteRow, targetListingRow, sourceListingRow, submissionsMap
      )
      if (autoCompleteRow.status !== connectRow.status
        || !!autoCompleteRow.proxyAutoCompleted !== !!connectRow.proxyAutoCompleted
        || (!connectRow.disclosedContacts && autoCompleteRow.disclosedContacts)) {
        autoCompleteRow.updatedAt = formatDate(new Date())
        await saveSubmissionDoc(autoCompleteRow)
        connectRow = autoCompleteRow
      }
    } else if (isProxyToProxyConnectCloud(connectRow, targetListingRow, sourceListingRow)
      && connectRow.status === "已交换名片"
      && !connectRow.disclosedContacts) {
      var backfilledRow = Object.assign({}, connectRow)
      backfilledRow.disclosedContacts = buildConnectDisclosedContactsCloud(
        backfilledRow, sourceListingRow, targetListingRow, submissionsMap
      )
      if (backfilledRow.disclosedContacts) {
        backfilledRow.updatedAt = formatDate(new Date())
        await saveSubmissionDoc(backfilledRow)
        connectRow = backfilledRow
      }
    }
    repairedConnects.push(connectRow)
  }
  }
  connects = repairedConnects
  var items = connects.map(function(connect) {
    return buildStaffGlobalConnectViewServer(connect, listingsMap, submissionsMap)
  })
  return {
    ok: true,
    data: {
      connects: connects,
      items: items,
      listings: Object.keys(listingsMap).map(function(key) {
        return listingsMap[key]
      }),
      publishSubmissions: Object.keys(submissionsMap).map(function(key) {
        return submissionsMap[key]
      }),
      total: items.length
    }
  }
}

async function staffWorkbenchSync(openid, payload) {
  payload = payload || {}
  var pendingLimit = 80
  var staffLimit = 40

  function safeQuery(promise) {
    return promise.catch(function(error) {
      console.warn("staffWorkbenchSync query failed", error)
      return { data: [] }
    })
  }

  var userTask = resolveSessionUser(openid, payload).then(function(user) {
    if (!user) {
      return null
    }
    return applyStaffRoleIfEligible(user)
  })
  var queries = [
    safeQuery(db.collection(COL_LISTINGS).where({ verification: "待审核" }).limit(pendingLimit).get()),
    safeQuery(db.collection(COL_SUBMISSIONS).where(_.or([
      { status: "待审核" },
      { status: "待平台审核", type: "connect" }
    ])).limit(pendingLimit).get()),
    safeQuery(db.collection(COL_SUBMISSIONS).where({ type: "connect", proxyStaffOpenid: openid }).limit(staffLimit).get()),
    safeQuery(db.collection(COL_SUBMISSIONS).where({ type: "connect", recipientProxyStaffOpenid: openid }).limit(staffLimit).get()),
    safeQuery(db.collection(COL_SUBMISSIONS).where({ type: "connect", applicantProxyStaffOpenid: openid }).limit(staffLimit).get()),
    safeQuery(db.collection(COL_SUBMISSIONS).where({ publishedByStaff: true, proxyStaffOpenid: openid }).limit(staffLimit).get()),
    safeQuery(db.collection(COL_LISTINGS).where({ proxyStaffOpenid: openid }).limit(staffLimit).get())
  ]

  var results = await Promise.all([userTask].concat(queries))
  var user = results[0]
  if (!user || !isStaffRoleAtLeast("manager", user.staffRole)) {
    return { ok: false, message: "无运营权限，请使用已开通运营账号（manager 或 admin）登录" }
  }
  var userPhone = user.phone || ""
  var phoneResults = []
  if (userPhone) {
    phoneResults = await Promise.all([
      safeQuery(db.collection(COL_SUBMISSIONS).where({ type: "connect", recipientProxyStaffPhone: userPhone }).limit(staffLimit).get()),
      safeQuery(db.collection(COL_SUBMISSIONS).where({ type: "connect", applicantProxyStaffPhone: userPhone }).limit(staffLimit).get())
    ])
  }

  var listingsRes = results[1]
  var submissionsRes = results[2]
  var pendingListings = listingsRes.data || []
  var pendingSubmissions = (submissionsRes.data || []).filter(function(item) {
    if (item.type === "connect") {
      return item.status === "待平台审核" && item.needsPlatformConnectReview
    }
    return item.type !== "connect"
  })
  var listingSubmissionIds = {}
  pendingListings.forEach(function(item) {
    if (item.submissionId) {
      listingSubmissionIds[item.submissionId] = true
    }
  })
  pendingSubmissions = pendingSubmissions.filter(function(item) {
    return !listingSubmissionIds[item.id]
  })

  var submissionMap = {}
  var staffProxyListings = results[7].data || []
  for (var i = 3; i < results.length; i += 1) {
    if (i === 7) {
      continue
    }
    ;(results[i].data || []).forEach(function(item) {
      mergeSubmissionIntoMap(submissionMap, item)
    })
  }
  phoneResults.forEach(function(res) {
    ;(res.data || []).forEach(function(item) {
      mergeSubmissionIntoMap(submissionMap, item)
    })
  })
  var submissions = sortSubmissionsByRecent(Object.keys(submissionMap).map(function(key) {
    return submissionMap[key]
  }))

  return {
    ok: true,
    data: {
      userProfile: user ? sanitizeUserProfile(user, openid) : null,
      submissions: submissions,
      staffProxyListings: staffProxyListings,
      pendingListings: pendingListings,
      pendingSubmissions: pendingSubmissions,
      allPendingSubmissions: (submissionsRes.data || []).filter(function(item) {
        if (item.type === "connect") {
          return item.status === "待平台审核" && item.needsPlatformConnectReview
        }
        return item.type !== "connect"
      })
    }
  }
}

async function adminSync(openid, payload) {
  payload = payload || {}
  var pendingLimit = 80
  var userTask = resolveSessionUser(openid, payload).then(function(user) {
    if (!user) {
      return null
    }
    return applyStaffRoleIfEligible(user)
  })
  var listingsTask = db.collection(COL_LISTINGS).where({
    verification: "待审核"
  }).limit(pendingLimit).get()
  var submissionsTask = db.collection(COL_SUBMISSIONS).where(_.or([
    { status: "待审核" },
    { status: "待平台审核", type: "connect" }
  ])).limit(pendingLimit).get()

  var results = await Promise.all([userTask, listingsTask, submissionsTask])
  var user = results[0]
  if (!user || !isStaffRoleAtLeast("manager", user.staffRole)) {
    return { ok: false, message: "无运营权限，请使用已开通运营账号（manager 或 admin）登录" }
  }

  var listingsRes = results[1]
  var submissionsRes = results[2]
  var pendingListings = listingsRes.data || []
  var pendingSubmissions = (submissionsRes.data || []).filter(function(item) {
    if (item.type === "connect") {
      return item.status === "待平台审核" && item.needsPlatformConnectReview
    }
    return item.type !== "connect"
  })

  var listingSubmissionIds = {}
  pendingListings.forEach(function(item) {
    if (item.submissionId) {
      listingSubmissionIds[item.submissionId] = true
    }
  })
  pendingSubmissions = pendingSubmissions.filter(function(item) {
    return !listingSubmissionIds[item.id]
  })

  return {
    ok: true,
    data: {
      pendingListings: pendingListings,
      pendingSubmissions: pendingSubmissions,
      allPendingSubmissions: (submissionsRes.data || []).filter(function(item) {
        if (item.type === "connect") {
          return item.status === "待平台审核" && item.needsPlatformConnectReview
        }
        return item.type !== "connect"
      })
    }
  }
}

async function registerUser(openid, payload) {
  if (!payload.phone || !payload.phoneVerified || !payload.disclaimerAccepted
    || !payload.termsAccepted || !payload.privacyAccepted) {
    return { ok: false, message: "请先阅读并同意用户服务协议、隐私政策及免责申明" }
  }
  if (!payload.contact || !String(payload.contact).trim()) {
    return { ok: false, message: "请填写姓名" }
  }
  if (!/^1\d{10}$/.test(String(payload.phone))) {
    return { ok: false, message: "请输入11位有效手机号" }
  }
  var pwdValidation = validatePasswordComplexity(payload.password)
  if (!pwdValidation.ok) {
    return pwdValidation
  }
  var normalizedPhone = normalizePhone(payload.phone)
  var existingUser = await getUserByOpenid(openid)
  var existingPhone = existingUser ? normalizePhone(existingUser.phone) : ""

  if (existingUser && existingUser._id && existingPhone) {
    return {
      ok: false,
      alreadyBound: true,
      message: "当前微信已绑定 " + maskPhoneCloud(existingPhone) + "，请使用绑定号码登录"
    }
  }

  var phoneOwner = await getUserByPhone(normalizedPhone)
  if (phoneOwner && phoneOwner._id && (!existingUser || phoneOwner._id !== existingUser._id)) {
    return { ok: false, message: "该手机号已注册，请直接登录" }
  }

  var pwd = createPasswordRecord(payload.password)
  var now = formatDate(new Date())
  var profileData = {
    openid: openid,
    contact: String(payload.contact).trim(),
    phone: normalizedPhone,
    phoneVerified: true,
    phoneSource: payload.phoneSource || "manual",
    registered: true,
    disclaimerAccepted: true,
    disclaimerVersion: payload.disclaimerVersion || "v1",
    disclaimerAcceptedAt: now,
    termsAccepted: true,
    termsVersion: payload.termsVersion || "v1",
    termsAcceptedAt: now,
    privacyAccepted: true,
    privacyVersion: payload.privacyVersion || "v1",
    privacyAcceptedAt: now,
    passwordSalt: pwd.passwordSalt,
    passwordHash: pwd.passwordHash,
    lastLoginAt: now,
    updatedAt: now
  }
  if (STAFF_PHONE_WHITELIST.indexOf(normalizedPhone) > -1) {
    var existingStaffRole = existingUser && normalizeStaffRole(existingUser.staffRole)
    profileData.staffRole = existingStaffRole || "manager"
  }

  if (existingUser && existingUser._id) {
    var merged = Object.assign({}, existingUser, profileData, { openid: openid })
    if (STAFF_PHONE_WHITELIST.indexOf(normalizedPhone) === -1 && !normalizeStaffRole(existingUser.staffRole)) {
      delete merged.staffRole
    }
    if (!merged.registeredAt) {
      merged.registeredAt = now
    }
    delete merged._id
    delete merged._openid
    await db.collection(COL_USERS).doc(existingUser._id).update({ data: merged })
    await dedupeOpenidUsers(openid, existingUser._id)
  } else {
    profileData.createdAt = now
    profileData.registeredAt = now
    var preAddOwner = await getUserByPhone(normalizedPhone)
    if (preAddOwner && preAddOwner._id && String(preAddOwner.openid || "").trim() !== openid) {
      return { ok: false, message: "该手机号已注册，请直接登录" }
    }
    var addRes = await db.collection(COL_USERS).add({ data: profileData })
    if (addRes && addRes._id) {
      await dedupeOpenidUsers(openid, addRes._id)
    }
  }

  var savedUser = await getUserByOpenid(openid)
  savedUser = await applyStaffRoleIfEligible(Object.assign({}, savedUser, { _id: savedUser._id }))
  return { ok: true, data: { userProfile: sanitizeUserProfile(savedUser || profileData, openid) } }
}

async function loginUser(openid, payload) {
  if (!payload.phone || !payload.password) {
    return { ok: false, message: "请输入手机号和密码" }
  }
  var normalizedPhone = normalizePhone(payload.phone)
  if (!/^1\d{10}$/.test(normalizedPhone)) {
    return { ok: false, message: "请输入11位有效手机号" }
  }
  var user = await getUserByOpenid(openid)
  if (!user || !user._id) {
    return { ok: false, message: "尚未绑定手机号，请先完成注册绑定" }
  }
  var boundPhone = normalizePhone(user.phone)
  if (!boundPhone) {
    return { ok: false, message: "尚未绑定手机号，请先完成注册绑定" }
  }

  if (boundPhone !== normalizedPhone) {
    return {
      ok: false,
      message: "当前微信已绑定 " + maskPhoneCloud(boundPhone) + "，不支持登录其他手机号"
    }
  }
  if (isLoginLocked(user)) {
    return {
      ok: false,
      message: "登录失败次数过多，请 " + loginLockRemainingMinutes(user) + " 分钟后再试"
    }
  }
  if (!verifyPassword(payload.password, user.passwordSalt, user.passwordHash)) {
    await recordLoginFailure(user)
    var remain = Math.max(0, LOGIN_MAX_FAIL_ATTEMPTS - ((user.loginFailCount || 0) + 1))
    if (remain <= 0) {
      return {
        ok: false,
        message: "登录失败次数过多，请 " + LOGIN_LOCKOUT_MINUTES + " 分钟后再试"
      }
    }
    return {
      ok: false,
      message: "手机号或密码不正确（还可尝试 " + remain + " 次）"
    }
  }

  var disabledCheck = assertActiveUserAccount(user)
  if (!disabledCheck.ok) {
    return disabledCheck
  }
  await clearLoginFailures(user)
  user = await touchUserLogin(user)
  user = await applyStaffRoleIfEligible(Object.assign({}, user, { _id: user._id }))
  var fresh = await getUserByOpenid(openid)
  return { ok: true, data: { userProfile: sanitizeUserProfile(fresh || user, openid) } }
}

async function updateProfile(openid, payload) {
  payload = payload || {}
  var existingForStatus = await resolveSessionUser(openid, payload)
  var activeCheck = assertActiveUserAccount(existingForStatus)
  if (!activeCheck.ok) {
    return activeCheck
  }
  var baseUpdatedAt = payload._baseUpdatedAt || ""
  var patch = pickProfilePatch(payload)
  if (Object.keys(patch).length === 0) {
    return { ok: false, message: "没有可更新的资料字段" }
  }
  var existing = existingForStatus || await resolveSessionUser(openid, payload)
  if (baseUpdatedAt && existing && existing.updatedAt
    && compareUpdatedAt(baseUpdatedAt, existing.updatedAt) < 0) {
    return {
      ok: true,
      stale: true,
      message: "资料已在其他设备更新，已刷新为最新版本",
      data: { userProfile: sanitizeUserProfile(existing, openid) }
    }
  }
  protectProfileCertFields(patch, existing)
  if (Object.keys(patch).length === 0) {
    return {
      ok: true,
      data: { userProfile: sanitizeUserProfile(existing || {}, openid) }
    }
  }
  if (!existing || !existing._id) {
    return { ok: false, message: "请先登录" }
  }
  var next = Object.assign({}, existing, patch, {
    openid: openid,
    phone: existing.phone,
    updatedAt: formatDate(new Date())
  })
  delete next._id
  await db.collection(COL_USERS).doc(existing._id).update({ data: next })
  return { ok: true, data: { userProfile: sanitizeUserProfile(next, openid) } }
}

async function changePassword(openid, payload) {
  if (!payload.oldPassword || !payload.newPassword) {
    return { ok: false, message: "请填写原密码和新密码" }
  }
  var pwdValidation = validatePasswordComplexity(payload.newPassword)
  if (!pwdValidation.ok) {
    return pwdValidation
  }
  if (String(payload.oldPassword) === String(payload.newPassword)) {
    return { ok: false, message: "新密码不能与原密码相同" }
  }
  var user = await resolveSessionUser(openid, payload)
  if (!user || !user.registered || !user.phone) {
    return { ok: false, message: "请先完成注册并登录" }
  }
  if (!verifyPassword(payload.oldPassword, user.passwordSalt, user.passwordHash)) {
    return { ok: false, message: "原密码不正确" }
  }
  var pwd = createPasswordRecord(payload.newPassword)
  await db.collection(COL_USERS).doc(user._id).update({
    data: {
      passwordSalt: pwd.passwordSalt,
      passwordHash: pwd.passwordHash,
      updatedAt: formatDate(new Date())
    }
  })
  return { ok: true }
}

function isStaffProxyListing(listing) {
  return !!(listing && listing.publishedByStaff)
}

function connectInvolvesProxyListing(submission, targetListing, sourceListing) {
  if (!submission || submission.type !== "connect" || submission.matchedByStaff || submission.ownerInitiatedMatch) {
    return false
  }
  return isStaffProxyListing(targetListing) || isStaffProxyListing(sourceListing)
}

function getConnectApplicantSideModeCloud(submission, sourceListing) {
  if (!submission || submission.type !== "connect") {
    return "user"
  }
  if (submission.matchedByStaff) {
    return "proxy"
  }
  if (sourceListing && isStaffProxyListing(sourceListing)) {
    return "proxy"
  }
  return "user"
}

function getConnectRecipientSideModeCloud(submission, targetListing) {
  if (!submission || submission.type !== "connect") {
    return "user"
  }
  if (targetListing && isStaffProxyListing(targetListing)) {
    return "proxy"
  }
  return "user"
}

function isProxyToProxyConnectCloud(submission, targetListing, sourceListing) {
  return getConnectApplicantSideModeCloud(submission, sourceListing) === "proxy"
    && getConnectRecipientSideModeCloud(submission, targetListing) === "proxy"
}

function buildConnectDisclosedContactsCloud(submission, sourceListing, targetListing, submissionsMap) {
  submissionsMap = submissionsMap || {}
  if (!submission || submission.type !== "connect") {
    return null
  }
  var applicantSubmission = sourceListing && sourceListing.submissionId
    ? submissionsMap[sourceListing.submissionId] : null
  var targetSubmission = targetListing && targetListing.submissionId
    ? submissionsMap[targetListing.submissionId] : null
  var sourceProfile = listingPartyProfileServer(sourceListing, applicantSubmission)
  var targetProfile = listingPartyProfileServer(targetListing, targetSubmission)
  return {
    applicant: {
      company: sourceProfile.company || submission.company || "",
      contact: sourceProfile.contact || submission.contact || "",
      phone: sourceProfile.phone || submission.phone || "",
      role: sourceProfile.role || submission.role || ""
    },
    recipient: {
      company: targetProfile.company || "",
      contact: targetProfile.contact || "",
      phone: targetProfile.phone || "",
      role: targetProfile.role || ""
    }
  }
}

function applyProxyToProxyAutoCompleteCloud(submission, targetListing, sourceListing, submissionsMap) {
  if (!submission || submission.type !== "connect") {
    return submission
  }
  if (submission.matchedByStaff || submission.ownerInitiatedMatch) {
    return submission
  }
  if (submission.proxyAutoCompleted || submission.status === "已交换名片") {
    if (submission.status === "已交换名片" && !submission.disclosedContacts) {
      submission.disclosedContacts = buildConnectDisclosedContactsCloud(
        submission, sourceListing, targetListing, submissionsMap
      )
    }
    return submission
  }
  submission.proxyAutoCompleted = true
  submission.status = "已交换名片"
  submission.matchedAt = formatDate(new Date())
  submission.disclosedContacts = buildConnectDisclosedContactsCloud(
    submission, sourceListing, targetListing, submissionsMap
  )
  submission.statusTimeline = [{
    status: "已交换名片",
    time: formatDate(new Date()),
    hint: "双方均为平台代发，对接已自动完结，无需另行确认。"
  }]
  return submission
}

function applyStaffProxyToProxyExchangeReadyCloud(submission, targetListing, sourceListing, submissionsMap) {
  if (!submission || submission.type !== "connect" || !submission.matchedByStaff) {
    return submission
  }
  if (submission.status === "已交换名片" || submission.proxyAutoCompleted) {
    if (submission.status === "已交换名片" && !submission.disclosedContacts) {
      submission.disclosedContacts = buildConnectDisclosedContactsCloud(
        submission, sourceListing, targetListing, submissionsMap
      )
    }
    return submission
  }
  if (!isProxyToProxyConnectCloud(submission, targetListing, sourceListing)) {
    return submission
  }
  var now = formatDate(new Date())
  submission.proxyAutoCompleted = true
  submission.status = "已交换名片"
  submission.matchedAt = now
  submission.disclosedContacts = buildConnectDisclosedContactsCloud(
    submission, sourceListing, targetListing, submissionsMap
  )
  submission.statusTimeline = [{
    status: "已交换名片",
    time: now,
    hint: "平台运营代发匹配（代发资源对接代发需求），双方均为代发，已自动完结，无需交换确认。"
  }]
  return submission
}

async function resolveConnectTargetOwnerFields(submission) {
  if (!submission || !submission.targetId) {
    return submission
  }
  var targetListing = await getListingById(submission.targetId)
  if (!targetListing) {
    return submission
  }
  var phone = targetListing.actualOwnerPhone || targetListing.ownerPhone || targetListing.phone || ""
  submission.targetOwnerPhone = phone
  if (phone) {
    var ownerUser = await getUserByPhone(phone)
    submission.targetOwnerOpenid = ownerUser && ownerUser.openid ? ownerUser.openid : (targetListing.ownerOpenid || "")
  } else {
    submission.targetOwnerOpenid = targetListing.ownerOpenid || ""
  }
  if (isStaffProxyListing(targetListing)) {
    submission.recipientProxyStaffPhone = targetListing.proxyStaffPhone || ""
    submission.recipientProxyStaffOpenid = targetListing.proxyStaffOpenid || ""
  }
  var sourceListing = submission.sourceListingId ? await getListingById(submission.sourceListingId) : null
  if (sourceListing && isStaffProxyListing(sourceListing)) {
    submission.applicantProxyStaffPhone = sourceListing.proxyStaffPhone || ""
    submission.applicantProxyStaffOpenid = sourceListing.proxyStaffOpenid || ""
  }
  return submission
}

function hasApprovedBusinessCertCloud(user) {
  return !!(user && user.certStatus === "verified" && (user.certLevel === "card" || user.certLevel === "license"))
}

async function createSubmission(openid, payload) {
  payload = payload || {}
  var submission = payload.submission
  var listing = payload.listing || null
  if (!submission || !submission.id) {
    return { ok: false, message: "提交数据不完整" }
  }

  var staffUser = await verifyStaffAccess(openid)
  var user = await resolveSessionUser(openid, payload)
  if (!staffUser) {
    if (!user || !user.registered || !user.phone) {
      return { ok: false, message: "请先完成注册" }
    }
    var createActiveCheck = assertActiveUserAccount(user)
    if (!createActiveCheck.ok) {
      return createActiveCheck
    }
    if (submission.isListingReport) {
      if (submission.type !== "match") {
        return { ok: false, message: "举报提交类型无效" }
      }
      if (staffUser) {
        return { ok: false, message: "运营账号不可提交举报" }
      }
      var reportListingId = String(submission.reportListingId || "").trim()
      if (!reportListingId) {
        return { ok: false, message: "缺少举报商机编号" }
      }
      var reportTarget = await getListingById(reportListingId)
      if (!reportTarget || isListingClosed(reportTarget)) {
        return { ok: false, message: "商机不存在或已下架" }
      }
      var reportOwnerPhone = await getListingOwnerPhoneCloud(reportListingId)
      if (reportOwnerPhone && reportOwnerPhone === user.phone) {
        return { ok: false, message: "不能举报自己发布的商机" }
      }
      var dupReport = await db.collection("submissions").where({
        ownerPhone: user.phone,
        isListingReport: true,
        reportListingId: reportListingId
      }).limit(1).get()
      if (dupReport.data && dupReport.data.length) {
        return { ok: false, message: "您已举报过该商机" }
      }
    } else if ((submission.type === "demand" || submission.type === "resource"
      || submission.type === "room" || submission.type === "server")
      && !hasApprovedBusinessCertCloud(user)) {
      return { ok: false, message: "提交需求/发布资源须先完成名片认证" }
    } else if ((submission.type === "connect" || submission.type === "match")
      && !hasApprovedBusinessCertCloud(user)) {
      return { ok: false, message: "申请对接须先完成名片认证" }
    }
    submission.phone = user.phone
    submission.ownerPhone = user.phone
  }

  var existingSubmission = await getSubmissionById(submission.id)
  if (existingSubmission && existingSubmission.ownerOpenid && existingSubmission.ownerOpenid !== openid) {
    if (!staffUser) {
      return { ok: false, message: "无权修改该记录" }
    }
  }
  if (listing && listing.id) {
    var existingListing = await getListingById(listing.id)
    if (existingListing && existingListing.ownerOpenid && existingListing.ownerOpenid !== openid) {
      if (!staffUser) {
        return { ok: false, message: "无权修改该记录" }
      }
    }
  }

  submission.ownerOpenid = openid
  if (!submission.ownerPhone) {
    submission.ownerPhone = submission.phone || ""
  }
  if (staffUser && listing && listing.id && !submission.publishedByStaff) {
    submission.publishedByStaff = true
    submission.proxyStaffOpenid = openid
    submission.proxyStaffPhone = staffUser.phone || submission.phone || ""
    submission.actualOwnerPhone = submission.phone || staffUser.phone || ""
    listing.publishedByStaff = true
    listing.proxyStaffOpenid = openid
    listing.proxyStaffPhone = submission.proxyStaffPhone
    listing.actualOwnerPhone = submission.actualOwnerPhone
  }
  if (submission.type === "connect" && submission.targetId) {
    if (!staffUser) {
      var quotaCheck = await assertDailyConnectQuota(user)
      if (!quotaCheck.ok) {
        return quotaCheck
      }
    }
    var targetListing = await getListingById(submission.targetId)
    var sourceListing = submission.sourceListingId ? await getListingById(submission.sourceListingId) : null
    await resolveConnectTargetOwnerFields(submission)
    if (connectInvolvesProxyListing(submission, targetListing, sourceListing)) {
      if (isProxyToProxyConnectCloud(submission, targetListing, sourceListing)) {
        applyProxyToProxyAutoCompleteCloud(submission, targetListing, sourceListing)
      } else {
        submission.needsPlatformConnectReview = true
        submission.status = "待平台审核"
        submission.statusTimeline = [{
          status: "待平台审核",
          time: formatDate(new Date()),
          hint: "涉及平台代发商机，对接申请等待运营审批。"
        }]
      }
    }
  }

  await saveSubmissionDoc(submission)

  if (listing && listing.id) {
    listing.ownerOpenid = openid
    listing.ownerPhone = submission.ownerPhone || listing.phone || ""
    listing.submissionId = submission.id
    listing.pool = isResourceId(listing.id) ? "resource" : "demand"
    var allowAutoApprove = payload.autoApproveListing === true
    if (allowAutoApprove && !staffUser) {
      allowAutoApprove = !!(user && user.registered)
    }
    if (allowAutoApprove) {
      Object.assign(listing, buildApprovedListingUpdate(listing))
      submission.status = "已发布"
      submission.statusTimeline = submission.statusTimeline || []
      submission.statusTimeline.push({
        status: "已发布",
        time: formatDate(new Date()),
        hint: (listing.publicDisplay === false || submission.publicDisplay === false)
          ? "平台已完成初审，未开启公开展示，仅你可在提交记录中查看。"
          : "平台已完成初审，信息已在公开展示池展示。"
      })
      submission.reviewResult = "通过"
      await saveSubmissionDoc(submission)
    }
    await saveListingDoc(listing)
  }

  return {
    ok: true,
    data: {
      submission: submission,
      listing: listing
    }
  }
}

async function adminProxyPublish(staffOpenid, payload) {
  var admin = await verifyStaffAccess(staffOpenid)
  if (!admin) {
    return { ok: false, message: "无运营权限，请使用已开通运营账号（manager 或 admin）登录" }
  }

  var submission = payload.submission
  var listing = payload.listing || null
  var clientPhone = String(payload.clientPhone || (submission && submission.phone) || "").trim()
  if (!submission || !submission.id) {
    return { ok: false, message: "提交数据不完整" }
  }
  if (clientPhone && !/^1\d{10}$/.test(clientPhone)) {
    return { ok: false, message: "请填写正确的客户手机号" }
  }

  var clientUser = clientPhone ? await getUserByPhone(clientPhone) : null
  var clientOpenid = clientUser && clientUser.openid ? clientUser.openid : ""

  submission.publishedByStaff = true
  submission.proxyStaffOpenid = staffOpenid
  submission.proxyStaffPhone = payload.staffPhone || (admin && admin.phone) || ""
  submission.ownerOpenid = clientOpenid
  submission.ownerPhone = clientPhone || ""
  submission.phone = clientPhone || ""
  submission.actualOwnerPhone = clientPhone || ""

  if (listing && listing.id) {
    listing.publishedByStaff = true
    listing.proxyStaffOpenid = staffOpenid
    listing.proxyStaffPhone = submission.proxyStaffPhone
    listing.ownerOpenid = clientOpenid
    listing.ownerPhone = clientPhone || ""
    listing.actualOwnerPhone = clientPhone || ""
    listing.submissionId = submission.id
    listing.clientCompany = submission.company || listing.clientCompany || ""
    listing.clientContact = submission.contact || listing.clientContact || ""
    listing.clientRole = submission.role || listing.clientRole || ""
    if (submission.company) {
      listing.maskedCompany = maskCompany(submission.company)
    }
    var certFields = clientPhone
      ? await resolvePublisherCertFieldsForPhone(clientPhone)
      : { publisherCertLevel: "", publisherCertBadge: null }
    listing.publisherCertLevel = certFields.publisherCertLevel
    listing.publisherCertBadge = certFields.publisherCertBadge
    listing.pool = isResourceId(listing.id) ? "resource" : "demand"
    submission.listingId = listing.id
  }

  submission.clientCompany = submission.company || ""
  submission.clientContact = submission.contact || ""
  submission.clientRole = submission.role || ""

  await saveSubmissionDoc(submission)

  if (listing && listing.id) {
    if (payload.autoApproveListing) {
      Object.assign(listing, buildApprovedListingUpdate(listing))
      submission.status = "已发布"
      submission.statusTimeline = submission.statusTimeline || []
      submission.statusTimeline.push({
        status: "已发布",
        time: formatDate(new Date()),
        hint: "平台运营代发，已完成初审并在公开展示池展示。"
      })
      submission.reviewResult = "通过"
      await saveSubmissionDoc(submission)
    }
    await saveListingDoc(listing)
  }

  return {
    ok: true,
    data: {
      submission: submission,
      listing: listing
    }
  }
}

async function adminProxyConnect(staffOpenid, payload) {
  var admin = await verifyStaffAccess(staffOpenid)
  if (!admin) {
    return { ok: false, message: "无运营权限，请使用已开通运营账号（manager 或 admin）登录" }
  }

  var submission = payload.submission
  var clientPhone = String(payload.clientPhone || (submission && submission.phone) || "").trim()
  if (!submission || !submission.id || submission.type !== "connect") {
    return { ok: false, message: "对接数据不完整" }
  }
  if (clientPhone && !/^1\d{10}$/.test(clientPhone)) {
    return { ok: false, message: "请填写正确的客户手机号" }
  }

  var clientUser = clientPhone ? await getUserByPhone(clientPhone) : null
  var clientOpenid = clientUser && clientUser.openid ? clientUser.openid : ""

  submission.publishedByStaff = true
  submission.matchedByStaff = true
  submission.proxyStaffOpenid = staffOpenid
  submission.proxyStaffPhone = payload.staffPhone || (admin && admin.phone) || ""
  submission.ownerOpenid = clientOpenid
  submission.ownerPhone = clientPhone || ""
  submission.phone = clientPhone || ""
  submission.actualOwnerPhone = clientPhone || ""

  if (submission.targetId) {
    await resolveConnectTargetOwnerFields(submission)
    var targetListing = await getListingById(submission.targetId)
    var sourceListing = submission.sourceListingId ? await getListingById(submission.sourceListingId) : null
    if (isProxyToProxyConnectCloud(submission, targetListing, sourceListing)) {
      if (submission.matchedByStaff) {
        applyStaffProxyToProxyExchangeReadyCloud(submission, targetListing, sourceListing)
      } else {
        applyProxyToProxyAutoCompleteCloud(submission, targetListing, sourceListing)
      }
    }
  }

  await saveSubmissionDoc(submission)
  return {
    ok: true,
    data: {
      submission: submission
    }
  }
}

async function canStaffActOnConnectSubmission(staffOpenid, submission) {
  if (!submission || submission.type !== "connect" || !staffOpenid) {
    return false
  }
  var staff = await verifyStaffAccess(staffOpenid)
  if (!staff) {
    return false
  }
  if (await canStaffManageProxySubmission(staffOpenid, submission)) {
    return true
  }
  if (submission.recipientProxyStaffOpenid && submission.recipientProxyStaffOpenid === staffOpenid) {
    return true
  }
  if (submission.recipientProxyStaffPhone && staff.phone && submission.recipientProxyStaffPhone === staff.phone) {
    return true
  }
  if (submission.applicantProxyStaffOpenid && submission.applicantProxyStaffOpenid === staffOpenid) {
    return true
  }
  if (submission.applicantProxyStaffPhone && staff.phone && submission.applicantProxyStaffPhone === staff.phone) {
    return true
  }
  if (submission.proxyStaffPhones && staff.phone && submission.proxyStaffPhones.indexOf(staff.phone) > -1) {
    return true
  }
  if (submission.targetId) {
    var target = await getListingById(submission.targetId)
    if (target && target.publishedByStaff) {
      if (target.proxyStaffOpenid && target.proxyStaffOpenid === staffOpenid) {
        return true
      }
      if (target.proxyStaffPhone && staff.phone && target.proxyStaffPhone === staff.phone) {
        return true
      }
    }
  }
  if (submission.sourceListingId) {
    var source = await getListingById(submission.sourceListingId)
    if (source && source.publishedByStaff) {
      if (source.proxyStaffOpenid && source.proxyStaffOpenid === staffOpenid) {
        return true
      }
      if (source.proxyStaffPhone && staff.phone && source.proxyStaffPhone === staff.phone) {
        return true
      }
    }
  }
  return false
}

async function canStaffManageProxySubmission(staffOpenid, submission) {
  if (!submission || !staffOpenid) {
    return false
  }
  var staff = await verifyStaffAccess(staffOpenid)
  if (!staff) {
    return false
  }
  if (submission.proxyStaffOpenid && submission.proxyStaffOpenid === staffOpenid) {
    return true
  }
  if (submission.publishedByStaff && submission.proxyStaffPhone && staff.phone && submission.proxyStaffPhone === staff.phone) {
    return true
  }
  if (submission.listingId) {
    var listing = await getListingById(submission.listingId)
    if (listing && listing.publishedByStaff) {
      if (listing.proxyStaffOpenid && listing.proxyStaffOpenid === staffOpenid) {
        return true
      }
      if (listing.proxyStaffPhone && staff.phone && listing.proxyStaffPhone === staff.phone) {
        return true
      }
    }
  }
  return false
}

async function getListingTitleForCloseHint(listingId) {
  var listing = await getListingById(listingId)
  if (!listing) {
    return { label: "商机", title: "关联商机" }
  }
  return {
    label: isResourceId(listingId) ? "资源" : "需求",
    title: listing.title || "关联商机"
  }
}

async function closeConnectDocDueToListingClosed(connectDoc, closedListingId) {
  if (!connectDoc || !isConnectSubmissionUnfinishedCloud(connectDoc)) {
    return connectDoc
  }
  var meta = await getListingTitleForCloseHint(closedListingId)
  var hint = "关联" + meta.label + "「" + meta.title + "」已关闭，对接自动结束，无需再跟进。"
  var next = Object.assign({}, connectDoc, {
    status: "已关闭",
    closedDueToListing: closedListingId,
    closedAt: formatDate(new Date()),
    updatedAt: formatDate(new Date())
  })
  next.statusTimeline = (connectDoc.statusTimeline || []).slice()
  next.statusTimeline.push({
    status: "已关闭",
    time: formatDate(new Date()),
    hint: hint
  })
  delete next._id
  await saveSubmissionDoc(next)
  return next
}

function findClosedListingIdForConnectCloud(connect, listingsMap, submissionsMap) {
  if (!connect || connect.type !== "connect") {
    return ""
  }
  var listingIds = [connect.targetId, connect.sourceListingId]
  for (var i = 0; i < listingIds.length; i += 1) {
    var listingId = listingIds[i]
    if (!listingId) {
      continue
    }
    var listing = listingsMap[listingId]
    if (listing && isListingClosed(listing)) {
      return listingId
    }
    if (listing && listing.submissionId && submissionsMap[listing.submissionId]) {
      if (submissionsMap[listing.submissionId].status === "已关闭") {
        return listingId
      }
    }
  }
  return ""
}

async function closeUnfinishedConnectsForListingCloud(listingId) {
  if (!listingId) {
    return
  }
  var seen = {}
  async function closeFromQuery(field) {
    var res = await db.collection(COL_SUBMISSIONS).where({
      type: "connect",
      [field]: listingId
    }).limit(100).get()
    var rows = res.data || []
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i]
      if (!row.id || seen[row.id]) {
        continue
      }
      seen[row.id] = true
      await closeConnectDocDueToListingClosed(row, listingId)
    }
  }
  await closeFromQuery("targetId")
  await closeFromQuery("sourceListingId")
}

function validateConnectStatusTransition(fromStatus, toStatus, submission) {
  if (!fromStatus || !toStatus || fromStatus === toStatus) {
    return { ok: true }
  }
  var effectiveFrom = fromStatus
  if (submission && submission.type === "connect") {
    if (fromStatus === "待对方确认" && isConnectRecipientResponded(submission)) {
      effectiveFrom = "待交换确认"
    }
    if (toStatus === "已交换名片") {
      var canComplete = {
        "待对方确认": true,
        "待交换确认": true,
        "对方已确认": true
      }
      if (canComplete[fromStatus] || canComplete[effectiveFrom]) {
        return { ok: true }
      }
    }
  }
  var allowed = {
    "待平台审核": { "待对方确认": true, "已关闭": true },
    "待对方确认": { "待交换确认": true, "已交换名片": true, "已关闭": true },
    "待交换确认": { "已交换名片": true, "已关闭": true },
    "对方已确认": { "待交换确认": true, "已交换名片": true, "已关闭": true }
  }
  if (allowed[effectiveFrom] && allowed[effectiveFrom][toStatus]) {
    return { ok: true }
  }
  if (allowed[fromStatus] && allowed[fromStatus][toStatus]) {
    return { ok: true }
  }
  return { ok: false, message: "当前状态不允许此操作" }
}

function buildConnectRecipientConfirmPatch(submission) {
  var recipientRoleLabel = submission.connectDirection === "resource_to_demand" ? "需求方" : "资源方"
  var statusTimeline = (submission.statusTimeline || []).slice()
  statusTimeline.push({
    status: "待交换确认",
    time: formatDate(new Date()),
    hint: recipientRoleLabel + "已同意对接并发起交换名片，等待申请方确认。"
  })
  return {
    status: "待交换确认",
    statusTimeline: statusTimeline,
    recipientConfirmed: true,
    recipientConfirmedAt: formatDate(new Date()),
    recipientExchangeAgree: true,
    recipientExchangeAgreedAt: formatDate(new Date()),
    updatedAt: formatDate(new Date())
  }
}

async function confirmConnectByRecipientCloud(openid, payload) {
  var submissionId = payload.submissionId
  var submission = await getSubmissionById(submissionId)
  if (!submission || submission.type !== "connect") {
    return { ok: false, message: "对接申请不存在" }
  }
  var user = await resolveSessionUser(openid, payload || {})
  var userPhone = user ? user.phone : ""
  var isRecipient = await userIsConnectRecipient(openid, userPhone, submission)
  var isProxyStaff = await canStaffActOnConnectSubmission(openid, submission)
  if (!isRecipient && !isProxyStaff) {
    return { ok: false, message: "仅对接接收方可确认" }
  }
  if (submission.status === "待平台审核") {
    return { ok: false, message: "平台审批通过后才可确认" }
  }
  if (submission.status !== "待对方确认") {
    return { ok: false, message: "当前状态不可确认" }
  }
  var next = Object.assign({}, submission, buildConnectRecipientConfirmPatch(submission))
  delete next._id
  await resolveConnectTargetOwnerFields(next)
  await saveSubmissionDoc(next)
  return { ok: true, data: { submission: next } }
}

function isConnectInExchangePhaseCloud(submission) {
  if (!submission || submission.type !== "connect") {
    return false
  }
  if (submission.status === "待平台审核") {
    return false
  }
  return submission.status === "待交换确认"
    || submission.status === "对方已确认"
    || isConnectRecipientResponded(submission)
}

async function getConnectExchangeSideCloud(openid, userPhone, submission) {
  if (!submission || submission.type !== "connect") {
    return null
  }
  if (submission.ownerOpenid === openid
    || (userPhone && submission.ownerPhone === userPhone)
    || (userPhone && submission.phone === userPhone)) {
    return "applicant"
  }
  if (await userIsConnectRecipient(openid, userPhone, submission)) {
    return "recipient"
  }
  if (await canStaffActOnConnectSubmission(openid, submission)) {
    if (userPhone && submission.applicantProxyStaffPhone === userPhone) {
      return "applicant"
    }
    if (userPhone && submission.recipientProxyStaffPhone === userPhone) {
      return "recipient"
    }
    if (userPhone && submission.proxyStaffPhone === userPhone) {
      return "applicant"
    }
  }
  return null
}

async function agreeConnectExchangeCloud(openid, payload) {
  var submissionId = payload.submissionId
  var agree = payload.agree !== false
  var submission = await getSubmissionById(submissionId)
  if (!submission || submission.type !== "connect") {
    return { ok: false, message: "对接申请不存在" }
  }

  var user = await resolveSessionUser(openid, payload || {})
  var userPhone = user ? user.phone : ""
  var side = await getConnectExchangeSideCloud(openid, userPhone, submission)
  if (!side) {
    return { ok: false, message: "无权操作此对接" }
  }
  if (submission.status === "待平台审核") {
    return { ok: false, message: "平台审批通过后才可交换名片" }
  }
  if (!isConnectSubmissionUnfinishedCloud(submission)) {
    return { ok: false, message: "当前状态不可交换名片" }
  }
  if (!isConnectInExchangePhaseCloud(submission)) {
    return { ok: false, message: "当前状态不可交换名片，请下拉刷新后重试" }
  }

  if (submission.status === "待对方确认" && isConnectRecipientResponded(submission)) {
    submission.status = "待交换确认"
  }

  if (!agree) {
    var declineRoleLabel = side === "applicant"
      ? "申请方"
      : (isResourceToDemandConnect(submission) ? "需求方" : "资源方")
    var declineTimeline = (submission.statusTimeline || []).slice()
    declineTimeline.push({
      status: "已关闭",
      time: formatDate(new Date()),
      hint: declineRoleLabel + "选择暂不交换名片，对接已关闭。"
    })
    var declined = Object.assign({}, submission, {
      status: "已关闭",
      statusTimeline: declineTimeline,
      updatedAt: formatDate(new Date())
    })
    if (side === "applicant") {
      declined.applicantExchangeAgree = false
    } else {
      declined.recipientExchangeAgree = false
    }
    delete declined._id
    await saveSubmissionDoc(declined)
    return { ok: true, data: { submission: declined, closed: true } }
  }

  var exchangePatch = {}
  if (side === "applicant") {
    if (submission.applicantExchangeAgree === true) {
      return { ok: false, message: "您已确认交换名片" }
    }
    exchangePatch.applicantExchangeAgree = true
    exchangePatch.applicantExchangeAgreedAt = formatDate(new Date())
  } else {
    if (submission.recipientExchangeAgree === true) {
      return { ok: false, message: "您已确认交换名片" }
    }
    exchangePatch.recipientExchangeAgree = true
    exchangePatch.recipientExchangeAgreedAt = formatDate(new Date())
  }

  var merged = Object.assign({}, submission, exchangePatch)
  var sourceListing = merged.sourceListingId ? await getListingById(merged.sourceListingId) : null
  var targetListing = merged.targetId ? await getListingById(merged.targetId) : null
  var submissionsMap = {}
  if (sourceListing && sourceListing.submissionId) {
    var sourceSub = await getSubmissionById(sourceListing.submissionId)
    if (sourceSub) {
      submissionsMap[sourceListing.submissionId] = sourceSub
    }
  }
  if (targetListing && targetListing.submissionId) {
    var targetSub = await getSubmissionById(targetListing.submissionId)
    if (targetSub) {
      submissionsMap[targetListing.submissionId] = targetSub
    }
  }

  if (merged.applicantExchangeAgree === true && merged.recipientExchangeAgree === true) {
    var exchangedTimeline = (merged.statusTimeline || []).slice()
    exchangedTimeline.push({
      status: "已交换名片",
      time: formatDate(new Date()),
      hint: "双方已同意交换名片，联系方式已在记录中公示。"
    })
    var exchanged = Object.assign({}, merged, {
      status: "已交换名片",
      statusTimeline: exchangedTimeline,
      disclosedContacts: buildConnectDisclosedContactsCloud(
        merged, sourceListing, targetListing, submissionsMap
      ),
      matchedAt: formatDate(new Date()),
      updatedAt: formatDate(new Date())
    })
    delete exchanged._id
    await resolveConnectTargetOwnerFields(exchanged)
    await saveSubmissionDoc(exchanged)
    return { ok: true, data: { submission: exchanged, exchanged: true } }
  }

  var waitingHint = side === "applicant"
    ? "申请方已同意交换名片，等待接收方确认。"
    : ((isResourceToDemandConnect(submission) ? "需求方" : "资源方") + "已同意交换名片，等待申请方确认。")
  var waitingTimeline = (merged.statusTimeline || []).slice()
  waitingTimeline.push({
    status: "待交换确认",
    time: formatDate(new Date()),
    hint: waitingHint
  })
  var waiting = Object.assign({}, merged, {
    status: "待交换确认",
    statusTimeline: waitingTimeline,
    updatedAt: formatDate(new Date())
  })
  delete waiting._id
  await resolveConnectTargetOwnerFields(waiting)
  await saveSubmissionDoc(waiting)
  return { ok: true, data: { submission: waiting, waiting: true } }
}

async function rejectConnectByRecipientCloud(openid, payload) {
  var submissionId = payload.submissionId
  var reason = payload.reason || ""
  var submission = await getSubmissionById(submissionId)
  if (!submission || submission.type !== "connect") {
    return { ok: false, message: "对接申请不存在" }
  }
  var user = await resolveSessionUser(openid, payload || {})
  var userPhone = user ? user.phone : ""
  var isRecipient = await userIsConnectRecipient(openid, userPhone, submission)
  var isProxyStaff = await canStaffActOnConnectSubmission(openid, submission)
  if (!isRecipient && !isProxyStaff) {
    return { ok: false, message: "仅对接接收方可拒绝" }
  }
  if (submission.status !== "待对方确认") {
    return { ok: false, message: "当前状态不可操作" }
  }
  var rejectHint = reason
    || (submission.connectDirection === "resource_to_demand" ? "需求方暂不合适对接。" : "资源方暂不合适对接。")
  var statusTimeline = (submission.statusTimeline || []).slice()
  statusTimeline.push({
    status: "已关闭",
    time: formatDate(new Date()),
    hint: rejectHint
  })
  var next = Object.assign({}, submission, {
    status: "已关闭",
    statusTimeline: statusTimeline,
    reviewResult: "拒绝",
    updatedAt: formatDate(new Date())
  })
  delete next._id
  await saveSubmissionDoc(next)
  return { ok: true, data: { submission: next } }
}

async function patchSubmission(openid, payload) {
  var submissionId = payload.submissionId
  var patch = payload.patch || {}
  var baseUpdatedAt = payload._baseUpdatedAt || ""
  var submission = await getSubmissionById(submissionId)
  if (!submission) {
    return { ok: false, message: "记录不存在" }
  }

  if (baseUpdatedAt && submission.updatedAt
    && compareUpdatedAt(baseUpdatedAt, submission.updatedAt) < 0) {
    return {
      ok: true,
      stale: true,
      message: "记录已在其他设备更新，请刷新后重试",
      data: { submission: submission }
    }
  }

  var user = await resolveSessionUser(openid, payload || {})
  var userPhone = user ? user.phone : ""
  var isProxyStaff = submission.type === "connect"
    ? await canStaffActOnConnectSubmission(openid, submission)
    : await canStaffManageProxySubmission(openid, submission)
  if (!isProxyStaff) {
    var patchActiveCheck = assertActiveUserAccount(user)
    if (!patchActiveCheck.ok) {
      return patchActiveCheck
    }
  }
  var isOwner = submission.ownerOpenid === openid
    || (userPhone && submission.ownerPhone === userPhone)
    || (userPhone && submission.phone === userPhone)
  var isRecipient = submission.type === "connect"
    ? await userIsConnectRecipient(openid, userPhone, submission)
    : false
  if (!isOwner && !isRecipient && !isProxyStaff) {
    return { ok: false, message: "无权操作" }
  }

  if (patch.listingPatch && Object.prototype.hasOwnProperty.call(patch.listingPatch, "publicDisplay")) {
    if (!submission.listingId || (submission.type !== "resource" && submission.type !== "demand"
      && submission.type !== "server" && submission.type !== "room")) {
      return { ok: false, message: "该记录不支持调整公开展示" }
    }
    if (!isOwner && !isProxyStaff) {
      return { ok: false, message: "仅发布方可调整公开展示" }
    }
    var listingForDisplay = await getListingById(submission.listingId)
    if (!listingForDisplay) {
      return { ok: false, message: "关联商机不存在" }
    }
    if (isListingClosed(listingForDisplay)) {
      return { ok: false, message: "已关闭的商机不可调整公开展示" }
    }
    if (patch.publicDisplay === undefined) {
      patch.publicDisplay = patch.listingPatch.publicDisplay !== false
    }
  }

  if (submission.type === "connect" && patch.status && patch.status !== submission.status) {
    var statusCheck = validateConnectStatusTransition(submission.status, patch.status, submission)
    if (!statusCheck.ok) {
      return statusCheck
    }
  }

  var next = Object.assign({}, submission, patch, { updatedAt: formatDate(new Date()) })
  if (submission.type === "connect"
    && next.status === "待交换确认"
    && submission.status === "待对方确认"
    && isConnectRecipientResponded(submission)) {
    next.status = "待交换确认"
  }
  delete next._id
  if (submission.type === "connect" && isRecipient && submission.targetId) {
    await resolveConnectTargetOwnerFields(next)
  }
  await saveSubmissionDoc(next)

  if (patch.listingPatch && submission.listingId) {
    var listing = await getListingById(submission.listingId)
    if (listing) {
      var listingNext = Object.assign({}, listing, patch.listingPatch, { updatedAt: formatDate(new Date()) })
      delete listingNext._id
      await saveListingDoc(listingNext)
      next.listing = listingNext
      if (patch.listingPatch.status === "closed" || patch.listingPatch.verification === "已关闭") {
        await closeUnfinishedConnectsForListingCloud(submission.listingId)
      }
    }
  } else if (patch.status === "已关闭" && submission.listingId
    && submission.type !== "connect" && submission.type !== "certify") {
    await closeUnfinishedConnectsForListingCloud(submission.listingId)
  }

  if (patch.removeListingId) {
    await removeListingById(patch.removeListingId)
  }

  return { ok: true, data: { submission: next, listing: next.listing || null } }
}


async function adminReview(openid, payload) {
  var admin = await verifyStaffAccess(openid)
  if (!admin) {
    return { ok: false, message: "无运营权限，请使用已开通运营账号（manager 或 admin）登录" }
  }

  if (payload.reviewType === "listing") {
    var listing = await getListingById(payload.id)
    if (!listing) {
      return { ok: false, message: "公示不存在" }
    }
    if (payload.action === "approve") {
      Object.assign(listing, buildApprovedListingUpdate(listing))
      await saveListingDoc(listing)
      if (listing.submissionId) {
        var sub = await getSubmissionById(listing.submissionId)
        if (sub) {
          sub.status = "已发布"
          sub.statusTimeline = sub.statusTimeline || []
          sub.statusTimeline.push({
            status: "已发布",
            time: formatDate(new Date()),
            hint: (listing.publicDisplay === false || sub.publicDisplay === false)
              ? "撮合经理已完成初审，未开启公开展示，仅发布方可在提交记录中查看。"
              : "撮合经理已完成初审，信息已在公开展示池展示。"
          })
          sub.reviewResult = "通过"
          await saveSubmissionDoc(sub)
        }
      }
      return { ok: true, data: { listing: listing } }
    }
    if (payload.action === "reject") {
      await removeListingById(listing.id)
      await closeUnfinishedConnectsForListingCloud(listing.id)
      if (listing.submissionId) {
        var rejectedSub = await getSubmissionById(listing.submissionId)
        if (rejectedSub) {
          rejectedSub.status = "已关闭"
          rejectedSub.listingId = ""
          rejectedSub.statusTimeline = rejectedSub.statusTimeline || []
          rejectedSub.statusTimeline.push({
            status: "已关闭",
            time: formatDate(new Date()),
            hint: payload.reason || "未通过平台初审，已从公示池下架。"
          })
          rejectedSub.reviewResult = "驳回"
          await saveSubmissionDoc(rejectedSub)
        }
      }
      return { ok: true, data: { removedListingId: listing.id } }
    }
  }

  if (payload.reviewType === "submission") {
    var record = await getSubmissionById(payload.id)
    if (!record) {
      return { ok: false, message: "申请不存在" }
    }
    if (payload.action === "approve") {
      if (record.type === "certify") {
        record.status = "已认证"
        record.statusTimeline = record.statusTimeline || []
        record.statusTimeline.push({
          status: "已认证",
          time: formatDate(new Date()),
          hint: "企业认证已通过。"
        })
        record.reviewResult = "通过"
        await saveSubmissionDoc(record)
        var certUserPatch = {
          certLevel: record.certLevel || "card",
          certStatus: "verified",
          certVerifiedAt: formatDate(new Date()),
          company: record.company || "",
          creditCode: record.creditCode || "",
          role: record.role || "",
          region: record.region || "",
          contact: record.contact || "",
          phone: record.phone || "",
          email: record.email || "",
          website: record.website || ""
        }
        if (record.ownerOpenid) {
          await upsertUser(record.ownerOpenid, certUserPatch)
        } else {
          var certPhone = record.phone || record.ownerPhone || ""
          if (certPhone) {
            var certUserByPhone = await getUserByPhone(certPhone)
            if (certUserByPhone && certUserByPhone.openid) {
              await upsertUser(certUserByPhone.openid, certUserPatch)
            }
          }
        }
      } else if (record.type === "connect" && record.needsPlatformConnectReview) {
        record.status = "待对方确认"
        record.statusTimeline = record.statusTimeline || []
        record.statusTimeline.push({
          status: "待对方确认",
          time: formatDate(new Date()),
          hint: record.connectDirection === "resource_to_demand"
            ? "平台已批准对接，等待需求方确认是否愿意沟通。"
            : "平台已批准对接，等待资源方确认是否愿意沟通。"
        })
        record.reviewResult = "通过"
        record.platformConnectApproved = true
        await saveSubmissionDoc(record)
      } else {
        record.status = "已推荐"
        record.statusTimeline = record.statusTimeline || []
        record.statusTimeline.push({
          status: "已推荐",
          time: formatDate(new Date()),
          hint: "撮合经理已受理，将安排后续推荐或对接。"
        })
        record.reviewResult = "通过"
        await saveSubmissionDoc(record)
      }
      return { ok: true, data: { submission: record } }
    }
    if (payload.action === "reject") {
      record.status = "已关闭"
      record.statusTimeline = record.statusTimeline || []
      record.statusTimeline.push({
        status: "已关闭",
        time: formatDate(new Date()),
        hint: payload.reason || "未通过平台初审。"
      })
      record.reviewResult = "驳回"
      await saveSubmissionDoc(record)
      if (record.type === "certify" && record.ownerOpenid) {
        var cardCert = null
        if (record.certLevel === "license") {
          var submissions = await db.collection(COL_SUBMISSIONS)
            .where({ ownerOpenid: record.ownerOpenid, type: "certify", certLevel: "card", status: "已认证" })
            .limit(1)
            .get()
          cardCert = submissions.data && submissions.data[0]
        }
        if (record.certLevel === "license" && cardCert) {
          await upsertUser(record.ownerOpenid, {
            certStatus: "verified",
            certLevel: "card"
          })
        } else {
          await upsertUser(record.ownerOpenid, {
            certStatus: "rejected"
          })
        }
      }
      return { ok: true, data: { submission: record } }
    }
  }

  return { ok: false, message: "未知审核操作" }
}

var SEED_REGIONS = ["华北", "东北", "华东", "华中", "华南", "西南", "西北", "港澳台"]
var SEED_GPUS = ["H800", "H100", "A100", "A800", "昇腾910B", "MI300X", "L40S"]
var SEED_CPUS = ["双路 Intel Xeon", "双路 AMD EPYC", "鲲鹏 920", "海光 x86"]
var SEED_MEMORY = ["512G DDR5", "1TB DDR5", "2TB DDR5", "768G DDR4"]
var SEED_STORAGE = ["4×3.84T NVMe", "8×1.92T NVMe", "2×7.68T NVMe", "全闪 NVMe"]
var SEED_NETWORK = ["400G IB", "200G IB", "100G RDMA", "25G 以太 + RDMA"]
var SEED_SUPPLY_COMPANIES = [
  "华创智算集成", "浪潮 AI 服务器", "新华三智算", "宁畅算力科技", "超聚变硬件",
  "联想 AI 基础设施", "中科曙光整机", "华为算力伙伴", "英业达渠道", "广达 ODM"
]
var SEED_DEMAND_COMPANIES = [
  "星图大模型", "云鲸智算", "深蓝 AI 实验室", "九章科技", "智源算力中心",
  "百川智能", "阶跃星辰", "无问芯穹", "硅基流动", "清微智能"
]
var SEED_CONTACTS = ["张经理", "李工", "王总", "陈主任", "刘博士", "赵采购", "周运维", "吴总监"]
var SEED_DELIVERY_SITES = [
  "上海临港智算中心", "北京亦庄 IDC", "深圳坂田机房", "杭州未来科技城",
  "成都天府智算", "广州南沙数据中心", "南京江北新区", "武汉光谷软件园"
]
var SEED_RESOURCE_TITLES = [
  "现货供应 {gpu} 训练服务器",
  "{region} 可发 {gpu} AI 一体机",
  "渠道价供应 {scale} {gpu} 整机",
  "{gpu} 八卡训练节点 · 可定制",
  "国产/进口 {gpu} 服务器批量供货"
]
var SEED_DEMAND_TITLES = [
  "紧急采购 {scale} {gpu} 训练整机",
  "{region} 项目需 {gpu} 服务器",
  "大模型训练集群 {gpu} 整机招标",
  "扩容采购 {gpu} 节点 {scale}",
  "寻求 {gpu} 整机供应商 · 长期合作"
]
var SEED_RESOURCE_PRICES = [
  "¥68万/台起", "¥82万/台", "按配置单台报价", "¥95万/台可谈", "渠道价面议", "批量 5 台以上优惠"
]
var SEED_DEMAND_BUDGETS = [
  "单台预算 80 万内", "总预算 3000 万", "项目预算待评估", "¥120万/台以内", "年度框架采购", "分批付款可谈"
]
var SEED_DELIVERY_CYCLES = [
  "现货 3 天发货", "7 个工作日交付", "15 天分批到货", "4 周内完成交付", "按项目节点供货"
]
var SEED_DEMAND_CYCLES = [
  "2026 Q3 首批到货", "尽快 · 两批交付", "8 月前完成上架", "年底前交付 60%", "下月启动采购"
]
var SEED_RESOURCE_DESC = [
  "含上架调试、三年原厂维保，支持定制化 BIOS 与网络拓扑。",
  "可提供现场上架与压力测试报告，支持香港/东南亚发货。",
  "渠道库存充足，支持国产化替代方案与合规报关。",
  "含 GPU 驱动预装与 NCCL 环境调试，7×24 技术支持。",
  "支持租赁转购与以旧换新，可按项目提供备机。"
]
var SEED_DEMAND_DESC = [
  "需预装 Ubuntu 22.04 与 CUDA 环境，要求支持 RDMA 集群组网。",
  "希望供应商提供上架与联调服务，接受国产 GPU 备选方案。",
  "项目分三期建设，首期 {scale}，要求提供质保与备件。",
  "需符合等保与数据本地化要求，交货前提供配置验收单。",
  "优先华东交付，要求提供过往同类项目案例与交付周期。"
]
var SEED_RESOURCE_TAGS = ["整机交付", "渠道现货", "可定制", "含维保", "支持国产化", "可发海外"]
var SEED_DEMAND_TAGS = ["批量采购", "近期启动", "长期合作", "招标采购", "框架协议", "分期交付"]
var SEED_WARRANTIES = ["三年原厂维保", "五年延保可选", "含上门安装调试", "一年标准维保 + 可续保"]
var SEED_SERVER_BRANDS = ["不限", "浪潮", "新华三", "超聚变", "宁畅", "华为"]

var DEMO_SEED_DEFAULT_COUNT = 4
var DEMO_SEED_LEGACY_CLEAR_COUNT = 100
var DEMO_SEED_START_PHONE = 18800000000

var SEED_DEMO_ACCOUNT_PRESETS = [
  {
    contact: "张供给",
    supplyCompany: "华创智算集成有限公司",
    demandCompany: "星图科技研发中心",
    userCompany: "华创智算集成有限公司",
    role: "服务器厂商/集成商",
    region: "华东",
    deliverySite: "上海",
    gpu: "NVIDIA H800",
    resourceTitle: "华创现货供应 H800 训练服务器",
    demandTitle: "华创内部扩容采购 H800 节点",
    resourceScale: "12 台",
    demandScale: "8 台"
  },
  {
    contact: "李需求",
    supplyCompany: "宁畅算力科技有限公司",
    demandCompany: "星图大模型研究院",
    userCompany: "星图大模型研究院",
    role: "算力需求方",
    region: "华北",
    deliverySite: "北京",
    gpu: "NVIDIA H20",
    resourceTitle: "宁畅渠道 H20 整机可发",
    demandTitle: "大模型训练集群紧急采购 H20",
    resourceScale: "16 台",
    demandScale: "32 台"
  },
  {
    contact: "王综合",
    supplyCompany: "云鲸算力供应链",
    demandCompany: "云鲸智算科技有限公司",
    userCompany: "云鲸智算科技有限公司",
    role: "算力需求方",
    region: "华南",
    deliverySite: "深圳",
    gpu: "NVIDIA A800",
    resourceTitle: "渠道价供应 A800 八卡训练整机",
    demandTitle: "深圳项目扩容采购 A800 整机",
    resourceScale: "20 台",
    demandScale: "24 台"
  },
  {
    contact: "赵供给",
    supplyCompany: "超聚变服务器华南中心",
    demandCompany: "西南数智产业园",
    userCompany: "超聚变服务器华南中心",
    role: "服务器厂商/集成商",
    region: "西南",
    deliverySite: "成都",
    gpu: "昇腾 910B",
    resourceTitle: "国产昇腾 910B 集群整机供货",
    demandTitle: "西南智算中心采购昇腾训练节点",
    resourceScale: "10 台",
    demandScale: "16 台"
  }
]

function seedRand(index, salt) {
  var str = String(index) + ":" + String(salt) + ":seed_v2"
  var hash = 0
  for (var j = 0; j < str.length; j += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(j)
    hash |= 0
  }
  return Math.abs(hash)
}

function seedPick(index, salt, list) {
  if (!list || !list.length) {
    return ""
  }
  return list[seedRand(index, salt) % list.length]
}

function seedFill(template, vars) {
  return String(template || "").replace(/\{(\w+)\}/g, function(_, key) {
    return vars[key] !== undefined ? vars[key] : ""
  })
}

function buildSeedConfig(index, gpuOverride) {
  var gpu = gpuOverride || seedPick(index, "gpu", SEED_GPUS)
  var cards = [4, 8, 8, 16][seedRand(index, "cards") % 4]
  var cpu = seedPick(index, "cpu", SEED_CPUS)
  var memory = seedPick(index, "memory", SEED_MEMORY)
  var storage = seedPick(index, "storage", SEED_STORAGE)
  var network = seedPick(index, "network", SEED_NETWORK)
  var cooling = seedRand(index, "cooling") % 3 === 0 ? "，液冷" : ""
  return cards + "×" + gpu + "，" + cpu + "，" + memory + "，" + storage + "，" + network + cooling
}

function buildSeedProfile(index, phone) {
  var preset = SEED_DEMO_ACCOUNT_PRESETS[index] || null
  var region = preset ? preset.region : seedPick(index, "region", SEED_REGIONS)
  var gpu = preset ? preset.gpu : seedPick(index, "gpu2", SEED_GPUS)
  var config = buildSeedConfig(index, preset ? preset.gpu : "")
  var resourceScale = preset && preset.resourceScale
    ? preset.resourceScale
    : (8 + (seedRand(index, "rscale") % 193)) + " 台"
  var demandScale = preset && preset.demandScale
    ? preset.demandScale
    : (16 + (seedRand(index, "dscale") % 285)) + " 台"
  var deliverySite = preset ? preset.deliverySite : seedPick(index, "site", SEED_DELIVERY_SITES)
  var vars = { gpu: gpu, region: region, scale: demandScale }
  return {
    index: index,
    phone: phone,
    region: region,
    gpu: gpu,
    config: config,
    resourceScale: resourceScale,
    demandScale: demandScale,
    deliverySite: deliverySite,
    supplyCompany: preset ? preset.supplyCompany : seedPick(index, "supplyCo", SEED_SUPPLY_COMPANIES),
    demandCompany: preset ? preset.demandCompany : seedPick(index, "demandCo", SEED_DEMAND_COMPANIES),
    userCompany: preset ? preset.userCompany : seedPick(index, "userCo", SEED_SUPPLY_COMPANIES.concat(SEED_DEMAND_COMPANIES)),
    contact: preset ? preset.contact : seedPick(index, "contact", SEED_CONTACTS),
    role: preset ? preset.role : (seedRand(index, "role") % 2 === 0 ? "服务器厂商/集成商" : "算力需求方"),
    resourceTitle: preset ? preset.resourceTitle : seedFill(seedPick(index, "resTitle", SEED_RESOURCE_TITLES), {
      gpu: gpu,
      region: region,
      scale: resourceScale
    }),
    demandTitle: preset ? preset.demandTitle : seedFill(seedPick(index, "demTitle", SEED_DEMAND_TITLES), vars),
    resourcePrice: seedPick(index, "rprice", SEED_RESOURCE_PRICES),
    demandBudget: seedPick(index, "dbudget", SEED_DEMAND_BUDGETS),
    resourceCycle: seedPick(index, "rcycle", SEED_DELIVERY_CYCLES),
    demandCycle: seedPick(index, "dcycle", SEED_DEMAND_CYCLES),
    resourceDesc: seedPick(index, "rdesc", SEED_RESOURCE_DESC),
    demandDesc: seedFill(seedPick(index, "ddesc", SEED_DEMAND_DESC), vars),
    resourceTag: "整机交付",
    demandTag: seedPick(index, "dtag", SEED_DEMAND_TAGS),
    warranty: seedPick(index, "warranty", SEED_WARRANTIES),
    serverBrand: seedPick(index, "brand", SEED_SERVER_BRANDS),
    delivery: "整机交付",
    matchScore: 72 + (seedRand(index, "match") % 24)
  }
}

function maskCompany(name) {
  if (!name) {
    return "已登记企业"
  }
  if (name.length <= 2) {
    return name.charAt(0) + "*"
  }
  if (name.length <= 4) {
    return name.slice(0, 1) + "**" + name.slice(-1)
  }
  return name.slice(0, 2) + "***" + name.slice(-2)
}

function padSeedIndex(index) {
  var text = String(index)
  while (text.length < 5) {
    text = "0" + text
  }
  return text
}

function buildPublisherCertBadge(level) {
  if (level === "license") {
    return {
      level: "license",
      text: "执照",
      fullText: "营业执照认证",
      badgeClass: "publisher-license"
    }
  }
  if (level === "card") {
    return {
      level: "card",
      text: "名片",
      fullText: "名片认证",
      badgeClass: "card"
    }
  }
  return null
}

async function resolvePublisherCertFieldsForPhone(phone) {
  if (!phone) {
    return { publisherCertLevel: "", publisherCertBadge: null }
  }
  var level = ""
  var user = await getUserByPhone(phone)
  if (user && user.certStatus === "verified" && user.certLevel) {
    level = user.certLevel
  }
  if (!level) {
    try {
      var licenseRes = await db.collection(COL_SUBMISSIONS).where({
        type: "certify",
        certLevel: "license",
        status: "已认证",
        ownerPhone: phone
      }).limit(1).get()
      if (licenseRes.data && licenseRes.data[0]) {
        level = "license"
      } else {
        var cardRes = await db.collection(COL_SUBMISSIONS).where({
          type: "certify",
          certLevel: "card",
          status: "已认证",
          ownerPhone: phone
        }).limit(1).get()
        if (cardRes.data && cardRes.data[0]) {
          level = "card"
        }
      }
    } catch (certLookupError) {
      console.warn("resolvePublisherCertFieldsForPhone failed", certLookupError)
    }
  }
  return {
    publisherCertLevel: level,
    publisherCertBadge: level ? buildPublisherCertBadge(level) : null
  }
}

function buildSeedPublisherBadge() {
  return {
    level: "card",
    text: "名片",
    fullText: "名片认证",
    badgeClass: "card"
  }
}

function buildSeedServerResourceDetails(profile) {
  return [
    { label: "资源类型", value: "算力整机" },
    { label: "配置说明", value: profile.config },
    { label: "交货地址", value: profile.deliverySite },
    { label: "可供应台数", value: profile.resourceScale },
    { label: "交货周期", value: profile.resourceCycle },
    { label: "交付方式", value: profile.delivery },
    { label: "质保说明", value: profile.warranty },
    { label: "价格说明", value: profile.resourcePrice },
    { label: "企业角色", value: "服务器厂商/集成商" },
    { label: "补充说明", value: profile.resourceDesc }
  ]
}

function buildSeedResourceListing(profile, now, dateOnly) {
  var idx = padSeedIndex(profile.index)
  var submissionId = "SRES-SEEDR-" + idx
  var configShort = profile.config.length > 36 ? profile.config.slice(0, 36) + "..." : profile.config
  var listingRegion = profile.deliverySite
  var listing = {
    id: "URES-SEEDR" + idx,
    type: "算力整机",
    region: listingRegion,
    title: profile.resourceTitle,
    city: listingRegion,
    scale: profile.resourceScale,
    cycle: profile.resourceCycle,
    price: profile.resourcePrice,
    verification: "资源已初审",
    matchScore: profile.matchScore,
    publishedAt: now,
    isUserPublished: true,
    submissionId: submissionId,
    configSpec: profile.config,
    highlights: [configShort, profile.deliverySite, profile.resourceScale, profile.warranty],
    tags: ["算力整机", listingRegion, profile.resourceTag],
    maskedCompany: maskCompany(profile.supplyCompany),
    publisherCertLevel: "card",
    publisherCertBadge: buildSeedPublisherBadge(),
    summary: profile.resourceDesc,
    scene: "",
    details: buildSeedServerResourceDetails(profile),
    hidden: ["企业全称", "联系人", "手机号", "精确报价", "库存明细"],
    pool: "resource",
    ownerPhone: profile.phone,
    createdAt: now,
    updatedAt: now
  }
  var submission = {
    id: submissionId,
    type: "resource",
    status: "已发布",
    company: profile.supplyCompany,
    role: "服务器厂商/集成商",
    region: profile.region,
    contact: profile.contact,
    phone: profile.phone,
    title: profile.resourceTitle,
    listingType: "算力整机",
    scale: profile.resourceScale,
    price: profile.resourcePrice,
    cycle: profile.resourceCycle,
    delivery: profile.delivery,
    deliveryTime: profile.resourceCycle,
    warranty: profile.warranty,
    configSpec: profile.config,
    procurementRegion: profile.deliverySite,
    description: profile.resourceDesc,
    listingId: listing.id,
    ownerPhone: profile.phone,
    reviewResult: "通过",
    statusTimeline: [
      {
        status: "已发布",
        time: now,
        hint: "平台已完成初审，信息已在公开展示池展示。"
      }
    ],
    createdAt: now,
    updatedAt: now
  }
  return { listing: listing, submission: submission }
}

function buildSeedServerDemandDetails(profile) {
  var rows = [
    { label: "需求说明", value: profile.demandDesc },
    { label: "需求类型", value: "算力整机" },
    { label: "配置要求", value: profile.config },
    { label: "交货地址", value: profile.deliverySite },
    { label: "采购台数", value: profile.demandScale },
    { label: "品牌偏好", value: profile.serverBrand },
    { label: "期望交货", value: profile.demandCycle },
    { label: "预算范围", value: profile.demandBudget }
  ]
  return rows.filter(function(row) {
    return row.value
  })
}

function buildSeedDemandListing(profile, now, dateOnly) {
  var idx = padSeedIndex(profile.index)
  var submissionId = "SDEM-SEEDR-" + idx
  var configShort = profile.config.length > 36 ? profile.config.slice(0, 36) + "..." : profile.config
  var listing = {
    id: "UDEM-SEEDR" + idx,
    type: "算力整机",
    region: profile.region,
    title: profile.demandTitle,
    city: profile.region,
    scale: profile.demandScale,
    budget: profile.demandBudget,
    cycle: profile.demandCycle,
    verification: "需求已初审",
    matchScore: profile.matchScore,
    publishedAt: now,
    isUserPublished: true,
    submissionId: submissionId,
    configSpec: profile.config,
    highlights: [configShort, profile.deliverySite, profile.demandScale, profile.demandBudget],
    tags: ["算力整机", profile.region, profile.demandTag],
    maskedCompany: maskCompany(profile.demandCompany),
    publisherCertLevel: "card",
    publisherCertBadge: buildSeedPublisherBadge(),
    summary: profile.demandDesc,
    scene: "",
    details: buildSeedServerDemandDetails(profile),
    hidden: ["企业全称", "联系人", "手机号", "详细预算", "招标文件"],
    pool: "demand",
    ownerPhone: profile.phone,
    createdAt: now,
    updatedAt: now
  }
  var submission = {
    id: submissionId,
    type: "server",
    status: "已发布",
    company: profile.demandCompany,
    role: "算力需求方",
    region: profile.region,
    contact: profile.contact,
    phone: profile.phone,
    title: profile.demandTitle,
    listingType: "算力整机",
    scale: profile.demandScale,
    budget: profile.demandBudget,
    deliveryTime: profile.demandCycle,
    serverBrand: profile.serverBrand,
    configSpec: profile.config,
    procurementRegion: profile.deliverySite,
    description: profile.demandDesc,
    listingId: listing.id,
    ownerPhone: profile.phone,
    reviewResult: "通过",
    statusTimeline: [
      {
        status: "已发布",
        time: now,
        hint: "平台已完成初审，信息已在公开展示池展示。"
      }
    ],
    createdAt: now,
    updatedAt: now
  }
  return { listing: listing, submission: submission }
}

async function addSeedDocIfNotExists(collectionName, doc) {
  var existing = collectionName === COL_USERS
    ? await getUserByPhone(doc.phone)
    : (collectionName === COL_LISTINGS
      ? await getListingById(doc.id)
      : await getSubmissionById(doc.id))
  if (existing) {
    return false
  }
  var data = Object.assign({}, doc, {
    createdAt: doc.createdAt || formatDate(new Date()),
    updatedAt: formatDate(new Date())
  })
  await db.collection(collectionName).add({ data: data })
  return true
}

async function seedDemoData(openid, payload) {
  if (!DEMO_SEED_TOOLS_ENABLED) {
    return { ok: false, message: "演示数据功能已关闭（生产环境默认禁用）" }
  }
  var admin = await verifyStaffAccess(openid)
  if (!admin) {
    return { ok: false, message: "无运营权限，请使用运营账号（manager 或 admin）登录" }
  }

  var startPhone = Number(payload.startPhone || DEMO_SEED_START_PHONE)
  var totalCount = Math.min(Math.max(Number(payload.totalCount || payload.count || DEMO_SEED_DEFAULT_COUNT), 1), 20)
  var offset = Math.max(Number(payload.offset || 0), 0)
  var batchSize = Math.min(Math.max(Number(payload.batchSize || DEMO_SEED_DEFAULT_COUNT), 1), 20)
  var endIndex = Math.min(offset + batchSize, totalCount)
  var userPassword = String(payload.userPassword || payload.seedPassword || "Demo1234")
  var seedPwdCheck = validatePasswordComplexity(userPassword)
  if (!seedPwdCheck.ok) {
    return seedPwdCheck
  }

  var stats = {
    usersCreated: 0,
    usersSkipped: 0,
    resourcesCreated: 0,
    resourcesSkipped: 0,
    demandsCreated: 0,
    demandsSkipped: 0,
    startPhone: String(startPhone),
    endPhone: String(startPhone + totalCount - 1),
    totalCount: totalCount,
    offset: offset,
    batchSize: batchSize,
    processed: 0,
    done: endIndex >= totalCount,
    nextOffset: endIndex >= totalCount ? totalCount : endIndex
  }
  var now = formatDate(new Date())
  var dateOnly = formatDateOnly(new Date())

  for (var i = offset; i < endIndex; i += 1) {
    var phone = String(startPhone + i)
    if (!/^1\d{10}$/.test(phone)) {
      return { ok: false, message: "手机号超出有效范围: " + phone }
    }
    var seedProfile = buildSeedProfile(i, phone)
    var existingUser = await getUserByPhone(phone)

    if (!existingUser) {
      var pwd = createPasswordRecord(userPassword)
      var profile = {
        contact: seedProfile.contact,
        phone: phone,
        company: seedProfile.userCompany,
        role: seedProfile.role,
        region: seedProfile.region,
        phoneVerified: true,
        phoneSource: "seed",
        registered: true,
        disclaimerAccepted: true,
        disclaimerVersion: "v1",
        disclaimerAcceptedAt: now,
        termsAccepted: true,
        termsVersion: "v1",
        termsAcceptedAt: now,
        privacyAccepted: true,
        privacyVersion: "v1",
        privacyAcceptedAt: now,
        registeredAt: now,
        passwordSalt: pwd.passwordSalt,
        passwordHash: pwd.passwordHash,
        certStatus: "verified",
        certLevel: "card",
        certVerifiedAt: now,
        onboardingCompleted: true,
        createdAt: now,
        updatedAt: now
      }
      if (await addSeedDocIfNotExists(COL_USERS, profile)) {
        stats.usersCreated += 1
      } else {
        stats.usersSkipped += 1
      }
    } else {
      stats.usersSkipped += 1
    }

    var resourcePack = buildSeedResourceListing(seedProfile, now, dateOnly)
    if (await addSeedDocIfNotExists(COL_SUBMISSIONS, resourcePack.submission)) {
      if (await addSeedDocIfNotExists(COL_LISTINGS, resourcePack.listing)) {
        stats.resourcesCreated += 1
      } else {
        stats.resourcesSkipped += 1
      }
    } else {
      stats.resourcesSkipped += 1
    }

    var demandPack = buildSeedDemandListing(seedProfile, now, dateOnly)
    if (await addSeedDocIfNotExists(COL_SUBMISSIONS, demandPack.submission)) {
      if (await addSeedDocIfNotExists(COL_LISTINGS, demandPack.listing)) {
        stats.demandsCreated += 1
      } else {
        stats.demandsSkipped += 1
      }
    } else {
      stats.demandsSkipped += 1
    }

    stats.processed += 1
  }

  return {
    ok: true,
    data: stats,
    message: stats.done ? "演示数据导入完成" : ("已导入 " + stats.nextOffset + "/" + totalCount + "，请继续下一批")
  }
}

async function clearSeedPhone(phone, index) {
  var stats = {
    usersRemoved: 0,
    listingsRemoved: 0,
    submissionsRemoved: 0
  }
  var idx = padSeedIndex(index)
  var user = await getUserByPhone(phone)
  if (user && user._id) {
    await db.collection(COL_USERS).doc(user._id).remove()
    stats.usersRemoved += 1
  }
  stats.listingsRemoved += await removeAllByWhere(COL_LISTINGS, { ownerPhone: phone })
  stats.submissionsRemoved += await removeAllByWhere(COL_SUBMISSIONS, { ownerPhone: phone })
  try {
    await removeAllByWhere(COL_FAVORITES_LEGACY, { phone: phone })
  } catch (legacyCleanupError) {
    console.warn("legacy favorites cleanup skipped", legacyCleanupError)
  }
  if (await removeListingById("URES-SEEDR" + idx)) {
    stats.listingsRemoved += 1
  }
  if (await removeListingById("UDEM-SEEDR" + idx)) {
    stats.listingsRemoved += 1
  }
  if (await removeSubmissionById("SRES-SEEDR-" + idx)) {
    stats.submissionsRemoved += 1
  }
  if (await removeSubmissionById("SDEM-SEEDR-" + idx)) {
    stats.submissionsRemoved += 1
  }
  if (await removeSubmissionById("SUB-SEEDR-RES-" + idx)) {
    stats.submissionsRemoved += 1
  }
  if (await removeSubmissionById("SUB-SEEDR-DEM-" + idx)) {
    stats.submissionsRemoved += 1
  }
  return stats
}

async function clearDemoData(openid, payload) {
  if (!DEMO_SEED_TOOLS_ENABLED) {
    return { ok: false, message: "演示数据功能已关闭（生产环境默认禁用）" }
  }
  var admin = await verifyStaffAccess(openid)
  if (!admin) {
    return { ok: false, message: "无运营权限，请使用运营账号（manager 或 admin）登录" }
  }

  var startPhone = Number(payload.startPhone || DEMO_SEED_START_PHONE)
  var totalCount = Math.min(Math.max(Number(payload.totalCount || payload.count || DEMO_SEED_LEGACY_CLEAR_COUNT), 1), 200)
  var offset = Math.max(Number(payload.offset || 0), 0)
  var batchSize = Math.min(Math.max(Number(payload.batchSize || 10), 1), 20)
  var endIndex = Math.min(offset + batchSize, totalCount)
  var stats = {
    usersRemoved: 0,
    listingsRemoved: 0,
    submissionsRemoved: 0,
    startPhone: String(startPhone),
    endPhone: String(startPhone + totalCount - 1),
    totalCount: totalCount,
    offset: offset,
    batchSize: batchSize,
    processed: 0,
    done: endIndex >= totalCount,
    nextOffset: endIndex >= totalCount ? totalCount : endIndex
  }

  for (var i = offset; i < endIndex; i += 1) {
    var phone = String(startPhone + i)
    if (!/^1\d{10}$/.test(phone)) {
      return { ok: false, message: "手机号超出有效范围: " + phone }
    }
    var phoneStats = await clearSeedPhone(phone, i)
    stats.usersRemoved += phoneStats.usersRemoved
    stats.listingsRemoved += phoneStats.listingsRemoved
    stats.submissionsRemoved += phoneStats.submissionsRemoved
    stats.processed += 1
  }

  return {
    ok: true,
    data: stats,
    message: stats.done ? "演示数据已清空" : ("已清空 " + stats.nextOffset + "/" + totalCount + "，请继续下一批")
  }
}

exports.main = async function(event) {
  var action = event.action
  var payload = event.payload || {}
  var wxContext = cloud.getWXContext()
  var openid = wxContext.OPENID

  try {
    if (action === "seedDemoData") {
      return await seedDemoData(openid || "", payload)
    }
    if (action === "clearDemoData") {
      return await clearDemoData(openid || "", payload)
    }
  } catch (error) {
    console.error("tradeApi error", action, error)
    return {
      ok: false,
      message: error.message || "云函数执行失败"
    }
  }

  if (!openid) {
    return { ok: false, message: "未获取到用户身份，请重新打开小程序" }
  }

  try {
    switch (action) {
      case "sync":
        return await syncData(openid, payload)
      case "listListings":
        return await listListings(payload, openid)
      case "adminSync":
        return await adminSync(openid, payload)
      case "staffWorkbenchSync":
        return await staffWorkbenchSync(openid, payload)
      case "listStaffGlobalConnects":
        return await listStaffGlobalConnects(openid, payload)
      case "registerUser":
        return await registerUser(openid, payload)
      case "loginUser":
        return await loginUser(openid, payload)
      case "ensureOpenidBound":
        return await ensureOpenidBound(openid, payload)
      case "validateDeviceSession":
        return await validateDeviceSession(openid, payload)
      case "updateProfile":
        return await updateProfile(openid, payload)
      case "changePassword":
        return await changePassword(openid, payload)
      case "createSubmission":
        return await createSubmission(openid, payload)
      case "adminProxyPublish":
        return await adminProxyPublish(openid, payload)
      case "adminProxyConnect":
        return await adminProxyConnect(openid, payload)
      case "patchSubmission":
        return await patchSubmission(openid, payload)
      case "confirmConnectByRecipient":
        return await confirmConnectByRecipientCloud(openid, payload)
      case "agreeConnectExchange":
        return await agreeConnectExchangeCloud(openid, payload)
      case "rejectConnectByRecipient":
        return await rejectConnectByRecipientCloud(openid, payload)
      case "adminReview":
        return await adminReview(openid, payload)
      case "getStaffListingPublisherInfo":
        return await getStaffListingPublisherInfo(openid, payload)
      case "resolveCloudFileUrls":
        return await resolveCloudFileUrls(openid, payload)
      case "toggleFavorite":
        return await toggleFavoriteCloud(openid, payload)
      case "adminTakeDownListing":
        return await adminTakeDownListing(openid, payload)
      case "adminDisableAccount":
        return await adminDisableAccount(openid, payload)
      case "adminEnableAccount":
        return await adminEnableAccount(openid, payload)
      case "adminSearchPublishedListings":
        return await adminSearchPublishedListings(openid, payload)
      case "adminLookupUser":
        return await adminLookupUser(openid, payload)
      default:
        return { ok: false, message: "未知操作: " + action }
    }
  } catch (error) {
    console.error("tradeApi error", action, error)
    return {
      ok: false,
      message: error.message || "云函数执行失败"
    }
  }
}
