// Long Lens on your own site: gives the game the same db / user / assets API it uses on claude.ai,
// backed by Firebase (Google sign-in + Firestore). Wall photos are stored in Firestore as base64,
// so the project works on the free Spark plan with no billing account.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, getDoc, setDoc, updateDoc, deleteDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const LL = window.__ll;
const notReady = !firebaseConfig || !firebaseConfig.apiKey || String(firebaseConfig.apiKey).includes('PASTE');
if (notReady) {
  console.warn('Long Lens: firebase-config.js is not filled in yet. Online features are off.');
  LL.resolve({ db: null, user: null, assets: null });
} else {
  start();
}

function wrapErr(e) {
  const map = { 'permission-denied': 'not_granted', 'unauthenticated': 'not_granted', 'resource-exhausted': 'quota' };
  const err = new Error(e && e.message || 'error'); err.code = map[e && e.code] || (e && e.code) || 'error'; return err;
}

async function start() {
  const app = initializeApp(firebaseConfig);
  // Visitor statistics (countries, devices) in Firebase > Analytics. Never blocks the game.
  if (firebaseConfig.measurementId) {
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js')
      .then(async m => { if (await m.isSupported()) m.getAnalytics(app); })
      .catch(() => {});
  }
  const auth = getAuth(app);
  const fs = getFirestore(app);
  try { await getRedirectResult(auth); } catch (e) { /* ignore */ }
  const first = await new Promise(res => { const off = onAuthStateChanged(auth, u => { off(); res(u); }); });
  let current = first;
  onAuthStateChanged(auth, u => { if ((u && u.uid) !== (current && current.uid)) location.reload(); });

  // Service worker serves /_blob/<id> from Firestore, so the game's image URLs work unchanged.
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js?p=' + encodeURIComponent(firebaseConfig.projectId), { scope: './' });
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise(res => { navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }); setTimeout(res, 3000); });
      }
    } catch (e) { console.warn('Long Lens: service worker failed', e); }
  }

  const snapDoc = s => ({ id: s.id, exists: s.exists(), data: () => s.data() });
  const ref = path => { const p = path.split('/'); return doc(fs, ...p); };
  const db = {
    collection: name => ({
      onSnapshot: (cb, errCb) => onSnapshot(collection(fs, name),
        s => cb({ docs: s.docs.map(d => ({ id: d.id, data: () => d.data() })), metadata: { fromCache: s.metadata.fromCache } }),
        e => errCb && errCb(wrapErr(e)))
    }),
    doc: path => ({
      get: async () => { try { return snapDoc(await getDoc(ref(path))); } catch (e) { throw wrapErr(e); } },
      set: async d => { try { await setDoc(ref(path), d); } catch (e) { throw wrapErr(e); } },
      update: async d => { try { await updateDoc(ref(path), d); } catch (e) { throw wrapErr(e); } },
      onSnapshot: (cb, errCb) => onSnapshot(ref(path), s => cb(snapDoc(s)), e => errCb && errCb(wrapErr(e)))
    })
  };

  // Owner check without putting the owner's email in public code: only the owner may read admin/check.
  let isOwner = false;
  if (current) { try { await getDoc(doc(fs, 'admin', 'check')); isOwner = true; } catch (e) { isOwner = false; } }

  const user = {
    id: async () => current ? current.uid : null,
    canEdit: async () => isOwner,
    me: async () => current ? { id: current.uid, name: current.displayName || '', avatarUrl: current.photoURL || '' } : { id: null },
    profiles: async () => ({})
  };

  const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  async function shrink(blob) {
    const LIMIT = 720 * 1024;
    if (blob.size <= LIMIT) return blob;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    for (const q of [0.78, 0.7, 0.62, 0.54, 0.46, 0.4]) {
      const b = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
      if (b && b.size <= LIMIT) return b;
    }
    const e = new Error('too big'); e.code = 'too_big'; throw e;
  }
  const assets = current ? {
    upload: async (blob) => {
      const small = await shrink(blob);
      const id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { await setDoc(doc(fs, 'images', id), { owner: current.uid, type: 'image/jpeg', d: await toB64(small), at: Date.now() }); }
      catch (e) { throw wrapErr(e); }
      return { id };
    },
    delete: async id => { try { await deleteDoc(doc(fs, 'images', id)); } catch (e) { throw wrapErr(e); } }
  } : null;

  // Sign-in button in the top bar.
  // Google blocks sign-in inside app browsers (Instagram, Facebook, LINE, Telegram...): tell the visitor how to get out.
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|Line\/|Telegram|TikTok|Snapchat|; wv\)/i.test(navigator.userAgent);
  if (!current && inApp) {
    const bar = document.createElement('p');
    bar.className = 'note inappbar';
    bar.textContent = 'To sign in with Google, open this page in Safari or Chrome: tap ••• (or ⋮) and choose “Open in browser”. You can play here without signing in.';
    bar.style.cssText = 'margin:10px 16px;padding:10px 12px;border-radius:8px;background:#f5c000;color:#121416;font-weight:600';
    document.body.prepend(bar);
  }
  const btn = document.getElementById('authBtn');
  if (btn) {
    btn.hidden = false;
    btn.textContent = current ? 'Sign out' : 'Sign in with Google';
    btn.addEventListener('click', async () => {
      if (current) { await signOut(auth); return; }
      const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
      try { await signInWithPopup(auth, provider); }
      catch (e) { if (e && /popup|cancelled-popup|operation-not-supported/.test(e.code || '')) await signInWithRedirect(auth, provider); }
    });
  }

  LL.resolve({ db, user, assets });
}
