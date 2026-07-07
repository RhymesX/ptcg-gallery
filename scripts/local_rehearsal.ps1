# local_rehearsal.ps1 — 拆库本地演习脚本
# 用法：在项目根目录下执行 .\scripts\local_rehearsal.ps1

$ErrorActionPreference = "Stop"
$python = "C:\Users\DELL\AppData\Local\Programs\Python\Python311\python.exe"

Write-Host "=== Step 0: Pre-check ===" -ForegroundColor Cyan
& $python --version
& $python -c "import flask; import openpyxl; print('Dependencies OK')"

Write-Host "`n=== Step 0b: Verify tests (baseline) ===" -ForegroundColor Cyan
$testResult = & $python -m unittest discover -s tests -v 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host $testResult; throw "Baseline tests failed - fix before proceeding" }
Write-Host "Tests OK (baseline confirmed)"

Write-Host "`n=== Step 1: Backup ===" -ForegroundColor Cyan
$ts = Get-Date -Format "yyyyMMddTHHmmss"
$backupDir = "data\backups\local-rehearsal-$ts"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item "data\ptcg_gallery.db" "$backupDir\ptcg_gallery.db"
if (Test-Path "data\search_preferences.json") { Copy-Item "data\search_preferences.json" "$backupDir\search_preferences.json" }
if (Test-Path "data\auth.json") { Copy-Item "data\auth.json" "$backupDir\auth.json" }
if (Test-Path "data\accounts") { Copy-Item -Recurse "data\accounts" "$backupDir\accounts" }
Write-Host "Backup created: $backupDir"

Write-Host "`n=== Step 2: Inspect ===" -ForegroundColor Cyan
& $python scripts/migrate_split_db.py
if ($LASTEXITCODE -ne 0) { throw "Inspect failed" }

Write-Host "`n=== Step 3: Apply migration ===" -ForegroundColor Cyan
Remove-Item -Force data\accounts\*.db -ErrorAction SilentlyContinue
& $python scripts/migrate_split_db.py --apply --force
if ($LASTEXITCODE -ne 0) { throw "Migration apply failed" }

Write-Host "`n=== Step 4: Verify file structure ===" -ForegroundColor Cyan
Get-ChildItem data\accounts\

Write-Host "`n=== Step 5: Run tests ===" -ForegroundColor Cyan
$testResult = & $python -m unittest discover -s tests -v 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host $testResult; throw "Tests failed after migration" }
Write-Host "Tests OK (42 passed)"

Write-Host "`n=== All steps passed! ===" -ForegroundColor Green
Write-Host "Backup: $backupDir"
Write-Host ""
Write-Host "Now start the app: python run.py"
Write-Host "Then manually verify with the checklist in docs/db_split_local_checklist.md"
Write-Host ""
Write-Host "To rollback:"
Write-Host "  copy -Force '$backupDir\ptcg_gallery.db' 'data\ptcg_gallery.db'"
Write-Host "  Remove-Item -Force data\accounts\*.db"
