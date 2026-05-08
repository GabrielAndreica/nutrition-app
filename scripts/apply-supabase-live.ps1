param(
  [string]$EnvFile = ".env.local",
  [switch]$IncludeReferenceData,
  [switch]$IncludeDestructiveReferenceData
)

$ErrorActionPreference = "Stop"

function Read-EnvValue {
  param([string]$Name)

  $envValue = [Environment]::GetEnvironmentVariable($Name)
  if ($envValue) { return $envValue }
  if (-not (Test-Path -LiteralPath $EnvFile)) { return $null }

  $line = Get-Content -LiteralPath $EnvFile | Where-Object {
    $_.Trim() -match "^$Name="
  } | Select-Object -First 1

  if (-not $line) { return $null }
  return ($line -split "=", 2)[1].Trim().Trim('"').Trim("'")
}

$dbUrl = Read-EnvValue "SUPABASE_DB_URL"
if (-not $dbUrl) {
  Write-Error "SUPABASE_DB_URL is missing. Add the Supabase Postgres connection string to .env.local or set it for this shell."
  exit 1
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$appRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$coreSql = @(
  "$appRoot\supabase\activity_logs.sql",
  "$root\supabase\rate-limiting.sql",
  "$root\supabase\add_email_confirmation_to_users.sql",
  "$root\supabase\add_trial_system.sql",
  "$appRoot\supabase\client_invitations.sql",
  "$appRoot\supabase\weight_history.sql",
  "$appRoot\supabase\add_food_preferences.sql",
  "$root\supabase\add_has_new_progress.sql",
  "$root\supabase\add_workout_fields_to_clients.sql",
  "$root\supabase\workout_plans.sql",
  "$root\supabase\generation_status.sql",
  "$root\supabase\notifications.sql",
  "$root\supabase\add_previous_plan_calories.sql",
  "$root\supabase\monthly_client_usage_limits.sql",
  "$root\supabase\performance_indexes.sql",
  "$root\supabase\production_readiness_indexes.sql",
  "$root\supabase\production-optimization-safe.sql",
  "$root\supabase\enable_realtime.sql"
)

$referenceSql = @(
  "$appRoot\supabase\foods.sql",
  "$root\supabase\recipes.sql",
  "$root\supabase\add_base_amount_g_to_recipes.sql",
  "$root\supabase\add_ratio_pct_to_recipes.sql",
  "$root\supabase\snack_grains.sql"
)

$destructiveReferenceSql = @(
  "$root\supabase\foods_v2.sql",
  "$root\supabase\recipes_200_high_protein.sql",
  "$root\supabase\snack_replace.sql",
  "$root\supabase\exercises_full_gym.sql",
  "$root\supabase\exercises_clean.sql"
)

$files = @($coreSql)
if ($IncludeReferenceData) { $files += $referenceSql }
if ($IncludeDestructiveReferenceData) { $files += $destructiveReferenceSql }

foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath $file)) {
    Write-Error "Missing SQL file: $file"
    exit 1
  }
}

Write-Output "Applying $($files.Count) Supabase SQL files. Connection string will not be printed."
foreach ($file in $files) {
  Write-Output "psql apply: $file"
  & psql $dbUrl -v ON_ERROR_STOP=1 -f $file
}

Write-Output "Supabase SQL apply completed."
