// Retired legacy V2 permission workaround. Function URL permissions are owned by
// the V5 CloudFormation stack; this entry point intentionally performs no AWS calls.
console.error("This legacy permission script is disabled. Manage V5 Function URL permissions through CloudFormation.");
process.exitCode = 1;
