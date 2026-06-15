// 平台常量与本地存储 key（供 data 子模块共用）

const resources = []
const demands = []
const bulletins = []

const processSteps = [
  { title: "名片认证", text: "首次提交需求、发布资源或申请对接前，须先完成名片认证，平台约 1-3 个工作日审核通过。" },
  { title: "提交信息", text: "认证通过后可发布需求/资源，或在详情页发起对接申请，填写真实完整的业务信息。" },
  { title: "对方确认", text: "接收方同意对接并发起交换名片，等待申请方确认。" },
  { title: "信息公示", text: "申请方同意交换后，双方可查看对方联系方式并纳入撮合记录。" },
  { title: "跟进沉淀", text: "记录报价、约谈、成交或流失原因，形成可信商机数据。" }
]

// 首页快捷入口：找* = 浏览资源池供给；供* = 发布资源；建机房 = 提交项目需求；找需求 = 浏览需求池
const categories = [
  { name: "找整机", icon: "🖥️", action: "filter", pool: "resources", filterType: "算力整机" },
  { name: "供整机", icon: "🔧", action: "submit", submitType: "resource", listingType: "算力整机" },
  { name: "找租赁", icon: "⚡", action: "filter", pool: "resources", filterType: "算力租赁" },
  { name: "供租赁", icon: "📦", action: "submit", submitType: "resource", listingType: "算力租赁" },
  { name: "找建设", icon: "🏗️", action: "filter", pool: "resources", filterType: "机房建设" },
  { name: "建机房", icon: "🏢", action: "submit", submitType: "room" },
  { name: "找运营", icon: "🌐", action: "filter", pool: "resources", filterType: "托管运营" },
  { name: "找需求", icon: "🤝", action: "filter", pool: "demands" }
]

const enterpriseRegionOptions = [
  "华北", "东北", "华东", "华中", "华南", "西南", "西北", "港澳台", "境外"
]
const regionFilterOptions = ["全部"].concat(enterpriseRegionOptions)
const legacyRegionAliasMap = { "中部": "华中", "全国": "" }

const enterpriseRoleOptions = [
  "算力需求方", "算力供给方", "服务器厂商/集成商", "IDC 服务商",
  "机房建设商", "数据中心运营方", "渠道代理商"
]
const legacyRoleAliasMap = {
  "需求方": "算力需求方",
  "资源方": "算力供给方",
  "代理商": "渠道代理商"
}
const enterpriseRoleDefaults = { demand: "算力需求方", supply: "算力供给方" }

const sortOptions = [
  { value: "match", label: "完整度优先" },
  { value: "latest", label: "最新发布" }
]

const poolCertFilterOptions = [
  { value: "all", label: "全部" },
  { value: "license", label: "执照认证" }
]

const poolTimeFilterOptions = [
  { value: "all", label: "全部时间" },
  { value: "24h", label: "24小时内" },
  { value: "7d", label: "7天内" },
  { value: "30d", label: "30天内" }
]

const poolDeliveryKindFilterOptions = [
  { value: "all", label: "全部" },
  { value: "现货", label: "现货" },
  { value: "准现货", label: "准现货" },
  { value: "期货", label: "期货" }
]

const poolFavoriteFilterOptions = [
  { value: "all", label: "全部商机" },
  { value: "favorite", label: "我的收藏" }
]

const resourceBrowseFilterOptions = [
  { value: "all", label: "全部状态" },
  { value: "unread", label: "未浏览" },
  { value: "viewed", label: "已查看" },
  { value: "applied", label: "已申请" }
]

const resourceTypeMap = {
  "算力整机": ["算力整机", "算力租赁", "硬件配件", "运维维保", "资金支持"],
  "硬件配件": ["算力整机", "算力租赁", "硬件配件", "运维维保", "综合资源"],
  "算力租赁": ["算力租赁", "算力整机", "托管运营", "运维维保"],
  "运维维保": ["算力整机", "算力租赁", "机房建设", "托管运营", "资金支持"],
  "机房建设": ["机房建设", "运维维保", "资金支持"],
  "托管运营": ["托管运营", "算力租赁", "机房建设", "综合资源"],
  "资金支持": ["资金支持", "机房建设", "算力整机", "算力租赁", "托管运营"],
  "综合资源": ["综合资源", "托管运营", "硬件配件"]
}

const demandTypeMap = {
  "算力整机": ["算力整机", "算力租赁", "硬件配件", "运维维保", "资金支持"],
  "硬件配件": ["算力整机", "算力租赁", "硬件配件", "运维维保", "综合资源"],
  "算力租赁": ["算力租赁", "算力整机", "托管运营", "运维维保"],
  "运维维保": ["算力整机", "算力租赁", "机房建设", "托管运营", "资金支持"],
  "机房建设": ["机房建设", "运维维保", "资金支持"],
  "托管运营": ["托管运营", "算力租赁", "机房建设", "综合资源"],
  "资金支持": ["资金支持", "机房建设", "算力整机", "算力租赁", "托管运营"],
  "综合资源": ["综合资源", "托管运营", "硬件配件"]
}

