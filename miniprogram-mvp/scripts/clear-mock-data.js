const fs = require("fs")
const path = require("path")

const filePath = path.join(__dirname, "../utils/data.js")
let content = fs.readFileSync(filePath, "utf8")

content = content.replace(
  /const resources = \[[\s\S]*?\]\r?\n\r?\nconst demands = \[[\s\S]*?\]\r?\n\r?\nconst stats = \[/,
  "const resources = []\n\nconst demands = []\n\nconst stats = ["
)

content = content.replace(
  /const stats = \[[\s\S]*?\]\r?\n\r?\nconst bulletins = \[[\s\S]*?\]\r?\n\r?\nconst processSteps/,
  [
    "const stats = [",
    '  { label: "资源条目", value: "0" },',
    '  { label: "需求条目", value: "0" },',
    '  { label: "提交记录", value: "0" },',
    '  { label: "待审核", value: "0" }',
    "]",
    "",
    "const bulletins = []",
    "",
    "const processSteps"
  ].join("\n")
)

fs.writeFileSync(filePath, content)
console.log("Mock data cleared in utils/data.js")
