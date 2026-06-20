/**
 * 用户服务协议、隐私政策、免责申明正文（版本号与运营主体信息可在 config 中覆盖）
 *
 * 职责划分：
 * - 用户服务协议：完整法律条款（服务范围、账号、行为规范、责任、知识产权等）
 * - 隐私政策：个人信息收集、使用、存储与权利
 * - 免责申明：注册前精简风险告知，不重复协议条文，完整规则以协议为准
 */
var config = require("./config")

var operatorName = config.legalOperatorName || "算力码头运营方"
var contactEmail = config.legalContactEmail || ""
var updateDate = config.legalUpdateDate || "2026年06月18日"

var termsVersion = "v2"
var privacyVersion = "v1"
var disclaimerVersion = "v4"

/** 注册前风险告知（精简摘要，完整条款见用户服务协议） */
var disclaimerParagraphs = [
  "本平台是算力产业链商机信息发布与撮合协助工具，不参与具体交易、不代收代付、不提供算力调度或运维托管。",
  "平台展示的商机信息由发布方自行填写，我们仅做形式初审；请你使用前自行核实对方资质与信息真实性。",
  "对接后交换联系方式仅用于商务沟通。线下洽谈、签约、付款、交付及后续履约由双方自行协商，相关风险与后果由双方自行承担。",
  "请警惕虚假承诺、诱导转账等行为；遇可疑情况可通过「我的」页面向我们反馈。",
  "你的权利义务、违规处理及责任限制等完整规则，以《用户服务协议》及《隐私政策》为准；注册并提交信息，即表示你已阅读并同意上述全部文件。"
]

var disclaimerDocument = {
  type: "disclaimer",
  version: disclaimerVersion,
  title: "免责申明",
  updateDate: updateDate,
  numbered: true,
  sections: [
    {
      title: "",
      paragraphs: disclaimerParagraphs.slice()
    }
  ]
}

var legalDocumentList = [
  { type: "service", title: "用户服务协议", label: "《用户服务协议》" },
  { type: "privacy", title: "隐私政策", label: "《隐私政策》" },
  { type: "disclaimer", title: "免责申明", label: "《免责申明》" }
]

var userServiceAgreement = {
  type: "service",
  version: termsVersion,
  title: "用户服务协议",
  updateDate: updateDate,
  sections: [
    {
      title: "一、协议的接受与适用范围",
      paragraphs: [
        "欢迎使用「算力码头」微信小程序（以下简称「本平台」或「我们」）。本协议由" + operatorName + "（以下简称「运营方」）与使用本平台服务的用户（以下简称「您」）共同订立。",
        "您点击同意、完成注册、登录或使用本平台任何服务，即表示您已充分阅读、理解并同意接受本协议全部条款及《隐私政策》。若您不同意，请停止使用本平台。"
      ]
    },
    {
      title: "二、服务说明",
      paragraphs: [
        "本平台面向算力产业链用户提供商机信息发布、意向登记、企业认证审核、对接撮合协助及相关信息服务。",
        "本平台不提供线上交易、资金代收代付、算力调度、运维托管或线上签约结算服务；上述事项由用户线下自行协商办理。"
      ]
    },
    {
      title: "三、账号注册与管理",
      paragraphs: [
        "您注册时应提供真实、准确、完整的姓名、手机号等信息，并设置符合安全要求的登录密码。我们有权对注册信息进行形式审核。",
        "您的账号仅限本人使用，请妥善保管账号与密码。因您保管不善导致的账号被盗用、信息泄露或损失，由您自行承担。",
        "您不得冒用他人信息注册、恶意批量注册或从事任何可能损害平台或其他用户合法权益的行为。我们有权暂停或终止违规账号的使用。"
      ]
    },
    {
      title: "四、用户行为规范",
      paragraphs: [
        "您发布的需求、资源、对接意向及其他信息应合法、真实，不得含有虚假、误导、侵权或违反法律法规的内容。",
        "严禁发布国家法律法规禁止生产、销售、进出口或交易的产品、服务及算力相关物项信息。",
        "您不得利用本平台从事诈骗、诱导转账、骚扰、爬取数据、干扰系统正常运行等违法违规行为。",
        "因您违规发布信息或不当使用平台服务引发的纠纷、投诉、行政处罚，由您自行负责。"
      ]
    },
    {
      title: "五、信息与内容责任",
      paragraphs: [
        "用户在本平台发布的信息由发布方自行填写并对其真实性、完整性、合法性负责。平台仅做形式初审，不对上述信息作任何明示或默示担保。",
        "您应自行核实对方主体资质、资源能力与商务条款。因用户发布信息或线下合作产生的争议，由相关用户自行协商或通过法律途径解决；平台可在法律允许范围内协助协调，但不承担担保或赔偿责任。"
      ]
    },
    {
      title: "六、知识产权",
      paragraphs: [
        "本平台界面设计、文字、标识、软件程序等内容的知识产权归运营方或相关权利人所有。未经授权，您不得复制、修改、传播或用于商业用途。",
        "您在本平台上传、发布的内容，您应保证拥有合法权利；您授予平台在提供服务所必需的范围内使用、展示、存储该内容的权利。"
      ]
    },
    {
      title: "七、协议变更、中断与终止",
      paragraphs: [
        "我们有权根据法律法规变化或运营需要修订本协议，并通过小程序公告、页面提示等方式公布。修订后继续使用即视为接受。",
        "我们有权根据运营需要调整展示规则、审核标准与服务范围；发现违规内容时，可下架相关信息或暂停、终止相关账号的使用。",
        "因系统维护、不可抗力或监管要求，我们可能暂时中断或终止部分服务，并将尽力提前告知。",
        "您可随时停止使用本平台；我们亦可在您严重违反本协议或法律法规时，暂停或终止向您提供服务。"
      ]
    },
    {
      title: "八、免责声明与责任限制",
      paragraphs: [
        "在法律允许的最大范围内，本平台按「现状」提供服务，不对服务的及时性、安全性、准确性作出保证。",
        "因用户线下洽谈、签约、付款、交付等自主行为，或因第三方服务、不可抗力导致的损失，运营方不承担直接或间接赔偿责任，法律法规另有规定的除外。"
      ]
    },
    {
      title: "九、争议解决",
      paragraphs: [
        "本协议适用中华人民共和国法律。因本协议引起的争议，双方应友好协商；协商不成的，提交运营方所在地有管辖权的人民法院诉讼解决。"
      ]
    },
    {
      title: "十、联系我们",
      paragraphs: contactEmail
        ? ["如您对本协议有任何疑问，请通过邮箱 " + contactEmail + " 与我们联系。"]
        : ["如您对本协议有任何疑问，请通过本平台「我的」页面提供的联系方式与我们联系。"]
    }
  ]
}

