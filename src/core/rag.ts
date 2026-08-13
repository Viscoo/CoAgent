import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative, sep } from "node:path";

export interface RAGDocument {
  id: string;
  path: string;
  content: string;
  chunks: TextChunk[];
  indexedAt: string;
}

export interface TextChunk {
  id: string;
  docId: string;
  text: string;
  tokens: string[];
  tf: Map<string, number>;
}

export interface SearchResult {
  chunk: TextChunk;
  docPath: string;
  score: number;
}

export interface RAGIndex {
  documents: RAGDocument[];
  df: Map<string, number>;
  totalChunks: number;
  updatedAt: string;
}

const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 64;
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".ts", ".js", ".json", ".py", ".yaml", ".yml", ".html", ".css"]);

export class RAGKnowledgeBase {
  private index: RAGIndex;
  private readonly indexDir: string;

  constructor(private readonly cwd: string) {
    this.indexDir = join(cwd, ".coagent", "rag");
    this.index = this.loadIndex();
  }

  private loadIndex(): RAGIndex {
    const p = join(this.indexDir, "index.json");
    if (!existsSync(p)) {
      return { documents: [], df: new Map(), totalChunks: 0, updatedAt: new Date().toISOString() };
    }
    try {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      return {
        documents: raw.documents ?? [],
        df: new Map(Object.entries(raw.df ?? {})),
        totalChunks: raw.totalChunks ?? 0,
        updatedAt: raw.updatedAt ?? new Date().toISOString(),
      };
    } catch {
      return { documents: [], df: new Map(), totalChunks: 0, updatedAt: new Date().toISOString() };
    }
  }

  private saveIndex(): void {
    if (!existsSync(this.indexDir)) mkdirSync(this.indexDir, { recursive: true });
    const serialized = {
      documents: this.index.documents,
      df: Object.fromEntries(this.index.df),
      totalChunks: this.index.totalChunks,
      updatedAt: this.index.updatedAt,
    };
    writeFileSync(join(this.indexDir, "index.json"), JSON.stringify(serialized, null, 2), "utf-8");
  }

  indexFile(filePath: string): RAGDocument | null {
    const absPath = filePath;
    if (!existsSync(absPath)) return null;
    const ext = extname(absPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return null;

    const content = readFileSync(absPath, "utf-8");
    const relPath = relative(this.cwd, absPath).split(sep).join("/");
    const docId = `doc_${relPath.replace(/[^a-zA-Z0-9]/g, "_")}`;

    const existing = this.index.documents.findIndex((d) => d.id === docId);
    if (existing >= 0) {
      if (this.index.documents[existing].content === content) return this.index.documents[existing];
    }

    const chunks = this.chunkText(content, docId);
    const doc: RAGDocument = {
      id: docId,
      path: relPath,
      content,
      chunks,
      indexedAt: new Date().toISOString(),
    };

    if (existing >= 0) {
      this.index.documents[existing] = doc;
    } else {
      this.index.documents.push(doc);
    }

    this.rebuildDF();
    this.index.totalChunks = this.index.documents.reduce((sum, d) => sum + d.chunks.length, 0);
    this.index.updatedAt = new Date().toISOString();
    this.saveIndex();
    return doc;
  }

  indexDirectory(dirPath: string, excludeDirs: string[] = ["node_modules", ".git", "dist", ".coagent"]): number {
    let count = 0;
    const walk = (dir: string) => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          if (excludeDirs.includes(entry)) continue;
          walk(full);
        } else if (stat.isFile()) {
          if (this.indexFile(full)) count++;
        }
      }
    };
    walk(dirPath);
    return count;
  }

  private chunkText(text: string, docId: string): TextChunk[] {
    const tokens = this.tokenize(text);
    const chunks: TextChunk[] = [];

    for (let i = 0; i < tokens.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
      const chunkTokens = tokens.slice(i, i + CHUNK_SIZE);
      if (chunkTokens.length < 10) break;

      const chunkText = chunkTokens.join(" ");
      const tf = new Map<string, number>();
      for (const token of chunkTokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
      }

      chunks.push({
        id: `${docId}_chunk_${chunks.length}`,
        docId,
        text: chunkText,
        tokens: chunkTokens,
        tf,
      });
    }

    return chunks;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  private rebuildDF(): void {
    const df = new Map<string, number>();
    for (const doc of this.index.documents) {
      for (const chunk of doc.chunks) {
        const seen = new Set(chunk.tokens);
        for (const token of seen) {
          df.set(token, (df.get(token) ?? 0) + 1);
        }
      }
    }
    this.index.df = df;
  }

  search(query: string, topK = 5): SearchResult[] {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    const N = this.index.totalChunks || 1;
    const results: SearchResult[] = [];

    for (const doc of this.index.documents) {
      for (const chunk of doc.chunks) {
        let score = 0;
        for (const qt of queryTokens) {
          const tf = chunk.tf.get(qt);
          if (!tf) continue;
          const df = this.index.df.get(qt) ?? 0;
          if (df === 0) continue;
          const idf = Math.log(N / df);
          score += tf * idf;
        }
        if (score > 0) {
          results.push({ chunk, docPath: doc.path, score });
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  buildContext(query: string, topK = 3): string {
    const results = this.search(query, topK);
    if (results.length === 0) return "";

    const sections = results.map((r, i) => {
      return `[${i + 1}] (score: ${r.score.toFixed(2)}, source: ${r.docPath})\n${r.chunk.text}`;
    });

    return "=== Knowledge Base Context ===\n" + sections.join("\n\n") + "\n=== End Context ===";
  }

  injectIntoPrompt(prompt: string, query: string): string {
    const context = this.buildContext(query);
    if (!context) return prompt;
    return `${context}\n\n${prompt}`;
  }

  getStats(): { documents: number; chunks: number; updatedAt: string } {
    return {
      documents: this.index.documents.length,
      chunks: this.index.totalChunks,
      updatedAt: this.index.updatedAt,
    };
  }

  removeDocument(docId: string): boolean {
    const idx = this.index.documents.findIndex((d) => d.id === docId);
    if (idx < 0) return false;
    this.index.documents.splice(idx, 1);
    this.rebuildDF();
    this.index.totalChunks = this.index.documents.reduce((sum, d) => sum + d.chunks.length, 0);
    this.index.updatedAt = new Date().toISOString();
    this.saveIndex();
    return true;
  }

  clear(): void {
    this.index = { documents: [], df: new Map(), totalChunks: 0, updatedAt: new Date().toISOString() };
    this.saveIndex();
  }
}