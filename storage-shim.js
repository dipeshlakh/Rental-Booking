// storage-shim.js
// Minimal shim that preserves the localStorage API but syncs five keys to Supabase kv_store.
// Tailored to your app's keys: rb_products, rb_bookings, rb_cart, rb_next_id, rb_pin

(function(){
  // === REPLACE THESE with your Supabase details ===
  const SUPABASE_URL = "https://jnmnerbflketbkpgrqhi.supabase.co"; // e.g. https://abcd1234.supabase.co
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpubW5lcmJmbGtldGJrcGdycWhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4OTk4NTUsImV4cCI6MjA3NTQ3NTg1NX0.FCny8fiBJ-s5Vt84SkSA5VM6BORjZ4Jz1yzgbko96ec";
  // =================================================

  // Keys to sync (taken from your app)
  const SYNC_KEYS = ["rb_products","rb_bookings","rb_cart","rb_next_id","rb_pin"];

  // Keep original localStorage as fallback for instant UX
  const _local = window.localStorage;

  // small in-memory cache
  const memory = new Map();

  // helper for supabase REST calls to kv_store table
  async function supabaseFetch(method, path, body) {
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          // prefer returning representations on inserts/patches
          "Prefer": "return=representation"
        },
        body: body ? JSON.stringify(body) : undefined
      });
      if (!res.ok) {
        // return an object with error to allow graceful fallback
        return { error: true, status: res.status, text: await res.text() };
      }
      const text = await res.text();
      // some responses might be empty
      try { return JSON.parse(text); } catch(e){ return text || {}; }
    } catch (err) {
      return { error: true, exception: String(err) };
    }
  }

  // read a key from server (returns parsed JSON string if exists)
  async function fetchKeyFromServer(key) {
    const q = `kv_store?select=value&key=eq.${encodeURIComponent(key)}`;
    const res = await supabaseFetch('GET', q);
    if (res && Array.isArray(res) && res.length) {
      // value stored as JSONB (string or object). We'll return string for compatibility.
      const val = res[0].value;
      // If value is object, convert to string to match existing localStorage expectations
      return (typeof val === 'string') ? val : JSON.stringify(val);
    }
    return null;
  }

  // upsert key -> value on server
  async function upsertKeyServer(key, value) {
    // value might be a string (often JSON-string). Try to store parsed JSON when possible.
    let parsed;
    try { parsed = JSON.parse(value); } catch(e) { parsed = value; }
    // First try PATCH (update existing row)
    const patchPath = `kv_store?key=eq.${encodeURIComponent(key)}`;
    const patchRes = await supabaseFetch('PATCH', patchPath, { value: parsed });
    if (patchRes && patchRes.error) {
      // Try insert
      await supabaseFetch('POST', 'kv_store', { key, value: parsed });
    }
    return;
  }

  // delete key on server
  async function deleteKeyServer(key) {
    await supabaseFetch('DELETE', `kv_store?key=eq.${encodeURIComponent(key)}`);
  }

  // Initialize: load sync keys into memory (async) so getItem() can return quickly if cached
  (async function initCache(){
    for (const k of SYNC_KEYS) {
      // read server copy; if exists, store in memory and in localStorage
      const serverVal = await fetchKeyFromServer(k);
      if (serverVal !== null && serverVal !== undefined) {
        memory.set(k, serverVal);
        try { _local.setItem(k, serverVal); } catch(e) {}
      } else {
        // no server copy: keep local copy if present
        try {
          const localVal = _local.getItem(k);
          if (localVal !== null) memory.set(k, localVal);
        } catch(e){}
      }
    }
  })();

  // The shim object that will replace window.localStorage
  const shim = {
    getItem: function(key) {
      // prefer in-memory cache (fast)
      if (memory.has(key)) return memory.get(key);
      // if key is one we sync, trigger an async fetch for later
      if (SYNC_KEYS.includes(key)) {
        fetchKeyFromServer(key).then(v => {
          if (v !== null && v !== undefined) {
            memory.set(key, v);
            try { _local.setItem(key, v); } catch(e){}
          }
        }).catch(()=>{});
      }
      // fallback to original localStorage
      try { return _local.getItem(key); } catch(e){ return null; }
    },

    setItem: function(key, value) {
      // immediate local update for snappy UX
      memory.set(key, value);
      try { _local.setItem(key, value); } catch(e){}
      // if key is in the SYNC list, attempt server upsert in background
      if (SYNC_KEYS.includes(key)) {
        // fire-and-forget, but attempt insert or patch
        upsertKeyServer(key, value).catch(()=>{});
      }
    },

    removeItem: function(key) {
      memory.delete(key);
      try { _local.removeItem(key); } catch(e){}
      if (SYNC_KEYS.includes(key)) {
        deleteKeyServer(key).catch(()=>{});
      }
    },

    // compatibility helpers
    key: function(i) { try { return _local.key(i); } catch(e){ return null; } },
    clear: function() {
      memory.clear();
      try { _local.clear(); } catch(e){}
      // delete only our keys on server to be safe
      SYNC_KEYS.forEach(k => deleteKeyServer(k).catch(()=>{}));
    },
    get length() { try { return _local.length; } catch(e){ return 0; } }
  };

  // Replace window.localStorage with the shim
  try { Object.defineProperty(window, 'localStorage', { value: shim, configurable: true, writable: true }); }
  catch(e) { window.localStorage = shim; }

})();
