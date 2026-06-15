/**
 * 算力码头小程序 — 数据层入口
 *
 * 模块结构：
 * - ../constants.js    平台常量与 storage key
 * - ../format.js       日期/脱敏/密码强度
 * - ../matching.js     完整度计算与列表筛选排序
 * - ../admin.js        运营工作台（staffRole 授权）
 * - ../subscribeMessage.js  订阅消息
 * - ../permissions.js  权限规则实现（口径见 10_权限规则.md）
 * - ../certGate.js        名片认证门禁（对接/匹配 vs 发布）
 * - ../connectStage.js   对接阶段单一视图（待办 / 展示状态 / 时间线）
 * - ./_core.js         业务逻辑（提交/认证/对接/记录展示等）
 */
module.exports = require("./_core")
