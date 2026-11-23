// Zugriff auf das Notizen-Repo über die GitHub-API.
// Einzelne Notizen werden über die Contents-API gespeichert (mit SHA-Prüfung gegen Überschreiben).
// Umbenennen, Verschieben und Löschen mehrerer Dateien laufen als ein Commit über die Git-Data-API.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.conflict = status === 409 || (status === 422 && /sha/i.test(message || ''));
  }
}

export function encodeText(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function decodeText(b64) {
  const bin = atob((b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

export class Repo {
  constructor({ owner, repo, token }) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.branch = 'main';
  }

  get base() {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
  }

  async req(method, path, body) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError(0, 'Keine Verbindung');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new GitHubError(res.status, (data && data.message) || res.statusText);
    return data;
  }

  async init() {
    const info = await this.req('GET', this.base);
    this.branch = info.default_branch || 'main';
    return info;
  }

  // Liefert alle Einträge des Repos: [{path, type: 'blob'|'tree', sha}]
  async listTree() {
    try {
      const t = await this.req('GET', `${this.base}/git/trees/${encodeURIComponent(this.branch)}?recursive=1`);
      return t.tree || [];
    } catch (e) {
      // Leeres Repo: erste Datei anlegen, damit es einen Branch gibt
      if (e.status === 404 || e.status === 409) {
        try {
          await this.req('PUT', `${this.base}/contents/.gitkeep`, {
            message: 'Notepad eingerichtet',
            content: '',
          });
        } catch {
          throw e;
        }
        const info = await this.init();
        const t = await this.req('GET', `${this.base}/git/trees/${encodeURIComponent(info.default_branch || 'main')}?recursive=1`);
        return t.tree || [];
      }
      throw e;
    }
  }

  async getFile(path) {
    const d = await this.req('GET', `${this.base}/contents/${encPath(path)}?ref=${encodeURIComponent(this.branch)}`);
    if (d.content === undefined || d.encoding === 'none') {
      return { sha: d.sha, content: await this.getBlob(d.sha) };
    }
    return { sha: d.sha, content: decodeText(d.content) };
  }

  async getBlob(sha) {
    const d = await this.req('GET', `${this.base}/git/blobs/${sha}`);
    return decodeText(d.content);
  }

  // sha = bisheriger Stand. Passt er nicht mehr zum Stand auf GitHub, kommt ein Konflikt-Fehler.
  async putFile(path, text, sha, message) {
    const body = { message, content: encodeText(text), branch: this.branch };
    if (sha) body.sha = sha;
    const d = await this.req('PUT', `${this.base}/contents/${encPath(path)}`, body);
    return { sha: d.content.sha };
  }

  // Mehrere Änderungen in einem Commit.
  // changes: [{path, sha}] verschiebt/kopiert einen vorhandenen Inhalt,
  //          [{path, content}] schreibt neuen Text,
  //          [{path, sha: null}] löscht die Datei.
  async commit(changes, message) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await this.req('GET', `${this.base}/git/ref/heads/${encodeURIComponent(this.branch)}`);
      const head = ref.object.sha;
      const commit = await this.req('GET', `${this.base}/git/commits/${head}`);
      const tree = await this.req('POST', `${this.base}/git/trees`, {
        base_tree: commit.tree.sha,
        tree: changes.map((c) =>
          c.content !== undefined
            ? { path: c.path, mode: '100644', type: 'blob', content: c.content }
            : { path: c.path, mode: '100644', type: 'blob', sha: c.sha }
        ),
      });
      const created = await this.req('POST', `${this.base}/git/commits`, {
        message,
        tree: tree.sha,
        parents: [head],
      });
      try {
        await this.req('PATCH', `${this.base}/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: created.sha });
        return created.sha;
      } catch (e) {
        lastError = e;
        if (e.status !== 422 && e.status !== 409) throw e;
      }
    }
    throw lastError;
  }
}
