param(
  [string]$EnvFile = ".env.local"
)

$requiredServer = @(
  "SUPABASE_SERVICE_ROLE_KEY",
  "JWT_SECRET",
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_STARTER_PRICE_ID",
  "STRIPE_PRO_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
  "OPENAI_API_KEY"
)

$requiredPublic = @(
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
)

$optionalOps = @(
  "SUPABASE_DB_URL"
)

if (-not (Test-Path -LiteralPath $EnvFile)) {
  Write-Error "Env file not found: $EnvFile"
  exit 1
}

$values = @{}
Get-Content -LiteralPath $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { return }
  $name, $value = $line.Split("=", 2)
  $values[$name.Trim()] = $value.Trim().Trim('"').Trim("'")
}

function Get-Status {
  param([string]$Name, [string]$Value)

  if (-not $Value) { return "missing" }
  if ($Value -match "your_|placeholder|changeme") { return "placeholder" }
  if ($Name -eq "JWT_SECRET" -and $Value.Length -lt 32) { return "weak" }
  if ($Name -like "STRIPE_*" -and $Value -match "^sk_test|^pk_test") { return "test_key" }
  if ($Name -eq "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" -and $Value -match "^pk_test") { return "test_key" }
  if ($Name -eq "NEXT_PUBLIC_APP_URL" -and $Value -match "localhost|127\.0\.0\.1") { return "local_url" }
  return "present"
}

$rows = @()
foreach ($name in ($requiredServer + $requiredPublic + $optionalOps)) {
  $value = $values[$name]
  $rows += [pscustomobject]@{
    Name = $name
    Scope = $(if ($requiredPublic -contains $name) { "public" } elseif ($optionalOps -contains $name) { "ops" } else { "server" })
    Status = Get-Status $name $value
    Length = $(if ($value) { $value.Length } else { 0 })
  }
}

$rows | Format-Table -AutoSize

$bad = $rows | Where-Object {
  $_.Name -ne "SUPABASE_DB_URL" -and $_.Status -in @("missing", "placeholder", "weak", "test_key", "local_url")
}

if ($bad.Count -gt 0) {
  Write-Error "Production env check failed. Fix rows marked missing/placeholder/weak/test_key/local_url."
  exit 1
}

Write-Output "Production env check passed. No secret values were printed."
