# 部署 tradeApi 云函数（解决 -504003 / 3 秒超时）
# 用法：在微信开发者工具中右键 cloudfunctions/tradeApi →「上传并部署：云端安装依赖」
# 本脚本仅做配置检查与提示。

$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root "cloudfunctions\tradeApi\config.json"

Write-Host "=== tradeApi 云函数部署检查 ===" -ForegroundColor Cyan

if (-not (Test-Path $configPath)) {
  Write-Host "未找到 config.json: $configPath" -ForegroundColor Red
  exit 1
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
Write-Host "本地 config.json 超时: $($config.timeout) 秒" -ForegroundColor Green
Write-Host "内存: $($config.memorySize) MB" -ForegroundColor Green

Write-Host ""
Write-Host "请手动完成部署（PowerShell 无法代你上传云函数）：" -ForegroundColor Yellow
Write-Host "  1. 打开微信开发者工具，导入 miniprogram-mvp"
Write-Host "  2. 展开 cloudfunctions/tradeApi"
Write-Host "  3. 右键 → 上传并部署：云端安装依赖"
Write-Host "  4. 云开发控制台 → 云函数 → tradeApi → 配置，确认超时为 120 秒"
Write-Host "  5. 重新编译小程序，营运工作台下拉刷新"
Write-Host ""
