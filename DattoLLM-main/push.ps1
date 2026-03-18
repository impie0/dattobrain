# ============================================================
#  DattoLLM — Git Push Helper
#  Usage:
#    .\push.ps1                        # auto-generates commit message
#    .\push.ps1 "my commit message"    # custom commit message
#    .\push.ps1 -Tag v1.6.0            # push with a version tag
#    .\push.ps1 "my message" -Tag v1.6.0
# ============================================================

param(
    [string]$Message = "",
    [string]$Tag = ""
)

$RepoPath = $PSScriptRoot
Set-Location $RepoPath

# ── Confirm we are inside the right repo ────────────────────
$remote = git remote get-url origin 2>$null
if ($remote -notlike "*DattoLLM*") {
    Write-Host "ERROR: Remote does not look like DattoLLM. Aborting." -ForegroundColor Red
    exit 1
}

# ── Check for changes ────────────────────────────────────────
$status = git status --porcelain
if (-not $status) {
    Write-Host "Nothing to commit — working tree clean." -ForegroundColor Yellow
    exit 0
}

# ── Build commit message ─────────────────────────────────────
if ($Message -eq "") {
    $date = Get-Date -Format "yyyy-MM-dd HH:mm"
    $changed = (git diff --name-only HEAD 2>$null) + (git ls-files --others --exclude-standard 2>$null)
    $fileCount = ($status | Measure-Object -Line).Lines

    # Try to summarise which services changed
    $services = @()
    if ($changed -match "ai-service/")       { $services += "ai-service" }
    if ($changed -match "auth-service/")     { $services += "auth-service" }
    if ($changed -match "mcp-bridge/")       { $services += "mcp-bridge" }
    if ($changed -match "read-only-mcp/")    { $services += "mcp-server" }
    if ($changed -match "embedding-service/"){ $services += "embedding-service" }
    if ($changed -match "services/web-app/") { $services += "web-app" }
    if ($changed -match "db/")               { $services += "db" }
    if ($changed -match "\.md$")             { $services += "docs" }
    if ($changed -match "docker-compose")    { $services += "docker" }

    $scope = if ($services.Count -gt 0) { " [$($services -join ', ')]" } else { "" }
    $Message = "Update$scope — $fileCount file(s) changed ($date)"
}

# ── Stage + commit ────────────────────────────────────────────
Write-Host ""
Write-Host "Staging all changes..." -ForegroundColor Cyan
git add .

Write-Host "Committing: $Message" -ForegroundColor Cyan
git commit -m $Message

if ($LASTEXITCODE -ne 0) {
    Write-Host "Commit failed." -ForegroundColor Red
    exit 1
}

# ── Optional tag ─────────────────────────────────────────────
if ($Tag -ne "") {
    Write-Host "Tagging as $Tag..." -ForegroundColor Cyan
    git tag -a $Tag -m "Release $Tag"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Tagging failed (tag may already exist)." -ForegroundColor Yellow
    }
}

# ── Push ─────────────────────────────────────────────────────
Write-Host "Pushing to origin/main..." -ForegroundColor Cyan
git push origin main

if ($Tag -ne "") {
    Write-Host "Pushing tag $Tag..." -ForegroundColor Cyan
    git push origin $Tag
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Done! $remote" -ForegroundColor Green
    git log --oneline -5
} else {
    Write-Host "Push failed. Check your credentials or network." -ForegroundColor Red
    exit 1
}
