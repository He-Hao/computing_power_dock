// 在微信开发者工具「云开发」控制台复制环境 ID，填到 cloudEnvId。
// 推荐：复制 config.local.js.example 为 config.local.js 并填写（仅本机生效）。

// 微信 getPhoneNumber 需小程序完成企业认证（个人主体不可用）。
// 企业认证后可设 useWechatPhoneAuth: true，走「授权 → 加密 → getPhoneNumber 云函数解密」，
// 并须在公众平台配置用户隐私保护指引。未认证前保持 false，注册页手动填写手机号。

var config = {

  cloudEnvId: "",

  useCloud: true,

  useWechatPhoneAuth: false,

  defaultManualPhone: "",

  // false：提交后须运营审核才进公开展示池；默认 true 即发布后直接展示
  autoApproveListing: true,

  // true：运营工作台显示「导入/清空演示数据」（仅云端模式生效）
  enableDemoSeedTools: false,

  // 微信订阅消息模板 ID（公众平台申请后填入；留空则跳过订阅授权）
  // connectStatus：对接状态变更；connectPending：待对方确认/待交换
  subscribeTemplates: {
    connectStatus: "",
    connectPending: ""
  },

  // 首页本周精选展示条数（0 表示关闭）
  homeFeaturedLimit: 5,

  // 首页是否展示 8 类意图快捷入口
  enableHomeIntentShortcuts: true,

  // 用户服务协议 / 隐私政策中的运营主体与联系邮箱（建议在 config.local.js 中填写真实信息）
  legalOperatorName: "算力码头运营方",
  legalContactEmail: "",
  legalUpdateDate: "2026年06月18日"

}

try {
  var local = require("./config.local.js")
  if (local && typeof local === "object") {
    Object.keys(local).forEach(function(key) {
      config[key] = local[key]
    })
  }
} catch (e) {
  // config.local.js 不存在时使用上方默认值
}

module.exports = config


