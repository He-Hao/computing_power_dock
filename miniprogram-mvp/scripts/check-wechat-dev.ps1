# 诊断微信开发者工具 Failed to fetch 问题
Write-Host "=== 微信开发者工具环境诊断 ===" -ForegroundColor Cyan

$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
Write-Host ""
Write-Host "[1] 检查 hosts 文件..."
$blocked = Select-String -Path $hostsPath -Pattern "servicewechat|weixin\.qq|wechat" -CaseSensitive:$false -ErrorAction SilentlyContinue
if ($blocked) {
  Write-Host "  发现可疑 hosts 拦截（请注释掉以下行后重试）：" -ForegroundColor Red
  $blocked | ForEach-Object { Write-Host "  $($_.Line)" -ForegroundColor Yellow }
} else {
  Write-Host "  hosts 未发现微信域名拦截" -ForegroundColor Green
}

Write-Host ""
Write-Host "[2] 检查网络连通性（含报错对应的接口）..."
$urls = @(
  @{ Name = "servicewechat 安全接口"; Url = "https://servicewechat.com/wxa-dev-logic/ideoptconf?appid=wx1274b59eb3a577f5" },
  @{ Name = "servicewechat 主站"; Url = "https://servicewechat.com" },
  @{ Name = "微信开发者文档"; Url = "https://developers.weixin.qq.com" },
  @{ Name = "微信公众平台"; Url = "https://mp.weixin.qq.com" }
)
foreach ($item in $urls) {
  try {
    $resp = Invoke-WebRequest -Uri $item.Url -Method Get -TimeoutSec 8 -UseBasicParsing
    Write-Host "  OK  $($item.Name) ($($resp.StatusCode))" -ForegroundColor Green
  } catch {
    Write-Host "  FAIL $($item.Name)" -ForegroundColor Red
    Write-Host "       $($item.Url)" -ForegroundColor DarkGray
    Write-Host "       $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "[3] 检查项目配置..."
$configPath = Join-Path $PSScriptRoot "..\project.config.json"
$privatePath = Join-Path $PSScriptRoot "..\project.private.config.json"
if (Test-Path $configPath) {
  $config = Get-Content $configPath -Raw | ConvertFrom-Json
  Write-Host "  project.config.json appid: $($config.appid)"
  Write-Host "  project.config.json libVersion: $($config.libVersion)"
}
if (Test-Path $privatePath) {
  $private = Get-Content $privatePath -Raw | ConvertFrom-Json
  Write-Host "  project.private.config.json libVersion: $($private.libVersion)"
  if ($config -and $private.libVersion -ne $config.libVersion) {
    Write-Host "  警告: 两个配置文件基础库版本不一致，请在 IDE 本地设置里统一" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "[4] 结论与建议"
Write-Host "  webapi_getwxaasyncsecinfo:fail 表示开发者工具访问 servicewechat.com 失败。"
Write-Host "  这不是小程序代码问题，通常是网络/代理/公司防火墙导致。"
Write-Host ""
Write-Host "  请依次尝试："
Write-Host "  1. 开发者工具 -> 设置 -> 代理设置 -> 不使用任何代理"
Write-Host "  2. 关闭 VPN / Clash / 深信服等公司网络限制"
Write-Host "  3. 换手机热点测试"
Write-Host "  4. 详情 -> 本地设置 -> 调试基础库 选 3.15.2（与项目配置一致）"
Write-Host "  5. 完全退出开发者工具后运行 reset-wechat-devtools.ps1"
Write-Host "  6. 小程序内 我的 -> 清除本地数据（可绕过 IDE 清登录）"
