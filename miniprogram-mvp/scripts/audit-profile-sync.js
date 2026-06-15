/**
 * 用户资料时间戳合并规则审计
 */
var profileSync = require("../utils/profileSync")

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

console.log("=== 用户资料同步审计 ===\n")

assert(profileSync.compareUpdatedAt("2026-06-10 14:10", "2026-06-10 14:09") > 0, "较新时间应更大")
assert(!profileSync.isRemoteProfileNewer(
  { updatedAt: "2026-06-10 14:10" },
  { updatedAt: "2026-06-10 14:09" }
), "本地较新时不应判定远端更新")
assert(profileSync.isRemoteProfileNewer(
  { updatedAt: "2026-06-10 14:08" },
  { updatedAt: "2026-06-10 14:09" }
), "远端较新时应采用云端资料")

var merged = profileSync.mergeUserProfileByTimestamp(
  { company: "旧公司", updatedAt: "2026-06-10 14:10", certStatus: "pending" },
  { company: "新公司", updatedAt: "2026-06-10 14:09", certStatus: "verified", certLevel: "card" }
)
assert(merged.company === "旧公司", "本地较新时保留本地公司名")
assert(merged.certStatus === "pending", "本地较新时保留本地认证状态（无 resolveCert）")

var mergedRemote = profileSync.mergeUserProfileByTimestamp(
  { company: "旧公司", updatedAt: "2026-06-10 14:08" },
  { company: "新公司", updatedAt: "2026-06-10 14:09" }
)
assert(mergedRemote.company === "新公司", "远端较新时采用云端公司名")

assert(profileSync.isIncomingRecordStale(
  { updatedAt: "2026-06-10 14:10" },
  { updatedAt: "2026-06-10 14:09" }
), "旧记录不应覆盖新记录")

console.log("全部用户资料同步审计通过。")