const statusHints = {
  "待审核": "平台已收到提交，等待撮合经理初审。",
  "认证中": "企业认证申请已提交，平台将在 1-3 个工作日内完成审核。",
  "已认证": "企业认证已通过，可展示认证标签并参与优先推荐。",
  "已发布": "信息已通过初审，进入推荐池等待匹配。",
  "已推荐": "平台已为你推荐匹配对象，请留意电话或企微通知。",
  "待对方确认": "对接申请已发送，等待对方同意并发起交换名片。",
  "对方已确认": "对方已同意对接，请选择是否交换名片。",
  "待交换确认": "等待申请方确认是否交换名片。",
  "已申请对接": "对接申请已提交，等待对方确认。",
  "已交换名片": "双方已同意交换联系方式，可在记录中查看对方信息。",
  "已约谈": "撮合经理已协助安排沟通，请保持电话畅通。",
  "已报价": "双方进入商务报价阶段。",
  "已成交": "商机已成交，平台将沉淀案例数据。",
  "已流失": "本次商机未成交，可重新提交新需求。",
  "已关闭": "本条商机已关闭。",
  "待跟进": "平台已收到提交，撮合经理将在 24 小时内联系。",
  "待平台审核": "涉及平台代发商机，对接申请等待运营审批。"
}

const submissionKey = "compute_trade_submissions"
const userProfileKey = "compute_trade_user_profile"
const publishedResourcesKey = "compute_trade_published_resources"
const publishedDemandsKey = "compute_trade_published_demands"
const userCloudOwnListingsKey = "compute_trade_user_cloud_own_listings"
const adminPendingListingsKey = "compute_trade_admin_pending_listings"
const adminPendingSubmissionsKey = "compute_trade_admin_pending_submissions"
const adminAllPendingSubmissionsKey = "compute_trade_admin_all_pending_submissions"
const staffGlobalConnectsKey = "compute_trade_staff_global_connects"
const platformInitKey = "compute_trade_platform_init"
const shareIntentKey = "compute_trade_share_intent"
const homeGuideDismissKey = "compute_trade_home_guide_dismiss"
const rejectionNoticeSeenKey = "compute_trade_rejection_notice_seen"
const listingReportsKey = "compute_trade_listing_reports"
const viewedResourcesKey = "compute_trade_viewed_resources"
const viewedDemandsKey = "compute_trade_viewed_demands"
const favoritesKey = "compute_trade_favorites"
const platformBlankVersion = "blank_v1"

