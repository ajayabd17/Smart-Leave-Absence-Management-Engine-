param(
    [Parameter(Mandatory = $true)][string]$StackName,
    [Parameter(Mandatory = $true)][string]$S3Bucket,
    [Parameter(Mandatory = $true)][string]$CognitoUserPoolId,
    [Parameter(Mandatory = $true)][string]$CognitoClientId,
    [Parameter(Mandatory = $true)][string]$SesFromEmail,
    [Parameter(Mandatory = $true)][string]$ApprovalTokenSecret,
    [string]$AllowedOrigin = "http://localhost:8000",
    [string]$ApprovalBaseUrl = "http://localhost:8000",
    [string]$Region = "ap-south-1"
)

$ErrorActionPreference = "Stop"

Push-Location "$PSScriptRoot\..\infra"
try {
    sam build --template-file template.yaml
    sam deploy `
        --stack-name $StackName `
        --resolve-s3 `
        --s3-bucket $S3Bucket `
        --region $Region `
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM `
        --parameter-overrides `
            AllowedOrigin=$AllowedOrigin `
            CognitoUserPoolId=$CognitoUserPoolId `
            CognitoClientId=$CognitoClientId `
            SesFromEmail=$SesFromEmail `
            ApprovalBaseUrl=$ApprovalBaseUrl `
            ApprovalTokenSecret=$ApprovalTokenSecret
}
finally {
    Pop-Location
}