var privacyPolicy = {
  type: "privacy",
  version: privacyVersion,
  title: "隐私政策",
  updateDate: updateDate,
  sections: [
    {
      title: "引言",
      paragraphs: [
        operatorName + "（以下简称「我们」）深知个人信息对您的重要性。本《隐私政策》适用于「算力码头」微信小程序，说明我们如何收集、使用、存储、共享和保护您的个人信息，以及您享有的权利。",
        "请您在使用我们的服务前仔细阅读本政策。我们仅在获得您的授权同意后，才会收集和使用您的个人信息。"
      ]
    },
    {
      title: "一、我们收集的信息及用途",
      paragraphs: [
        "1. 账号注册与登录：为创建账号、验证身份、保障账号安全，我们会收集您的姓名、手机号码、登录密码（以加密哈希形式存储，我们无法获知您的明文密码）。若您使用微信授权手机号功能，我们将通过微信官方接口获取您的手机号，不会额外收集微信密码。",
        "2. 微信标识信息：为实现微信登录、账号绑定与安全防护，我们会收集与您的微信账号关联的 openid 等必要标识信息。",
        "3. 企业认证资料：当您申请名片认证或营业执照认证时，我们会收集您提交的企业名称、统一社会信用代码（如适用）、地区、角色、名片或营业执照图片等，用于审核认证状态与展示认证标签。",
        "4. 业务信息与对接记录：当您发布资源/需求、申请对接、交换联系方式或提交撮合申请时，我们会收集您填写的商机信息、对接意向、联系方式及沟通进展，用于信息展示、撮合协助与记录管理。",
        "5. 设备与日志信息：为保障服务安全稳定运行，我们可能收集设备型号、操作系统版本、操作日志、崩溃记录等，用于故障排查与安全防护。"
      ]
    },
    {
      title: "二、信息收集的方式",
      paragraphs: [
        "我们主要通过以下方式收集信息：（1）您主动填写或上传；（2）您勾选同意并授权后，通过微信官方能力获取（如手机号授权）；（3）您使用服务过程中自动产生的必要日志信息。",
        "未经您的明示同意，我们不会通过本政策未说明的方式收集您的个人信息。"
      ]
    },
    {
      title: "三、信息的使用目的",
      paragraphs: [
        "我们收集的信息将用于：提供注册登录、信息发布、对接撮合、认证审核、消息通知等核心功能；保障账号安全、防范欺诈与违规行为；改进产品体验与服务质量；履行法律法规规定的义务。",
        "我们不会将您的个人信息用于本政策未载明的其他目的。如需改变使用目的，我们将再次征得您的同意。"
      ]
    },
    {
      title: "四、信息的存储与保护",
      paragraphs: [
        "您的个人信息存储于中华人民共和国境内，主要使用微信云开发等安全云服务进行存储。我们仅在实现服务目的所必需的期限内保留您的信息，法律法规另有规定的除外。",
        "我们采取访问控制、传输加密、密码哈希存储等合理安全措施保护您的信息，但互联网环境并非绝对安全，请妥善保管您的账号凭证。"
      ]
    },
    {
      title: "五、信息的共享、转让与公开披露",
      paragraphs: [
        "未经您同意，我们不会向第三方共享、转让或公开披露您的个人信息，但以下情形除外：法律法规要求；与国家安全、公共安全、重大公共利益直接相关；经您明确授权（如对接双方同意交换联系方式）；为完成合并、收购等合法业务转移所必需。",
        "对接撮合场景中，仅在双方确认同意交换联系方式后，向对方展示必要的联系信息，不会在公开展示池中公开您的完整联系方式。"
      ]
    },
    {
      title: "六、第三方服务与 SDK",
      paragraphs: [
        "为实现登录、云存储、消息通知等功能，我们可能接入微信开放平台、微信云开发等第三方服务。上述服务方可能根据其隐私政策处理必要信息。建议您同时阅读微信相关隐私说明。",
        "我们不会向第三方出售您的个人信息。"
      ]
    },
    {
      title: "七、您的权利",
      paragraphs: [
        "您有权查询、更正您的账号资料与企业认证信息；有权撤回授权（撤回后可能影响部分功能使用）；有权注销账号或要求我们删除相关信息（法律法规要求保留的除外）。",
        "您可通过「我的」页面管理资料，或通过下方联系方式向我们提出个人信息相关请求，我们将在合理期限内答复。"
      ]
    },
    {
      title: "八、未成年人保护",
      paragraphs: [
        "本平台主要面向企业用户及具有完全民事行为能力的成年人。若您是未成年人，请在监护人指导下阅读本政策并使用服务；未经监护人同意，请勿注册或向我们提供个人信息。"
      ]
    },
    {
      title: "九、政策更新",
      paragraphs: [
        "我们可能适时修订本政策，修订后将通过小程序页面公告等方式提示您。重大变更将再次征求您的同意。更新日期：" + updateDate + "。"
      ]
    },
    {
      title: "十、联系我们",
      paragraphs: contactEmail
        ? ["如您对本隐私政策或个人信息处理有任何疑问、意见或投诉，请发送邮件至 " + contactEmail + "，我们将尽快处理。"]
        : ["如您对本隐私政策或个人信息处理有任何疑问、意见或投诉，请通过本平台「我的」页面与我们联系，我们将尽快处理。"]
    }
  ]
}