// 资源/需求共用同一套四字品类（MECE）；不含销售/供应/采购等交易动词
const listingTypeOptions = [
  "算力整机", "硬件配件", "算力租赁", "运维维保", "机房建设", "托管运营", "资金支持", "综合资源"
]
const resourceTypeOptions = listingTypeOptions
const demandTypeOptions = listingTypeOptions
const legacyResourceTypeAliasMap = {
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
const legacyDemandTypeAliasMap = {
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
// 类型说明：发布/筛选时展示，帮助用户选对类别（面向用户，说明适用场景与边界）
const resourceTypeHints = {
  "算力整机": "完整 GPU 服务器、训练/推理整机，一次性出售或交付",
  "硬件配件": "GPU 模组、电源、线缆、存储盘等可单独交易的零部件",
  "算力租赁": "按天/月出租的 GPU、机柜位、带宽；卖整机请选「算力整机」",
  "运维维保": "设备巡检、备件更换、驻场维修等维护服务",
  "机房建设": "数据中心设计、土建施工、液冷改造等工程建设",
  "托管运营": "机房整站托管、代运营与增值运营服务",
  "资金支持": "项目融资、设备分期、租赁资金等（不含设备本身）",
  "综合资源": "以上未覆盖的合作资源，请在描述中写清具体业务"
}
const demandTypeHints = {
  "算力整机": "采购完整 GPU 服务器、训练/推理整机；租用请选「算力租赁」",
  "硬件配件": "采购 GPU 模组、电源、线缆、存储盘等零部件",
  "算力租赁": "租用 GPU、机柜位、带宽（训练/推理/托管）；买整机请选「算力整机」",
  "运维维保": "寻找设备巡检、备件更换、驻场维修等服务",
  "机房建设": "寻找数据中心设计、施工、液冷改造等工程服务",
  "托管运营": "寻找机房托管、代运营或渠道合作",
  "资金支持": "寻找融资、分期、租赁资金等金融支持",
  "综合资源": "以上未覆盖的需求，请在描述中写清具体业务"
}
const resourceTypeFilterLabels = {
  "算力整机": "算力整机",
  "硬件配件": "硬件配件",
  "算力租赁": "算力租赁",
  "运维维保": "运维维保",
  "机房建设": "机房建设",
  "托管运营": "托管运营",
  "资金支持": "资金支持",
  "综合资源": "综合"
}
const demandTypeFilterLabels = resourceTypeFilterLabels

function normalizeResourceType(type) {
  if (!type) {
    return type
  }
  var value = String(type).trim()
  if (legacyResourceTypeAliasMap[value] !== undefined) {
    return legacyResourceTypeAliasMap[value]
  }
  if (resourceTypeOptions.indexOf(value) > -1) {
    return value
  }
  return value
}

function normalizeDemandType(type) {
  if (!type) {
    return type
  }
  var value = String(type).trim()
  if (legacyDemandTypeAliasMap[value] !== undefined) {
    return legacyDemandTypeAliasMap[value]
  }
  if (demandTypeOptions.indexOf(value) > -1) {
    return value
  }
  return value
}

const serverResourceTypes = ["算力整机"]
const rentalResourceTypes = ["算力租赁"]
const partsResourceTypes = ["硬件配件"]
const maintenanceResourceTypes = ["运维维保"]
const roomBuildResourceTypes = ["机房建设"]
const dcOpResourceTypes = ["托管运营"]
const financeResourceTypes = ["资金支持"]
const comprehensiveResourceTypes = ["综合资源"]
const otherResourceTypes = comprehensiveResourceTypes
const financeDemandTypes = financeResourceTypes
// 兼容旧引用
const computeResourceTypes = rentalResourceTypes
const idcResourceTypes = rentalResourceTypes
const computeDemandTypes = rentalResourceTypes
const idcDemandTypes = rentalResourceTypes
const roomDemandTypes = roomBuildResourceTypes
const partsDemandTypes = partsResourceTypes
const maintenanceDemandTypes = maintenanceResourceTypes
const dcOpDemandTypes = dcOpResourceTypes
const comprehensiveDemandTypes = comprehensiveResourceTypes
const agentDemandTypes = comprehensiveResourceTypes
const MAX_SUBMISSION_ATTACHMENTS = 5

const staffRoleLabels = {
  manager: "运营专员",
  admin: "平台管理员"
}

/** staffRole 权限层级：admin 包含 manager 全部能力 */
const staffRoleRank = {
  manager: 1,
  admin: 2
}

module.exports = {
  resources,
  demands,
  bulletins,
  processSteps,
  categories,
  enterpriseRegionOptions,
  regionFilterOptions,
  legacyRegionAliasMap,
  enterpriseRoleOptions,
  legacyRoleAliasMap,
  enterpriseRoleDefaults,
  sortOptions,
  poolCertFilterOptions,
  poolTimeFilterOptions,
  poolDeliveryKindFilterOptions,
  poolFavoriteFilterOptions,
  resourceBrowseFilterOptions,
  favoritesKey,
  resourceTypeMap,
  demandTypeMap,
  statusHints,
  submissionKey,
  userProfileKey,
  publishedResourcesKey,
  publishedDemandsKey,
  userCloudOwnListingsKey,
  adminPendingListingsKey,
  adminPendingSubmissionsKey,
  adminAllPendingSubmissionsKey,
  staffGlobalConnectsKey,
  platformInitKey,
  shareIntentKey,
  homeGuideDismissKey,
    rejectionNoticeSeenKey,
    listingReportsKey,
  viewedResourcesKey,
  viewedDemandsKey,
  platformBlankVersion,
  listingTypeOptions,
  resourceTypeOptions,
  demandTypeOptions,
  legacyResourceTypeAliasMap,
  legacyDemandTypeAliasMap,
  normalizeResourceType,
  normalizeDemandType,
  resourceTypeFilterLabels,
  demandTypeFilterLabels,
  resourceTypeHints,
  demandTypeHints,
  rentalResourceTypes,
  partsResourceTypes,
  maintenanceResourceTypes,
  serverResourceTypes,
  roomBuildResourceTypes,
  dcOpResourceTypes,
  financeResourceTypes,
  comprehensiveResourceTypes,
  otherResourceTypes,
  financeDemandTypes,
  computeResourceTypes,
  idcResourceTypes,
  computeDemandTypes,
  idcDemandTypes,
  roomDemandTypes,
  agentDemandTypes,
  MAX_SUBMISSION_ATTACHMENTS,
  staffRoleLabels,
  staffRoleRank,
  MATCH_DEFAULT_LIMIT: 3,
  MATCH_EXPANDED_LIMIT: 20
}
