/**
 * 权限规则静态审计（口径：10_权限规则.md）
 * 运行：node scripts/audit-permissions.js
 */
var permissions = require("../utils/permissions")

var passed = 0
var failed = 0

function assert(condition, message) {
  if (condition) {
    passed += 1
    return
  }
  failed += 1
  console.error("FAIL: " + message)
}

function ctx(overrides) {
  return Object.assign({
    isResource: true,
    isGuest: false,
    isPublisher: false,
    isStaffProxyManager: false,
    isStaffProxyViewer: false,
    isStaffUser: false,
    isClosed: false,
    isMatchPreview: false,
    canApplyConnect: true,
    canViewPublisherInfo: false,
    canClose: true
  }, overrides || {})
}

console.log("=== 权限规则审计 ===\n")

// §6 发布方不能申请对接自己的资源
var publisherOwnResource = permissions.buildListingPermissionContext("URES-1", ctx({ isPublisher: true }))
assert(!publisherOwnResource.canApplyConnectToListing, "发布方不可申请对接自己的资源")
assert(publisherOwnResource.canCloseListing, "发布方可关闭自己的资源")
assert(!publisherOwnResource.showBottomBar, "发布方资源详情不显示底部申请栏")
assert(publisherOwnResource.showMatchPicker, "发布方资源详情显示勾选匹配区")

// §6 运营不能以个人身份申请对接
var staffView = permissions.buildListingPermissionContext("URES-2", ctx({ isStaffUser: true }))
assert(!staffView.canApplyConnectToListing, "运营不可个人申请对接")
assert(!staffView.showBottomBar, "运营浏览他人资源不显示底部申请栏")

// §6 路人浏览他人资源：底部申请对接，不在详情页勾选需求
var visitorResource = permissions.buildListingPermissionContext("URES-3", ctx())
assert(visitorResource.canApplyConnectToListing, "已登录用户可对他人资源申请对接")
assert(!visitorResource.showMatchPickerSection, "路人资源详情不显示运营方勾选区")
assert(visitorResource.showBottomBar, "路人资源详情显示底部申请对接栏")

// §7 资源方浏览他人需求：底部发起匹配，不在详情页勾选
var viewerDemand = permissions.buildListingPermissionContext("UDEM-1", ctx({
  isResource: false,
  isPublisher: false
}))
assert(!viewerDemand.showViewerMatchPicker, "资源方不在需求详情内嵌勾选区")
assert(!viewerDemand.matchPickerMode, "路人需求页无内嵌匹配模式")
assert(viewerDemand.canMatchToListing, "资源方可对他人需求发起匹配")
assert(viewerDemand.showBottomBar, "资源方走底部栏进入匹配页")

// §7 需求方浏览他人资源：走底部栏进入对接页
var viewerResource = permissions.buildListingPermissionContext("URES-5", ctx({
  isResource: true,
  isPublisher: false
}))
assert(!viewerResource.showViewerMatchPicker, "需求方不在资源详情内嵌勾选区")
assert(!viewerResource.matchPickerMode, "路人资源页无内嵌匹配模式")
assert(viewerResource.showBottomBar, "需求方走底部栏进入对接页")

// §6 发布方对需求/资源的管理区含勾选匹配
var publisherDemand = permissions.buildListingPermissionContext("UDEM-2", ctx({
  isResource: false,
  isPublisher: true
}))
assert(publisherDemand.canManageListing, "需求发布方有商机管理区")
assert(publisherDemand.showMatchPicker, "需求发布方详情页显示勾选匹配区")
assert(publisherDemand.matchPickerMode === "ownerDemand", "需求发布方匹配模式为 ownerDemand")
assert(publisherDemand.canCloseListing, "需求发布方可关闭")

var publisherResource = permissions.buildListingPermissionContext("URES-6", ctx({
  isResource: true,
  isPublisher: true
}))
assert(publisherResource.showMatchPicker, "资源发布方详情页显示勾选匹配区")
assert(publisherResource.matchPickerMode === "ownerResource", "资源发布方匹配模式为 ownerResource")

// §3 运营代发：底部匹配区，非发布方，不可关闭
var staffProxy = permissions.buildListingPermissionContext("URES-4", ctx({
  isStaffProxyManager: true,
  isPublisher: false
}))
assert(staffProxy.canManageListing, "代发运营有商机管理区")
assert(staffProxy.showProxyMatchSection, "代发运营在详情底部可匹配需求")
assert(staffProxy.matchPickerMode === "staffResource", "代发资源匹配模式为 staffResource")
assert(staffProxy.showMatchPickerSection, "代发运营显示统一勾选匹配区")
assert(staffProxy.canCloseListing, "代发运营可关闭代发商机")

var staffProxyAsStaffUser = permissions.buildListingPermissionContext("URES-4", ctx({
  isStaffProxyManager: true,
  isStaffUser: true,
  isPublisher: false
}))
assert(staffProxyAsStaffUser.showMatchPickerSection, "运营账号（含 admin）管理代发资源时仍显示勾选匹配区")
assert(staffProxyAsStaffUser.matchPickerMode === "staffResource", "运营账号（含 admin）代发资源匹配模式为 staffResource")

var staffProxyDemandAsStaffUser = permissions.buildListingPermissionContext("UDEM-3", ctx({
  isResource: false,
  isStaffProxyManager: true,
  isStaffUser: true,
  isPublisher: false
}))
assert(staffProxyDemandAsStaffUser.showMatchPickerSection, "运营账号（含 admin）管理代发需求时仍显示勾选匹配区")
assert(staffProxyDemandAsStaffUser.matchPickerMode === "staffDemand", "运营账号（含 admin）代发需求匹配模式为 staffDemand")
assert(!staffView.showMatchPickerSection, "运营浏览他人商机不显示勾选匹配区")

