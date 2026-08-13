import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { type PermissionMode, type TaskNode } from "./types.js";

export interface SecurityConfig {
  dataExfiltrationProtection: boolean;
  allowedDomains: string[];
  blockedPatterns: string[];
  defaultPermission: PermissionMode;
  auditLogEnabled: boolean;
  redactPatterns: RegExp[];
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  permission: PermissionMode;
  allowed: boolean;
  reason?: string;
  hash: string;
}

const DEFAULT_CONFIG: SecurityConfig = {
  dataExfiltrationProtection: true,
  allowedDomains: [],
  blockedPatterns: [
    "password", "secret", "api_key", "apikey", "token", "credential",
    "private_key", "access_key", "session_key",
  ],
  defaultPermission: "scoped-write",
  auditLogEnabled: true,
  redactPatterns: [
    /(?:password|passwd|pwd)\s*[=:]\s*\S+/gi,
    /(?:api[_-]?key|apikey)\s*[=:]\s*\S+/gi,
    /(?:token|secret)\s*[=:]\s*\S+/gi,
    /(?:Bearer\s+)[A-Za-z0-9\-_]+/g,
    /(?:sk-)[A-Za-z0-9]{20,}/g,
  ],
};

export class SecurityGuard {
  private readonly config: SecurityConfig;
  private readonly auditDir: string;
  private readonly auditFile: string;

  constructor(private readonly cwd: string, config?: Partial<SecurityConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.auditDir = join(cwd, ".coagent", "audit");
    this.auditFile = join(this.auditDir, `audit-${new Date().toISOString().slice(0, 10)}.log`);
    if (!existsSync(this.auditDir)) mkdirSync(this.auditDir, { recursive: true });
  }

  checkDataExfiltration(content: string, destination?: string): { allowed: boolean; reason?: string; sanitized: string } {
    let sanitized = content;

    if (this.config.dataExfiltrationProtection) {
      if (destination && this.config.allowedDomains.length > 0) {
        const destDomain = this.extractDomain(destination);
        if (destDomain && !this.config.allowedDomains.includes(destDomain)) {
          this.audit("system", "data-transfer", destination, "trusted", false, `Domain ${destDomain} not in allowlist`);
          return { allowed: false, reason: `Data transfer to ${destDomain} blocked: not in allowlist`, sanitized: "" };
        }
      }

      for (const pattern of this.config.redactPatterns) {
        sanitized = sanitized.replace(pattern, "[REDACTED]");
      }

      const detected = this.detectSensitiveData(content);
      if (detected && destination) {
        this.audit("system", "data-transfer", destination, "trusted", false, `Sensitive data detected: ${detected}`);
        return { allowed: false, reason: `Sensitive data detected: ${detected}`, sanitized: "" };
      }
    }

    return { allowed: true, sanitized };
  }

  private detectSensitiveData(content: string): string | null {
    const lower = content.toLowerCase();
    for (const pattern of this.config.blockedPatterns) {
      if (lower.includes(pattern)) {
        const idx = lower.indexOf(pattern);
        const context = content.slice(Math.max(0, idx - 10), idx + pattern.length + 20);
        return `${pattern} (context: ${context})`;
      }
    }
    return null;
  }

  private extractDomain(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch {
      return null;
    }
  }

  checkPermission(
    actor: string,
    action: string,
    resource: string,
    permission: PermissionMode,
    task?: TaskNode,
  ): { allowed: boolean; reason?: string } {
    let allowed = false;
    let reason: string | undefined;

    switch (permission) {
      case "read-only":
        if (action === "read") {
          allowed = true;
        } else {
          allowed = false;
          reason = "read-only permission denies write operations";
        }
        break;

      case "scoped-write":
        if (action === "read") {
          allowed = true;
        } else if (action === "write" || action === "edit") {
          if (task && task.assignedFiles.length > 0) {
            allowed = task.assignedFiles.some((scope) => resource.startsWith(scope) || resource.includes(scope));
            if (!allowed) reason = `Resource ${resource} outside assigned scope`;
          } else {
            allowed = true;
          }
        } else {
          allowed = false;
          reason = `Unknown action: ${action}`;
        }
        break;

      case "review-gate":
        if (action === "read") {
          allowed = true;
        } else {
          allowed = false;
          reason = "review-gate requires explicit approval for write operations";
        }
        break;

      case "trusted":
        allowed = true;
        break;
    }

    this.audit(actor, action, resource, permission, allowed, reason);
    return { allowed, reason };
  }

  redactContent(content: string): string {
    let redacted = content;
    for (const pattern of this.config.redactPatterns) {
      redacted = redacted.replace(pattern, "[REDACTED]");
    }
    return redacted;
  }

  audit(
    actor: string,
    action: string,
    resource: string,
    permission: PermissionMode,
    allowed: boolean,
    reason?: string,
  ): void {
    if (!this.config.auditLogEnabled) return;

    const timestamp = new Date().toISOString();
    const id = `audit_${createHash("sha256").update(timestamp + actor + action + resource).digest("hex").slice(0, 12)}`;
    const hash = createHash("sha256").update(JSON.stringify({ id, timestamp, actor, action, resource, allowed })).digest("hex");

    const entry: AuditEntry = {
      id,
      timestamp,
      actor,
      action,
      resource,
      permission,
      allowed,
      reason,
      hash,
    };

    appendFileSync(this.auditFile, JSON.stringify(entry) + "\n", "utf-8");
  }

  getAuditLog(date?: string): AuditEntry[] {
    const file = date
      ? join(this.auditDir, `audit-${date}.log`)
      : this.auditFile;
    if (!existsSync(file)) return [];

    const lines = readFileSync(file, "utf-8").trim().split("\n");
    const entries: AuditEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {}
    }
    return entries;
  }

  verifyAuditIntegrity(date?: string): { valid: boolean; tampered: string[] } {
    const entries = this.getAuditLog(date);
    const tampered: string[] = [];

    for (const entry of entries) {
      const expectedHash = createHash("sha256")
        .update(JSON.stringify({
          id: entry.id,
          timestamp: entry.timestamp,
          actor: entry.actor,
          action: entry.action,
          resource: entry.resource,
          allowed: entry.allowed,
        }))
        .digest("hex");

      if (expectedHash !== entry.hash) {
        tampered.push(entry.id);
      }
    }

    return { valid: tampered.length === 0, tampered };
  }

  getConfig(): SecurityConfig {
    return { ...this.config };
  }

  static loadConfig(cwd: string): Partial<SecurityConfig> | null {
    const p = join(cwd, ".coagent", "security.json");
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return null;
    }
  }

  static saveConfig(cwd: string, config: Partial<SecurityConfig>): void {
    const dir = join(cwd, ".coagent");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "security.json"), JSON.stringify(config, null, 2) + "\n", "utf-8");
  }
}