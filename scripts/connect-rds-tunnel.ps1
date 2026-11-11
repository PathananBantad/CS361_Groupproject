$ErrorActionPreference = "Stop"

$envPath = Join-Path $PSScriptRoot "..\backend\.env"
$envValues = @{}
foreach ($line in Get-Content $envPath) {
    if ($line -match '^\s*([^#=\s]+)\s*=\s*(.*)$') {
        $name = $Matches[1]
        if ($name -in @("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION")) {
            $envValues[$name] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
}

if (-not $envValues.AWS_REGION) {
    throw "AWS_REGION is required in backend\.env"
}

foreach ($name in $envValues.Keys) {
    [Environment]::SetEnvironmentVariable($name, $envValues[$name], "Process")
}

$instance = aws rds describe-db-instances `
    --db-instance-identifier "cs361-docuflow-rds" `
    --region $envValues.AWS_REGION `
    --query "DBInstances[0].{Status:DBInstanceStatus,Endpoint:Endpoint.Address,Port:Endpoint.Port}" `
    --output json | ConvertFrom-Json

if (-not $instance -or $instance.Status -ne "available") {
    throw "RDS cs361-docuflow-rds is not available yet"
}

$ec2Instances = aws ec2 describe-instances `
    --filters "Name=tag:Name,Values=CafeServer" "Name=instance-state-name,Values=running" `
    --region $envValues.AWS_REGION `
    --query "Reservations[].Instances[]" `
    --output json | ConvertFrom-Json
$bastion = $ec2Instances | Select-Object -First 1

if (-not $bastion) {
    throw "Running CafeServer instance was not found"
}

$parameterFile = Join-Path $env:TEMP ("rds-tunnel-" + [guid]::NewGuid().ToString() + ".json")
try {
    @{
        host = @($instance.Endpoint)
        portNumber = @([string]$instance.Port)
        localPortNumber = @("13306")
    } | ConvertTo-Json -Compress | Set-Content -Path $parameterFile -Encoding ascii

    aws ssm start-session `
        --target $bastion.InstanceId `
        --document-name "AWS-StartPortForwardingSessionToRemoteHost" `
        --parameters "file://$parameterFile" `
        --region $envValues.AWS_REGION

    if ($LASTEXITCODE -ne 0) {
        throw "SSM port forwarding session failed"
    }
} finally {
    if (Test-Path -LiteralPath $parameterFile) {
        Remove-Item -LiteralPath $parameterFile -Force
    }
}
