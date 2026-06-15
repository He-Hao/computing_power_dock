# 重置微信开发者工具本地缓存（需先完全关闭开发者工具）
Write-Host "=== 重置微信开发者工具本地缓存 ===" -ForegroundColor Cyan

$devtools = Get-Process -Name "wechatdevtools" -ErrorAction SilentlyContinue
if ($devtools) {
  Write-Host "请先完全关闭微信开发者工具，再运行此脚本。" -ForegroundColor Red
  exit 1
}

$base = Join-Path $env:LOCALAPPDATA "微信开发者工具\User Data"
if (-not (Test-Path $base)) {
  Write-Host "未找到开发者工具数据目录: $base" -ForegroundColor Red
  exit 1
}

$targets = @(
  "WeappLocalData",
  "WeappSimulator",
  "WeappPureSimulatorCache",
  "WeappCache"
)

$removed = 0
Get-ChildItem $base -Directory | ForEach-Object {
  foreach ($name in $targets) {
    $path = Join-Path $_.FullName $name
    if (Test-Path $path) {
      Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host "已清除: $($_.Name)\$name" -ForegroundColor Green
      $removed += 1
    }
  }
}

if ($removed -eq 0) {
  Write-Host "未找到可清除的缓存目录，可能已被清理。" -ForegroundColor Yellow
} else {
  Write-Host "`n完成。请重新打开微信开发者工具并导入项目。" -ForegroundColor Green
}
