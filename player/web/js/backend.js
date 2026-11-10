/* Video-link store + admin login. Appwrite when configured, otherwise localStorage (local mode). */
(function () {
  'use strict';
  const C = window.DLS_BACKEND || {};
  const TBL = C.tableId || C.collectionId;                 // new Appwrite = "table", old Appwrite = "collection" (same ID field)
  const configured = !!(C.project && C.databaseId && TBL);
  const LS = 'dls.library', SS = 'dls.localAuth';
  // local mode only (client-side check, not real security): SHA-256 of the admin password
  const LOCAL_HASH = 'd31f5ec5b2239904489f7d85739ae9827aef386eb379d76a9d49aa6529ff6caf';
  let account = null, databases = null, tables = null;
  function sdk() {
    if (account) return true;
    if (!window.Appwrite) return false;
    const client = new Appwrite.Client().setEndpoint(C.endpoint).setProject(C.project);
    account = new Appwrite.Account(client); databases = new Appwrite.Databases(client);
    tables = Appwrite.TablesDB ? new Appwrite.TablesDB(client) : null;
    return true;
  }
  async function sha(s) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  const norm = (d) => ({ id: d.$id, name: d.name, url: d.url, kind: d.kind === 'special' || d.kind === 'intro' ? d.kind : 'normal', at: d.$createdAt || '' });
  const B = window.DLSBackend = {
    configured,
    mode: configured ? 'appwrite' : 'local',
    async isLoggedIn() {
      if (!configured) return sessionStorage.getItem(SS) === '1';
      if (!sdk()) return false;
      try { await account.get(); return true; } catch (e) { return false; }
    },
    async login(pw) {
      if (!configured) {
        if (await sha(pw) !== LOCAL_HASH) throw new Error('Wrong password');
        sessionStorage.setItem(SS, '1'); return true;
      }
      if (!sdk()) throw new Error('Appwrite SDK could not load (check internet)');
      try {
        await (account.createEmailPasswordSession || account.createEmailSession).call(account, C.adminEmail, pw);
      } catch (e) { throw new Error(e && e.code === 401 ? 'Wrong password' : (e && e.message) || 'Login failed'); }
      return true;
    },
    async logout() {
      sessionStorage.removeItem(SS);
      if (configured && sdk()) { try { await account.deleteSession('current'); } catch (e) { /* ignore */ } }
    },
    /* public read: no login needed (plain REST, no SDK) */
    async list() {
      let items;
      if (!configured) { try { items = JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { items = []; } }
      else {
        const hdr = { headers: { 'X-Appwrite-Project': C.project } };
        const q = '?queries%5B0%5D=' + encodeURIComponent('{"method":"limit","values":[100]}');
        // new Appwrite (TablesDB) first, old Databases API as fallback
        let r = await fetch(C.endpoint + '/tablesdb/' + C.databaseId + '/tables/' + TBL + '/rows' + q, hdr);
        if (!r.ok) r = await fetch(C.endpoint + '/databases/' + C.databaseId + '/collections/' + TBL + '/documents' + q, hdr);
        if (!r.ok) throw new Error('Appwrite read failed (HTTP ' + r.status + ')');
        const j = await r.json();
        items = (j.rows || j.documents || []).map(norm);
      }
      return items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    },
    async add(item) {
      const rec = { name: String(item.name).slice(0, 100), url: String(item.url).slice(0, 2000), kind: item.kind === 'special' || item.kind === 'intro' ? item.kind : 'normal' };
      if (!configured) {
        const all = await B.list(); const row = Object.assign({ id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString() }, rec);
        all.push(row); localStorage.setItem(LS, JSON.stringify(all)); return row;
      }
      if (!sdk()) throw new Error('Appwrite SDK not loaded');
      if (tables) return norm(await tables.createRow({ databaseId: C.databaseId, tableId: TBL, rowId: Appwrite.ID.unique(), data: rec }));
      return norm(await databases.createDocument(C.databaseId, TBL, Appwrite.ID.unique(), rec));
    },
    async remove(id) {
      if (!configured) { const all = (await B.list()).filter((x) => x.id !== id); localStorage.setItem(LS, JSON.stringify(all)); return; }
      if (!sdk()) throw new Error('Appwrite SDK not loaded');
      if (tables) { await tables.deleteRow({ databaseId: C.databaseId, tableId: TBL, rowId: id }); return; }
      await databases.deleteDocument(C.databaseId, TBL, id);
    }
  };
})();