// admin 继承 manager 运营能力（代发撮合、不可个人对接）
var adminStaffView = permissions.buildListingPermissionContext("URES-2", ctx({ isStaffUser: true }))
assert(!adminStaffView.canApplyConnectToListing, "admin 不可个人申请对接")
assert(!adminStaffView.showBottomBar, "admin 浏览他人资源不显示底部申请栏")

var adminStaffProxy = permissions.buildListingPermissionContext("URES-4", ctx({
  isStaffProxyManager: true,
  isStaffUser: true,
  isPublisher: false
}))
assert(adminStaffProxy.canManageListing, "admin 可管理代发商机")
assert(adminStaffProxy.showProxyMatchSection, "admin 可在代发详情底部匹配")
assert(adminStaffProxy.canCloseListing, "admin 可关闭代发商机")

var staffProxyDemand = permissions.buildListingPermissionContext("UDEM-3", ctx({
  isResource: false,
  isStaffProxyManager: true,
  isPublisher: false
}))
assert(staffProxyDemand.showProxyMatchSection, "代发需求可在底部匹配资源")
assert(staffProxyDemand.matchPickerMode === "staffDemand", "代发需求匹配模式为 staffDemand")
assert(staffProxyDemand.canCloseListing, "代发运营可关闭代发需求")
assert(!staffProxyDemand.showBottomBar, "代发需求详情不显示底部个人操作栏")

// §5.3 资源附件
assert(permissions.canViewResourceAttachmentsForListing({ isPublisher: true }), "发布方可看资源附件")
assert(!permissions.canViewResourceAttachmentsForListing({ hasLicenseCert: false }), "路人无执照不可看附件")
assert(permissions.canViewResourceAttachmentsForListing({ hasLicenseCert: true }), "路人有执照可看附件")
assert(permissions.canViewResourceAttachmentsForListing({ isStaffProxyView: true }), "代发运营可看附件")

// §5.3 需求附件不公开展示
assert(!permissions.canViewDemandAttachmentsForListing({}), "路人不可看需求附件")
assert(permissions.canViewDemandAttachmentsForListing({ isPublisher: true }), "发布方可看需求附件")

// §9 访客权限阶梯
var guestRows = permissions.buildPermissionRows("guest")
assert(guestRows.length === 2, "访客仅展示 2 项浏览权限")
assert(guestRows.every(function(r) { return r.unlocked }), "访客浏览项均已开通")

// §3 收藏 / 分享
assert(!permissions.canFavoriteContent(false), "访客不可收藏")
assert(permissions.canFavoriteContent(true), "已登录可收藏")
assert(!permissions.canShareContent(false), "访客不可使用通用分享菜单")
assert(permissions.canShareContent(true), "已登录可分享")
assert(permissions.canShareConnectInviteOnDetail({
  hasListing: true,
  isPublisher: false,
  isStaffProxyView: false,
  isListingPreview: false
}), "访客可在详情页分享好友对接/匹配")
assert(!permissions.canShareConnectInviteOnDetail({
  hasListing: true,
  isPublisher: true,
  isStaffProxyView: false,
  isListingPreview: false
}), "发布方详情不显示好友对接分享")

// §5.2 发布方隐私：访客不可见
assert(!permissions.canShowPublisherBlockOnDetail({
  isGuest: true,
  isLoggedIn: false
}), "访客不可见发布方卡片")
assert(!permissions.canShowPublisherFullContact({
  isGuest: true,
  isLoggedIn: false
}), "访客不可见发布方联系方式")

assert(!permissions.canShowPublisherBlockOnDetail({
  isGuest: false,
  isLoggedIn: true,
  isPublisher: false,
  isStaffProxyView: false,
  isPlatformAdmin: false,
  platformAdminOversight: false,
  isAuthorizedConnectParty: false
}), "已登录路人不可见发布方卡片")

assert(permissions.canShowPublisherBlockOnDetail({
  isGuest: false,
  isLoggedIn: true,
  isPublisher: true
}), "发布方本人可见发布方卡片")

assert(permissions.canShowPublisherBlockOnDetail({
  isGuest: false,
  isLoggedIn: true,
  isPlatformAdmin: true,
  platformAdminOversight: true
}), "平台管理员监管可见发布方卡片")

assert(!permissions.canShowPublisherFullContact({
  isGuest: false,
  isLoggedIn: true,
  isPlatformAdmin: true,
  platformAdminOversight: false
}), "运营专员（非 admin）不可见完整联系方式")

assert(permissions.canShowPublisherFullContact({
  isPlatformAdmin: true,
  platformAdminOversight: true
}), "平台管理员可见完整联系方式")

assert(permissions.canShowPublisherBlockOnDetail({
  isGuest: false,
  isLoggedIn: true,
  isAuthorizedConnectParty: true
}), "已授权对接方可进入发布方卡片（脱敏）")

assert(!permissions.canShowPublisherFullContact({
  isAuthorizedConnectParty: true,
  contactsExchanged: false
}), "对接方交换前不可见完整联系方式")

assert(permissions.canShowPublisherFullContact({
  isAuthorizedConnectParty: true,
  contactsExchanged: true
}), "对接方交换后可见完整联系方式")

// §6.1 池隐藏：仅看 hideFromPublicPool 标记
assert(publisherResource.hideFromPublicPool, "发布方标记池内隐藏")
assert(!staffProxy.hideFromPublicPool, "代发运营不标记池内隐藏")

console.log("\n通过: " + passed)
console.log("失败: " + failed)
if (failed > 0) {
  process.exit(1)
}
console.log("\n全部权限审计通过。")
