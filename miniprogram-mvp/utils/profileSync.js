/**
 * 用户资料同步 — 时间戳比较与合并（客户端 / 云函数共用同一规则）
 */

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
  if (a === b) {
    return 0
  }
  return a.localeCompare(b)
}

function isRemoteProfileNewer(localProfile, remoteProfile) {
  var localTime = localProfile && localProfile.updatedAt ? localProfile.updatedAt : ""
  var remoteTime = remoteProfile && remoteProfile.updatedAt ? remoteProfile.updatedAt : ""
  return compareUpdatedAt(remoteTime, localTime) >= 0
}

/**
 * 按 updatedAt 合并资料：较新的一侧覆盖同名字段；认证字段由 resolveCert 回调最终裁定。
 * @param {object|null} localProfile
 * @param {object|null} remoteProfile
 * @param {function|null} resolveCertFields - (merged) => patch | null
 */
function mergeUserProfileByTimestamp(localProfile, remoteProfile, resolveCertFields) {
  localProfile = localProfile || {}
  remoteProfile = remoteProfile || {}
  var merged
  if (isRemoteProfileNewer(localProfile, remoteProfile)) {
    merged = Object.assign({}, localProfile, remoteProfile)
  } else {
    merged = Object.assign({}, remoteProfile, localProfile)
  }
  if (typeof resolveCertFields === "function") {
    var certPatch = resolveCertFields(merged, localProfile, remoteProfile)
    if (certPatch && typeof certPatch === "object") {
      merged = Object.assign({}, merged, certPatch)
    }
  }
  return merged
}

/**
 * 云端拉取合并：同名字段以服务器（remote）为准；本地仅保留服务器没有的条目。
 */
function mergeUserProfileServerFirst(localProfile, remoteProfile, resolveCertFields) {
  localProfile = localProfile || {}
  remoteProfile = remoteProfile || {}
  var merged = Object.assign({}, localProfile, remoteProfile)
  if (typeof resolveCertFields === "function") {
    var certPatch = resolveCertFields(merged, localProfile, remoteProfile)
    if (certPatch && typeof certPatch === "object") {
      merged = Object.assign({}, merged, certPatch)
    }
  }
  return merged
}

function isIncomingRecordStale(existing, incoming) {
  if (!existing || !incoming) {
    return false
  }
  var existingTime = existing.updatedAt || existing.createdAt || ""
  var incomingTime = incoming.updatedAt || incoming.createdAt || ""
  if (!existingTime || !incomingTime) {
    return false
  }
  return compareUpdatedAt(incomingTime, existingTime) < 0
}

module.exports = {
  compareUpdatedAt: compareUpdatedAt,
  isRemoteProfileNewer: isRemoteProfileNewer,
  mergeUserProfileByTimestamp: mergeUserProfileByTimestamp,
  mergeUserProfileServerFirst: mergeUserProfileServerFirst,
  isIncomingRecordStale: isIncomingRecordStale
}