function getLegalDocument(type) {
  if (type === "privacy") {
    return privacyPolicy
  }
  if (type === "disclaimer") {
    return disclaimerDocument
  }
  return userServiceAgreement
}

function getLegalDocumentList() {
  return legalDocumentList.slice()
}

function getDisclaimerContent() {
  return {
    version: disclaimerVersion,
    title: "免责申明",
    intro: "请逐项阅读下列风险告知，完整条款见《用户服务协议》与《隐私政策》。",
    readSeconds: 6,
    paragraphs: disclaimerParagraphs.slice()
  }
}

function buildLegalPageUrl(type, options) {
  options = options || {}
  var allowed = { service: "service", privacy: "privacy", disclaimer: "disclaimer" }
  var url = "/pages/legal/legal?type=" + (allowed[type] || "service")
  if (options.from) {
    url += "&from=" + encodeURIComponent(options.from)
  }
  return url
}

function getLegalVersions() {
  return {
    termsVersion: termsVersion,
    privacyVersion: privacyVersion,
    disclaimerVersion: disclaimerVersion,
    updateDate: updateDate,
    operatorName: operatorName
  }
}

module.exports = {
  getLegalDocument: getLegalDocument,
  getLegalDocumentList: getLegalDocumentList,
  getDisclaimerContent: getDisclaimerContent,
  buildLegalPageUrl: buildLegalPageUrl,
  getLegalVersions: getLegalVersions,
  termsVersion: termsVersion,
  privacyVersion: privacyVersion,
  disclaimerVersion: disclaimerVersion
}
