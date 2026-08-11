import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

export interface Skill {
	name: string;
	description: string;
	path: string;
	content: string;
}

export function loadSkills(cwd: string): Skill[] {
	const skills: Skill[] = [];
	const dirs = [
		join(cwd, ".coagent", "skills"),
		join(cwd, ".pi", "agent", "skills"),
	];
	const seen = new Set<string>();

	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		let entries: string[];
		try { entries = readdirSync(dir); } catch { continue; }
		for (const entry of entries) {
			const skillDir = join(dir, entry);
			if (!statSync(skillDir).isDirectory()) continue;
			const skillFile = join(skillDir, "SKILL.md");
			if (!existsSync(skillFile)) continue;
			if (seen.has(entry)) continue;
			seen.add(entry);
			try {
				const raw = readFileSync(skillFile, "utf-8");
				const { description, body } = parseSkillMd(raw);
				skills.push({ name: entry, description, path: skillFile, content: body });
			} catch {}
		}
	}
	return skills;
}

function parseSkillMd(raw: string): { description: string; body: string } {
	const lines = raw.split("\n");
	let description = "";
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.startsWith("# ")) continue;
		if (line.trim() && !description) {
			description = line.replace(/^>\s*/, "").trim();
			break;
		}
	}
	if (!description) description = "(no description)";
	return { description, body: raw };
}

export function buildSkillsSystemPrompt(skills: Skill[]): string {
	if (skills.length === 0) return "";
	const lines = ["# Available Skills", "Use a skill by reading its SKILL.md and following its steps.", ""];
	for (const s of skills) {
		lines.push(`- ${s.name}: ${s.description} (path: ${s.path})`);
	}
	return lines.join("\n");
}

export function getSkill(name: string, cwd: string): Skill | undefined {
	return loadSkills(cwd).find((s) => s.name === name);
}