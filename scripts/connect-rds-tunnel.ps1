param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z]{2}(?:-[a-z0-9]+)+-\d$')][string]$Region,
    [Parameter(Mandatory = $true)][ValidatePattern('^\d{12}$')][string]$ExpectedAccountId,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z][A-Za-z0-9-]{0,62}$')][string]$RdsInstanceIdentifier,
    [Parameter(Mandatory = $true)][ValidatePattern('^i-[0-9a-f]{8}(?:[0-9a-f]{9})?$')][string]$BastionInstanceId,
    [ValidateRange(1024, 65535)][int]$LocalPortNumber = 13306
)

$ErrorActionPreference = "Stop"

# AWS CLI uses its normal credential provider chain (environment, profile, or role).
$callerAccount = aws sts get-caller-identity `
    --region $Region `
    --query Account `
    --output text
if ($LASTEXITCODE -ne 0) {
    throw "Unable to verify the AWS caller identity"
}
if ($callerAccount.Trim() -ne $ExpectedAccountId) {
    throw "AWS caller account does not match ExpectedAccountId"
}

$instanceJson = aws rds describe-db-instances `
    --db-instance-identifier $RdsInstanceIdentifier `
    --region $Region `
    --query "DBInstances[0].{Status:DBInstanceStatus,Endpoint:Endpoint.Address,Port:Endpoint.Port}" `
    --output json
if ($LASTEXITCODE -ne 0) {
    throw "Unable to describe the configured RDS instance"
}
$instance = $instanceJson | ConvertFrom-Json
if (-not $instance -or $instance.Status -ne "available" -or -not $instance.Endpoint) {
    throw "The configured RDS instance is not available"
}

$bastionState = aws ec2 describe-instances `
    --instance-ids $BastionInstanceId `
    --region $Region `
    --query "Reservations[0].Instances[0].State.Name" `
    --output text
if ($LASTEXITCODE -ne 0 -or $bastionState.Trim() -ne "running") {
    throw "The configured bastion instance is not running or cannot be inspected"
}

$parameterFile = Join-Path $env:TEMP ("rds-tunnel-" + [guid]::NewGuid().ToString() + ".json")
try {
    @{
        host = @($instance.Endpoint)
        portNumber = @([string]$instance.Port)
        localPortNumber = @([string]$LocalPortNumber)
    } | ConvertTo-Json -Compress | Set-Content -Path $parameterFile -Encoding ascii

    aws ssm start-session `
        --target $BastionInstanceId `
        --document-name "AWS-StartPortForwardingSessionToRemoteHost" `
        --parameters "file://$parameterFile" `
        --region $Region

    if ($LASTEXITCODE -ne 0) {
        throw "SSM port forwarding session failed"
    }
} finally {
    if (Test-Path -LiteralPath $parameterFile) {
        Remove-Item -LiteralPath $parameterFile -Force
    }
}
