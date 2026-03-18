export function checkPermission(toolName: string, allowedTools: string[]): boolean {
  return allowedTools.includes(toolName);
}
