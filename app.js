/* v5 app.js - Booking app (no backend) */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const LS = { products:"rb_products", bookings:"rb_bookings", cart:"rb_cart", nextBookingId:"rb_next_id", pin:"rb_pin" };
const state = {
  products: load(LS.products, []),
  bookings: load(LS.bookings, []),
  cart: load(LS.cart, { items: [], customer: {}, billingDate: todayYMD() }),
  nextBookingId: load(LS.nextBookingId, 1),
  pin: load(LS.pin, "1234")
};
function save(key,val){ localStorage.setItem(key, JSON.stringify(val)); }
function load(key,fallback){ try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }

function todayYMD(){ const d=new Date(); const m=(d.getMonth()+1).toString().padStart(2,'0'); const dd=d.getDate().toString().padStart(2,'0'); return `${d.getFullYear()}-${m}-${dd}`; }
const D = s => new Date(s + "T00:00:00");
const daysBetween = (a,b) => (D(b)-D(a))/86400000;
const rentDays = (pickup,ret) => Math.max(1, daysBetween(pickup,ret)-1);
function fmt(d){ const [y,m,dd]=d.split("-"); return `${dd}/${m}/${y}`; }

function classifyOverlap(a,b){
  const as=D(a.start), ae=D(a.end), bs=D(b.start), be=D(b.end);
  const exclusive = (as < be) && (bs < ae);
  if (exclusive) return "RED";
  const edge = (as.getTime()===be.getTime()) || (bs.getTime()===ae.getTime());
  if (edge) return "YELLOW"; return "GREEN";
}
function caseEq(a,b){ return (a||"").toLowerCase() === (b||"").toLowerCase(); }
function findConflicts(productId, range){
  const conflicts=[];
  for(const bk of state.bookings){
    for(const it of bk.items){
      if(it.productId===productId){
        const cls = classifyOverlap({start:it.pickup,end:it.return}, range);
        if(cls!=="GREEN") conflicts.push({bookingId:bk.bookingId,pickup:it.pickup,return:it.return,cls});
      }
    }
  }
  return conflicts;
}

function calcCartTotals(){
  const total = state.cart.items.reduce((s,it)=> s + rentDays(it.pickup,it.return)*(it.pricePerDay||0),0);
  const discount = Number($("#discount").value||0);
  const advance = Number($("#advance").value||0);
  const final = Math.max(0, total - discount);
  const due = Math.max(0, final - advance);
  return { total, discount, final, advance, due };
}

function nextBookingId(){ const id = state.nextBookingId; state.nextBookingId = id+1; save(LS.nextBookingId, state.nextBookingId); return (""+id).padStart(4,"0"); }

function askPin(){
  return new Promise(res=>{
    const dlg = $("#pinModal"); dlg.showModal();
    $("#pinOk").onclick = ()=>{ const ok = $("#pinInput").value === state.pin; if(!ok){ alert("Incorrect PIN"); return; } dlg.close(); res(true); };
    $("#pinCancel").onclick = ()=>{ dlg.close(); res(false); };
  });
}
function toast(msg){ const d=document.createElement("div"); d.className="toast"; d.textContent=msg; document.body.appendChild(d); setTimeout(()=>d.remove(),2000); }

const pages=["collection","selector","cart","bookings","pickreturn"];
function show(page){ pages.forEach(p=>$("#page-"+p).classList.add("hidden")); $("#page-"+page).classList.remove("hidden"); $$(".nav-btn").forEach(b=>b.classList.toggle("active", b.dataset.page===page)); if(page==="collection") renderCollection(); if(page==="selector") renderSelector(); if(page==="cart") renderCart(); if(page==="bookings") renderBookings(); if(page==="pickreturn") renderPickReturn(); }
$$(".nav-btn").forEach(b=> b.addEventListener("click", ()=> show(b.dataset.page)));
show("collection");

function setDateMins(){ const t=todayYMD(); $("#selPickup").setAttribute("min",t); $("#selReturn").setAttribute("min",t); $("#billDate").setAttribute("min",t); $("#prDate").setAttribute("min",t); }
setDateMins();
["selPickup","selReturn"].forEach(id=>{ $("#"+id).addEventListener("change", ()=>{ const p=$("#selPickup").value; const r=$("#selReturn").value; if(p) $("#selReturn").setAttribute("min",p); if(p && r && (D(r) < D(p))){ alert("Return date cannot be before pickup date."); $("#selReturn").value = p; } renderSelector(); }); });

// Collection
$("#btnAddProduct").onclick = ()=> openProductForm();
$("#searchProduct").addEventListener("input", renderCollection);
$("#filterCategory").addEventListener("change", renderCollection);
$("#filterStatus").addEventListener("change", renderCollection);

function openProductForm(edit=null){
  const dlg = $("#productForm");
  $("#pfTitle").textContent = edit? "Edit Product":"Add Product";
  $("#pfCode").value = edit?.id || "";
  $("#pfName").value = edit?.name || "";
  // set radio
  if(edit){ if(edit.category==="Jewellery"){ $("#pfCatJewellery").checked=true; } else { $("#pfCatLehenga").checked=true; } }
  $("#pfPrice").value = edit?.pricePerDay || "";
  $("#pfSize").value = edit?.size || "";
  dlg.showModal();
  $("#pfCancel").onclick = ()=> dlg.close();
  $("#pfSave").onclick = async ()=> {
    const id = $("#pfCode").value.trim(); const name = $("#pfName").value.trim();
    const catRadio = document.querySelector('input[name="pfCategory"]:checked'); const category = catRadio? catRadio.value : "";
    const price = Number($("#pfPrice").value||0); const size = $("#pfSize").value.trim();
    if(!id || !name || !category || price<=0){ alert("Please fill required fields."); return; }
    const exists = state.products.some(p=> caseEq(p.id,id) && (!edit || !caseEq(edit.id,id)));
    if(exists){ alert("Code already exists."); return; }
    let photo = edit?.photo || "";
    const file = $("#pfPhoto").files[0];
    if(file) photo = await fileToDataURL(file,1200,0.7);
    const obj = { id, name, category, pricePerDay: price, size, photo, inventoryStatus: edit?.inventoryStatus || "In store" };
    if(edit){ const idx = state.products.findIndex(p=>caseEq(p.id, edit.id)); state.products[idx] = obj; } else { state.products.push(obj); }
    save(LS.products, state.products); dlg.close(); renderCollection(); toast(edit? "Product updated":"Product added");
  };
}

function fileToDataURL(file, maxW=1600, quality=0.7){
  return new Promise(res=>{
    const fr = new FileReader();
    fr.onload = ()=>{ const img = new Image(); img.onload = ()=>{ const c=document.createElement("canvas"); const scale = Math.min(1, maxW/img.width); c.width = img.width*scale; c.height = img.height*scale; const ctx=c.getContext("2d"); ctx.drawImage(img,0,0,c.width,c.height); res(c.toDataURL('image/jpeg', quality)); }; img.src = fr.result; }; fr.readAsDataURL(file);
  });
}

function renderCollection(){
  const q = ($("#searchProduct").value||"").toLowerCase();
  const cat = $("#filterCategory").value; const st = $("#filterStatus").value;
  const wrap = $("#productList"); wrap.innerHTML = "";
  const items = state.products.filter(p=>{ const matchQ = p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q); const matchC = !cat || p.category===cat; const matchS = !st || p.inventoryStatus===st; return matchQ && matchC && matchS; });
  for(const p of items){
    const card = document.createElement("div"); card.className="card";
    card.innerHTML = `
      <div class="thumb">${p.photo? `<img src="${p.photo}" alt="${p.name}">` : "<span>Image</span>"}</div>
      <div class="row"><strong>${p.name}</strong><span class="badge">${p.category}</span></div>
      <div class="row"><span class="muted">${p.id} ${p.size? '· Size '+p.size : ''}</span><strong>₹${p.pricePerDay}/day</strong></div>
      <div class="row">
        <span class="badge ${p.inventoryStatus==='Out on rent'?'yellow': p.inventoryStatus==='Maintenance'?'red':'green'}">${p.inventoryStatus}</span>
        <div class="row" style="gap:6px">
          <button class="btn" data-act="bookings">Bookings</button>
          ${p.inventoryStatus==='Maintenance' ? '<button class="btn" data-act="restore">Mark In store</button>' : ''}
          <button class="btn" data-act="edit">Edit</button>
          <button class="btn danger" data-act="delete">Delete</button>
        </div>
      </div>
    `;
    card.querySelector('[data-act="edit"]').onclick = ()=> openProductForm(p);
    const restoreBtn = card.querySelector('[data-act="restore"]');
    if(restoreBtn) restoreBtn.onclick = ()=> { p.inventoryStatus = "In store"; save(LS.products,state.products); renderCollection(); toast("Marked In store"); };
    card.querySelector('[data-act="delete"]').onclick = ()=> { const future = state.bookings.some(bk=> bk.items.some(it=> it.productId===p.id && D(it.pickup)>=D(todayYMD()))); if(future){ alert("Cannot delete. Product has future bookings."); return; } if(confirm("Delete product?")){ state.products = state.products.filter(x=>!caseEq(x.id,p.id)); save(LS.products,state.products); renderCollection(); } };
    card.querySelector('[data-act="bookings"]').onclick = ()=> openBookingDetailForProduct(p.id);
    wrap.appendChild(card);
  }
}

// Selector
$("#btnNewBooking").onclick = ()=> { if(state.cart.items.length>0 || state.cart.customer.name || state.cart.customer.mobile){ const ok = confirm("Start new booking? This will clear current cart."); if(!ok) return; } state.cart = { items: [], customer: {}, billingDate: todayYMD() }; save(LS.cart,state.cart); updateCartCount(); renderSelector(); };
$("#searchSelector").addEventListener("input", renderSelector);
$("#selPickup").addEventListener("change", renderSelector);
$("#selReturn").addEventListener("change", renderSelector);
$("#goToCart").onclick = ()=> show("cart");

function renderSelector(){
  const wrap = $("#selectorResults"); wrap.innerHTML = "";
  const q = ($("#searchSelector").value||"").toLowerCase();
  const pickup = $("#selPickup").value; const ret = $("#selReturn").value; const canCheck = pickup && ret;
  const list = state.products.filter(p=> p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  for(const p of list){
    let statusBadge = `<span class="badge">—</span>`; let conflicts = [];
    if(canCheck){ conflicts = findConflicts(p.id, {start: pickup, end: ret}); const cls = conflicts.some(c=>c.cls==="RED") ? "RED" : conflicts.some(c=>c.cls==="YELLOW") ? "YELLOW" : "GREEN"; statusBadge = `<span class="badge ${cls==='GREEN'?'green':cls==='YELLOW'?'yellow':'red'}">${cls==='GREEN'?'Available': cls==='YELLOW'?'Unavailable (same day)':'Unavailable'}</span>`; }
    const inCart = state.cart.items.some(it=> caseEq(it.productId,p.id));
    const card = document.createElement("div"); card.className="card";
    card.innerHTML = `
      <div class="thumb">${p.photo? `<img src="${p.photo}" alt="${p.name}">` : "<span>Image</span>"}</div>
      <div class="row"><strong>${p.name}</strong> ${statusBadge}</div>
      <div class="row"><span class="muted">${p.id} · ${p.category}${p.size? ' · Size '+p.size : ''}</span><strong>₹${p.pricePerDay}/day</strong></div>
      <div class="row" style="gap:8px;justify-content:flex-end">
        <button class="${inCart? 'btn' : 'primary'}" data-act="toggle">${inCart? 'Remove from Cart' : 'Add to Cart'}</button>
      </div>
      ${conflicts.length? `<div style="margin-top:8px;font-size:12px;color:#6b7280">Conflicts: ${conflicts.map(c=>`#${c.bookingId} (${fmt(c.pickup)}→${fmt(c.return)})`).join(', ')}</div>` : ''}
    `;
    card.querySelector('[data-act="toggle"]').onclick = ()=> { if(!inCart){ if(conflicts.length){ openWarning(`This item has conflicting booking(s): ${conflicts.map(c=>`#${c.bookingId} (${fmt(c.pickup)}→${fmt(c.return)})`).join(', ')}. Add anyway?`, ()=> { addToCart(p,pickup,ret); }); } else { addToCart(p,pickup,ret); } } else { removeFromCart(p.id); } };
    wrap.appendChild(card);
  }
  renderMiniCart();
}
function openWarning(text,onOk){ const dlg=$("#warnModal"); $("#warnText").textContent = text; dlg.showModal(); $("#warnOk").onclick = ()=> { dlg.close(); onOk&&onOk(); }; $("#warnCancel").onclick = ()=> dlg.close(); }
function addToCart(p,pickup,ret){ if(!pickup || !ret){ alert("Choose pickup and return dates first."); return; } state.cart.items.push({ productId:p.id, name:p.name, code:p.id, category:p.category, size:p.size, pricePerDay:p.pricePerDay, pickup, return:ret, sizeAdjust:null }); save(LS.cart,state.cart); updateCartCount(); renderSelector(); toast("Added to cart"); }
function removeFromCart(productId){ state.cart.items = state.cart.items.filter(it=>!caseEq(it.productId,productId)); save(LS.cart,state.cart); updateCartCount(); renderSelector(); }
function renderMiniCart(){ const ul=$("#miniCart"); ul.innerHTML=""; for(const it of state.cart.items){ const li=document.createElement("li"); li.textContent = `${it.name} • ${fmt(it.pickup)}→${fmt(it.return)}`; ul.appendChild(li); } }

// Cart
$("#btnCartReset").onclick = ()=> { if(confirm("Reset cart?")){ state.cart = { items: [], customer: {}, billingDate: todayYMD() }; save(LS.cart,state.cart); updateCartCount(); renderCart(); } };
$("#billDate").value = state.cart.billingDate || todayYMD();
$("#billDate").addEventListener("change", ()=>{ state.cart.billingDate = $("#billDate").value; save(LS.cart,state.cart); });
["custName","custMobile","custAddr","discount","advance","payMode","remark"].forEach(id=> $("#"+id).addEventListener("input", updatePriceSummary));

$("#generateBill").onclick = async ()=>{
  if(state.cart.items.length===0) return alert("Cart is empty");
  const name = $("#custName").value.trim(); const mobile = $("#custMobile").value.trim();
  if(!name) return alert("Customer name is required");
  if(!/^\d{10}$/.test(mobile)) return alert("Mobile must be 10 digits");
  const conflicts = [];
  for(const it of state.cart.items){ for(const c of findConflicts(it.productId, {start:it.pickup, end:it.return})){ conflicts.push({...c, productId:it.productId}); } }
  if(conflicts.length){ const ok = await askPin(); if(!ok) return; }
  const pricing = calcCartTotals(); const bookingId = nextBookingId();
  const booking = { bookingId, billingDate: $("#billDate").value || todayYMD(), customer: { name, mobile, address: $("#custAddr").value.trim() }, items: state.cart.items.map(it=> ({ ...it, status:"booked", pickupPhotos:[], returnPhotos:[] })), pricing, paymentMode: $("#payMode").value, status:"Booked", remarks: $("#remark").value.trim() };
  state.bookings.push(booking); save(LS.bookings,state.bookings);
  openReceiptWindow(booking);
  state.cart = { items: [], customer: {}, billingDate: todayYMD() }; save(LS.cart,state.cart); updateCartCount(); renderCart(); toast("Booking created"); if(typeof updateNavBadges==='function') updateNavBadges(); show("bookings");
};

function openReceiptWindow(bk){
  const itemsHtml = bk.items.map(it=>`<tr><td>${it.name} (${it.productId})</td><td>${fmt(it.pickup)}→${fmt(it.return)}</td><td>₹${it.pricePerDay}</td><td>${rentDays(it.pickup,it.return)}</td><td>₹${rentDays(it.pickup,it.return)*it.pricePerDay}</td></tr>`).join("");
  const msg = encodeURIComponent(`Booking ${bk.bookingId}\nTotal: ₹${bk.pricing.final}`); const wa = `https://wa.me/91${bk.customer.mobile}?text=${msg}`;
  const w = window.open("","_blank"); w.document.write(`<html><head><title>Receipt ${bk.bookingId}</title><style>body{font-family:Inter,system-ui;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}</style></head><body><h2>Receipt #${bk.bookingId}</h2><p><strong>Name:</strong> ${bk.customer.name.toUpperCase()} | <strong>Mobile:</strong> ${bk.customer.mobile}</p><p><strong>Billing Date:</strong> ${fmt(bk.billingDate)}</p><table><thead><tr><th>Item</th><th>Dates</th><th>₹/day</th><th>Days</th><th>Subtotal</th></tr></thead><tbody>${itemsHtml}</tbody></table><h3>Total: ₹${bk.pricing.total} &nbsp; Discount: -₹${bk.pricing.discount} &nbsp; Final: ₹${bk.pricing.final}</h3><h3>Advance: ₹${bk.pricing.advance} &nbsp; Due: ₹${bk.pricing.due} &nbsp; Mode: ${bk.paymentMode}</h3><p><button onclick="window.print()">Print / Save PDF</button> <a href="${wa}" target="_blank"><button>Share via WhatsApp</button></a></p></body></html>`); w.document.close();
}

function renderCart(){
  $("#billDate").value = state.cart.billingDate || todayYMD();
  const wrap = $("#cartItems"); wrap.innerHTML = "";
  if(state.cart.items.length===0){ wrap.innerHTML = `<div class="card">No items. <button class="primary btn" onclick="show('selector')">Add Product</button></div>`; updatePriceSummary(); return; }
  for(const it of state.cart.items){
    const card = document.createElement("div"); card.className="item card";
    const isClothing = it.category.toLowerCase()!=="jewellery";
    card.innerHTML = `
      <div class="row">
        <div><strong>${it.name}</strong><div class="muted">${it.productId}${it.size? ' · Size '+it.size : ''}</div></div>
        <div><strong>₹${it.pricePerDay}/day</strong></div>
      </div>
      <div class="row"><span>Dates: ${fmt(it.pickup)}→${fmt(it.return)}</span>
        <button class="btn danger" data-act="remove">Remove</button></div>
      ${isClothing? `<details><summary>Size adjustment</summary><div class="form-grid" style="margin-top:8px"><label>Chest <input data-sz="chest" value="${it.sizeAdjust?.chest||''}" /></label><label>Waist <input data-sz="waist" value="${it.sizeAdjust?.waist||''}" /></label><label>Sleeve <input data-sz="sleeve" value="${it.sizeAdjust?.sleeve||''}" /></label><label>Length <input data-sz="length" value="${it.sizeAdjust?.length||''}" /></label></div></details>`: ''}
    `;
    card.querySelector('[data-act="remove"]').onclick = ()=> { state.cart.items = state.cart.items.filter(x=>x!==it); save(LS.cart,state.cart); renderCart(); updateCartCount(); };
    if(isClothing){ card.querySelectorAll("input[data-sz]").forEach(inp=>{ inp.addEventListener("input", ()=>{ it.sizeAdjust = it.sizeAdjust || {}; it.sizeAdjust[inp.dataset.sz] = inp.value; save(LS.cart,state.cart); }); }); }
    wrap.appendChild(card);
  }
  updatePriceSummary();
}
function updatePriceSummary(){ const { total, discount, final, advance, due } = calcCartTotals(); $("#sumTotal").textContent = "₹"+total; $("#sumFinal").textContent = "₹"+final; $("#sumDue").textContent = "₹"+due; }

// Bookings
$("#searchBooking").addEventListener("input", renderBookings);
function renderBookings(){
  const q = ($("#searchBooking").value||"").toLowerCase();
  const list = $("#bookingList"); list.innerHTML="";
  const items = state.bookings.filter(b => { return (b.bookingId+"").toLowerCase().includes(q) || (b.customer?.name||"").toLowerCase().includes(q) || (b.customer?.mobile||"").toLowerCase().includes(q); }).slice().reverse();
  for(const bk of items){
    const status = deriveBookingStatusFromItems(bk.items);
    const dates = summarizeDates(bk.items);
    const due = Math.max(0, (bk.pricing?.final||0) - (bk.pricing?.advance||0));
    const row = document.createElement("div"); row.className = "item";
    const dueLabel = due>0 ? `<span style="color:var(--bad);font-weight:700;margin-left:8px">Due ₹${due}</span>` : `<span style="color:var(--good);font-weight:700;margin-left:8px">PAID</span>`;
    row.innerHTML = `
      <div>
        <div><strong>#${bk.bookingId}</strong> • ${bk.customer.name.toUpperCase()} • ${dates}${dueLabel}</div>
        <div class="muted"></div>
      </div>
      <div>
        <span class="badge">${status}</span>
        <button class="btn" data-act="open">Open</button>
      </div>
    `;
    row.querySelector('[data-act="open"]').onclick = ()=> openBookingDetail(bk.bookingId);
    list.appendChild(row);
  }
}

function deriveBookingStatusFromItems(items){ const cnt = s=> items.filter(i=>i.status===s).length; const B=cnt('booked'), P=cnt('pickedUp'), R=cnt('returned'), D=cnt('damaged'), total=items.length; if(R + D === total) return 'Completed'; if(P === total && R===0 && B===0) return 'All picked up'; if(R>0 && P>0 && B===0) return 'Partial returned'; if(P>0 && R>0 && B>0) return 'Partial picked up & returned'; if(P>0 && B>0 && R===0) return 'Partial picked up'; return 'Booked'; }
function summarizeDates(items){ const minP = items.reduce((m,i)=> m? (D(i.pickup)<D(m)?i.pickup:m):i.pickup, null); const maxR = items.reduce((m,i)=> m? (D(i.return)>D(m)?i.return:m):i.return, null); return `${fmt(minP)}→${fmt(maxR)}`; }

function openBookingDetail(bookingId){
  const bk = state.bookings.find(b=>b.bookingId===bookingId); if(!bk) return;
  const htmlItems = bk.items.map(it=>{ const adj = it.sizeAdjust || {}; const adjText = Object.entries(adj).filter(([k,v])=>v && v.trim().length>0).map(([k,v])=>`${k}:${v}`).join(", "); return `<tr><td>${it.name} (${it.productId})</td><td>${fmt(it.pickup)}→${fmt(it.return)}</td><td>${adjText || '—'}</td><td>${it.status}</td></tr>`; }).join("");
  const msg = encodeURIComponent(`Booking ${bk.bookingId}\nTotal: ₹${bk.pricing.final}`); const wa = `https://wa.me/91${bk.customer.mobile}?text=${msg}`;
  $("#bookingDetailContent").innerHTML = `
    <h3>Booking #${bk.bookingId}</h3>
    <div style="margin:8px 0;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="bdEdit">Edit Booking</button>
      <button class="btn" id="bdPrint">Print</button>
      <a href="${wa}" target="_blank" class="btn">WhatsApp</a>
      <button class="btn danger" id="bdDelete">Delete Booking</button>
    </div>
    <p><strong>${bk.customer.name.toUpperCase()}</strong> • ${bk.customer.mobile}<br>${bk.customer.address||''}</p>
    <p><strong>Billing:</strong> ${fmt(bk.billingDate)} • Mode: ${bk.paymentMode}</p>
    <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
      <tr><th>Item</th><th>Dates</th><th>Size Adjust</th><th>Status</th></tr>
      ${htmlItems}
    </table>
    <div class="payment-summary" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px">
      <div style="background:#fafafa;padding:8px;border-radius:8px">Total<br><strong>₹${bk.pricing.total}</strong></div>
      <div style="background:#fafafa;padding:8px;border-radius:8px">Discount<br><strong>-₹${bk.pricing.discount}</strong></div>
      <div style="background:#fafafa;padding:8px;border-radius:8px">Final<br><strong>₹${bk.pricing.final}</strong></div>
      <div style="background:#fafafa;padding:8px;border-radius:8px">Advance<br><strong>₹${bk.pricing.advance}</strong></div>
      <div style="background:#fafafa;padding:8px;border-radius:8px">Due<br><strong style="color:${bk.pricing.due>0? 'var(--bad)': 'var(--good)'}">₹${bk.pricing.due}</strong></div>
    </div>
    <p style='margin-top:8px'><strong>Remark/Note:</strong> ${bk.remarks||''}</p>
  `;
  $("#bookingDetail").showModal();
  $("#bdClose").onclick = ()=> $("#bookingDetail").close();
  $("#bdPrint").onclick = ()=> openReceiptWindow(bk);
  $("#bdDelete").onclick = ()=>{ const anyPicked = bk.items.some(it=>it.status!=="booked"); if(anyPicked){ alert("Cannot delete: pickup/return already in progress."); return; } if(confirm("Delete this booking?")){ state.bookings = state.bookings.filter(b=>b.bookingId!==bookingId); save(LS.bookings,state.bookings); $("#bookingDetail").close(); renderBookings(); toast("Booking deleted"); if(typeof updateNavBadges==='function') updateNavBadges(); } };
  $("#bdEdit").onclick = ()=> openBookingEditor(bk);
}

function openBookingEditor(bk){
  const name = prompt("Customer name:", bk.customer.name); if(name===null) return;
  let mobile = prompt("Mobile (10 digits):", bk.customer.mobile); if(mobile===null) return;
  if(!/^\d{10}$/.test(mobile)){ alert("Mobile must be 10 digits"); return; }
  const addr = prompt("Address:", bk.customer.address||""); if(addr===null) return;
  const billing = prompt("Billing date (YYYY-MM-DD):", bk.billingDate); if(billing===null) return;
  const discount = Number(prompt("Discount:", bk.pricing.discount)); if(Number.isNaN(discount)) return alert("Invalid discount");
  const advance = Number(prompt("Advance:", bk.pricing.advance)); if(Number.isNaN(advance)) return alert("Invalid advance");
  const mode = prompt("Payment mode (UPI/Cash):", bk.paymentMode)||"UPI";
  for(const it of bk.items){ const np = prompt(`Pickup for ${it.productId} (YYYY-MM-DD):`, it.pickup); if(np===null) return; const nr = prompt(`Return for ${it.productId} (YYYY-MM-DD):`, it.return); if(nr===null) return; const conflicts = findConflicts(it.productId, {start: np, end: nr}).filter(c=>c.bookingId!==bk.bookingId); if(conflicts.length){ alert(`Conflicts for ${it.productId}: `+conflicts.map(c=>`#${c.bookingId} ${c.pickup}→${c.return}`).join(', ')); return; } it.pickup = np; it.return = nr; }
  bk.customer = { name, mobile, address: addr }; bk.billingDate = billing;
  const total = bk.items.reduce((s,it)=> s + rentDays(it.pickup,it.return) * (state.products.find(p=>p.id===it.productId)?.pricePerDay || it.pricePerDay || 0), 0);
  bk.pricing.total = total; bk.pricing.discount = discount; bk.pricing.final = Math.max(0, total - discount);
  bk.pricing.advance = advance; bk.pricing.due = Math.max(0, bk.pricing.final - advance);
  bk.paymentMode = (mode==="Cash"?"Cash":"UPI");
  save(LS.bookings, state.bookings); renderBookings(); openBookingDetail(bk.bookingId); toast("Booking updated");
}

function openBookingDetailForProduct(productId){
  const ups = state.bookings.flatMap(bk => bk.items.filter(it=>it.productId===productId && D(it.pickup)>=D(todayYMD())).map(it=>({bookingId:bk.bookingId,pickup:it.pickup,return:it.return})));
  if(!ups.length){ alert("No upcoming bookings for this product."); return; }
  const html = ups.map(u=>`<div>#${u.bookingId} — ${fmt(u.pickup)}→${fmt(u.return)}</div>`).join("");
  $("#bookingDetailContent").innerHTML = `<h3>Product ${productId} — Upcoming</h3>${html}`; $("#bookingDetail").showModal(); $("#bdClose").onclick = ()=> $("#bookingDetail").close();
}

// Pick/Return
$("#prDate").value = todayYMD(); $("#prDate").addEventListener("change", renderPickReturn);
function renderPickReturn(){
  const day = $("#prDate").value || todayYMD();
  const picks=[], rets=[], overduePicks=[], overdueRets=[]; const t=D(todayYMD());
  for(const bk of state.bookings){ for(const it of bk.items){ if(it.status==="booked"){ if(it.pickup===day) picks.push({bk,it}); if(D(it.pickup) < t) overduePicks.push({bk,it}); } if(it.status==="pickedUp"){ if(it.return===day) rets.push({bk,it}); if(D(it.return) < t) overdueRets.push({bk,it}); } } }
  
  
  const PU = $("#pickupsUrgent");
  if(overduePicks.length){
    PU.style.display = "block";
    PU.innerHTML = '<strong>Urgent (Overdue pickups):</strong> ' + overduePicks.map(x=>{
      return `#${x.bk.bookingId} • ${x.it.name} `+
             `<button class="btn code" data-action="open-pickup" data-bid="${x.bk.bookingId}" data-pid="${x.it.productId}">${x.it.productId}</button>`;
    }).join(' , ');
  } else {
    PU.style.display = "none";
    PU.innerHTML = "";
  }

  const RU = $("#returnsUrgent");
  if(overdueRets.length){
    RU.style.display = "block";
    RU.innerHTML = '<strong>Urgent (Overdue returns):</strong> ' + overdueRets.map(x=>{
      return `#${x.bk.bookingId} • ${x.it.name} `+
             `<button class="btn code" data-action="open-return" data-bid="${x.bk.bookingId}" data-pid="${x.it.productId}">${x.it.productId}</button>` +
             ` (${fmt(x.it.return)})`;
    }).join(' , ');
  } else {
    RU.style.display = "none";
    RU.innerHTML = "";
  }
  const PL = $("#pickupsList"); const RL = $("#returnsList");
  PL.innerHTML = "";
  for(const {bk,it} of picks){
    const due = Math.max(0, bk.pricing.final - bk.pricing.advance);
    const el = document.createElement("div"); el.className="item";
    el.innerHTML = `<div><strong>#${bk.bookingId}</strong> • ${bk.customer.name.toUpperCase()} • ${bk.customer.mobile}<br><span class="muted">${it.name} (${it.productId})</span></div>
      <div><span class="badge">Due ₹${due}</span> <button class="btn primary" data-act="pickup">Confirm Pickup</button></div>`;
    el.querySelector('[data-act="pickup"]').onclick = async ()=> {
      const dlg = $("#pickupModal"); $("#pickupCollector").value=""; $("#pickupPhotos").value=""; $("#pickupCollectedDisplay").textContent=""; $("#pickupCollectBtn").textContent="Collect"; $("#pickupCollectBtn").disabled=false;
      dlg.showModal();
      const dueHint = $("#pickupDueHint"); const dueInput = $("#pickupDueNow"); dueInput.value = due; dueHint.textContent = `Current due: ₹${due}`;
      let collected = 0;
      $("#pickupCollectBtn").onclick = ()=> { collected = Number($("#pickupDueNow").value||0); if(collected>due){ alert("Cannot collect more than due"); collected = due; $("#pickupDueNow").value = due;} $("#pickupCollectedDisplay").textContent = `Collected ₹${collected}`; $("#pickupCollectBtn").textContent = "Collected"; $("#pickupCollectBtn").disabled = true; toast(`Collected ₹${collected}`); };
      $("#pickupCancel").onclick = ()=> dlg.close();
      $("#pickupOk").onclick = async ()=> {
        const name = $("#pickupCollector").value.trim(); if(!name){ alert("Collector name required"); return; }
        const files = $("#pickupPhotos").files; if(!files || files.length===0){ alert("At least one photo required"); return; }
        const remaining = Math.max(0, due - collected); if(remaining>0){ const ok = await askPin(); if(!ok) return; }
        const photos = []; for(const f of files){ photos.push(await fileToDataURL(f,1600,0.7)); }
        it.status = "pickedUp"; it.pickerName = name; it.pickupPhotos = photos; it.lastCollected = collected;
        bk.pricing.advance = (bk.pricing.advance||0) + collected; bk.pricing.due = Math.max(0, bk.pricing.final - bk.pricing.advance);
        const prod = state.products.find(p=>p.id===it.productId); if(prod) prod.inventoryStatus = "Out on rent";
        save(LS.products, state.products); save(LS.bookings, state.bookings);
        dlg.close(); renderPickReturn(); renderBookings(); toast("Pickup confirmed"); if(typeof updateNavBadges==='function') updateNavBadges();
      };
    };
    PL.appendChild(el);
  }

  RL.innerHTML = "";
  for(const {bk,it} of rets){
    const el = document.createElement("div"); el.className="item";
    el.innerHTML = `<div><strong>#${bk.bookingId}</strong> • ${bk.customer.name.toUpperCase()} • ${bk.customer.mobile}<br><span class="muted">${it.name} (${it.productId})</span></div>
      <div><button class="btn finalize-return" class="return-primary finalize-return" class="return-primary finalize-return finalize-return" data-act="ret">Finalize Return</button></div>`;
    el.querySelector('[data-act="ret"]').onclick = async ()=> {
      const dlg = $("#returnModal"); $("#returnRemark").value=""; $("#returnPhotos").value="";
      const pr = $("#returnPickupPhotos"); pr.innerHTML = (it.pickupPhotos||[]).map(src=>`<img src="${src}">`).join("");
      dlg.showModal();
      $("#returnCancel").onclick = ()=> dlg.close();
      $("#returnOk").onclick = async ()=> {
        const cond = (document.querySelector('input[name="returnCondition"]:checked')||{}).value || 'ok';
        const files = $("#returnPhotos").files; const photos = []; for(const f of files){ photos.push(await fileToDataURL(f,1600,0.7)); }
        it.status = (cond==="damaged")? "damaged" : "returned"; it.returnPhotos = photos;
        const prod = state.products.find(p=>p.id===it.productId); if(prod) prod.inventoryStatus = (cond==="damaged")? "Maintenance" : "In store";
        save(LS.products, state.products); save(LS.bookings, state.bookings);
        dlg.close(); renderPickReturn(); renderBookings(); toast("Return finalized"); if(typeof updateNavBadges==='function') updateNavBadges();
      };
    };
    RL.appendChild(el);
  }
}

// Lightbox for pickup photos in return modal
document.addEventListener("click", function(e){
  if(e.target && e.target.tagName==="IMG" && e.target.closest && e.target.closest("#returnPickupPhotos")){
    const src = e.target.getAttribute("src"); $("#lightboxImg").src = src; $("#lightbox").style.display = "flex";
  }
});
$("#lightboxClose").onclick = ()=> { $("#lightbox").style.display = "none"; $("#lightboxImg").src = ""; };

// Urgent pickup buttons handler delegated earlier (listen for data-urgent-pick)
document.addEventListener("click", async function(e){
  if(e.target && e.target.dataset && e.target.dataset.urgentPick){
    const [bid, pid] = e.target.dataset.urgentPick.split("|"); const bk = state.bookings.find(b=>b.bookingId===bid); if(!bk) return;
    const it = bk.items.find(i=>i.productId===pid && i.status==="booked"); if(!it) return alert("Item not eligible");
    const dlg = $("#pickupModal"); $("#pickupCollector").value=""; $("#pickupPhotos").value=""; $("#pickupCollectedDisplay").textContent=""; $("#pickupCollectBtn").textContent="Collect"; $("#pickupCollectBtn").disabled=false; dlg.showModal();
    const due = Math.max(0, bk.pricing.final - bk.pricing.advance); $("#pickupDueNow").value = due; $("#pickupDueHint").textContent = `Current due: ₹${due}`;
    let collected = 0;
    $("#pickupCollectBtn").onclick = ()=> { collected = Number($("#pickupDueNow").value||0); if(collected>due){ alert("Cannot collect more than due"); collected = due; $("#pickupDueNow").value = due; } $("#pickupCollectedDisplay").textContent = `Collected ₹${collected}`; $("#pickupCollectBtn").textContent = "Collected"; $("#pickupCollectBtn").disabled = true; toast(`Collected ₹${collected}`); };
    $("#pickupCancel").onclick = ()=> dlg.close();
    $("#pickupOk").onclick = async ()=> {
      const name = $("#pickupCollector").value.trim(); if(!name){ alert("Collector name required"); return; }
      const files = $("#pickupPhotos").files; if(!files || files.length===0){ alert("At least one photo required"); return; }
      const remaining = Math.max(0, due - collected); if(remaining>0){ const ok = await askPin(); if(!ok) return; }
      const photos = []; for(const f of files){ photos.push(await fileToDataURL(f,1600,0.7)); }
      it.status = "pickedUp"; it.pickerName = name; it.pickupPhotos = photos; it.lastCollected = collected;
      bk.pricing.advance = (bk.pricing.advance||0) + collected; bk.pricing.due = Math.max(0, bk.pricing.final - bk.pricing.advance);
      const prod = state.products.find(p=>p.id===it.productId); if(prod) prod.inventoryStatus = "Out on rent";
      save(LS.products, state.products); save(LS.bookings, state.bookings);
      dlg.close(); renderPickReturn(); renderBookings(); toast("Pickup confirmed (urgent)");
    };
  }
});

function updateCartCount(){ $("#cartCount").textContent = state.cart.items.length; }
updateCartCount();

// Bulk import/export products (CSV)
document.addEventListener('click', function(e){
  if(e.target && e.target.id === 'btnImportProducts') document.getElementById('fileImportProducts').click();
  if(e.target && e.target.id === 'btnExportProducts') exportProductsCSV();
  if(e.target && e.target.id === 'btnImportZip') document.getElementById('fileImportZip').click();
});

document.getElementById('fileImportProducts')?.addEventListener('change', async function(e){
  const file = e.target.files[0]; if(!file) return;
  const text = await file.text(); const rows = text.trim().split(/\r?\n/).filter(r=>r.trim());
  if(rows.length===0){ toast('Empty file'); e.target.value=''; return; }
  const headers = rows.shift().split(',').map(h=>h.trim());
  let imported=0, skipped=0;
  for(const row of rows){
    const cols = row.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(c=>c.trim().replace(/^"|"$/g,''));
    const obj = {}; headers.forEach((h,i)=> obj[h]= (cols[i]!==undefined?cols[i]:'').trim());
    if(!obj.id || !obj.name){ skipped++; continue; }
    if(state.products.some(p=>p.id===obj.id)){ skipped++; continue; }
    obj.pricePerDay = Number(obj.pricePerDay) || 0; obj.photo = obj.photo||''; obj.inventoryStatus = obj.inventoryStatus||'In store'; obj.category = obj.category||''; obj.size = obj.size||'';
    state.products.push(obj); imported++;
  }
  save(LS.products, state.products); renderCollection(); toast(`${imported} imported, ${skipped} skipped`); e.target.value='';
});

function exportProductsCSV(){
  if(!state.products || state.products.length===0){ toast('No products to export'); return; }
  const headers = ['id','name','category','pricePerDay','size','inventoryStatus','photo'];
  const rows = [headers.join(',')];
  for(const p of state.products){
    const cols = headers.map(h=>{ let v = p[h]===undefined?'':String(p[h]); if(v.indexOf(',')>=0||v.indexOf('\n')>=0||v.indexOf('"')>=0) v = '"'+v.replace(/"/g,'""')+'"'; return v; });
    rows.push(cols.join(','));
  }
  const blob = new Blob([rows.join('\n')], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'products_export.csv'; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 3000);
}

// ZIP import using JSZip
document.getElementById('fileImportZip')?.addEventListener('change', async function(e){
  const file = e.target.files[0]; if(!file) return;
  if(typeof JSZip === 'undefined'){ toast('JSZip not loaded'); e.target.value=''; return; }
  try{
    const zip = await JSZip.loadAsync(file); const names = Object.keys(zip.files);
    const csvName = names.find(n=>/products.*\.csv$/i.test(n)) || names.find(n=>/\.csv$/i.test(n));
    if(!csvName){ toast('No CSV in ZIP'); e.target.value=''; return; }
    const csvText = await zip.file(csvName).async('string'); const rows = csvText.trim().split(/\r?\n/).filter(r=>r.trim());
    if(rows.length===0){ toast('Empty CSV'); e.target.value=''; return; }
    const headers = rows.shift().split(',').map(h=>h.trim()); let imported=0, skipped=0;
    for(const row of rows){
      const cols = row.split(/,(?=(?:[^"']*"[^"]*"')*[^\"]*$)/).map(c=>c.trim().replace(/^"|"$/g,''));
      const obj = {}; headers.forEach((h,i)=> obj[h]= (cols[i]!==undefined?cols[i]:'').trim());
      if(!obj.id || !obj.name){ skipped++; continue; } if(state.products.some(p=>p.id===obj.id)){ skipped++; continue; }
      if(obj.photo && !obj.photo.startsWith('http')){
        const candidate = names.find(n => n.replace(/\\/g,'/').toLowerCase().endsWith(obj.photo.replace(/\\/g,'/').toLowerCase()) || n.toLowerCase()===obj.photo.toLowerCase());
        if(candidate){ try{ const bin = await zip.file(candidate).async('base64'); const ext = candidate.split('.').pop().toLowerCase(); const mime = (ext==='png')? 'image/png' : (ext==='webp')? 'image/webp' : (ext==='gif')? 'image/gif' : 'image/jpeg'; obj.photo = `data:${mime};base64,${bin}`; }catch(err){ obj.photo=''; } }
      }
      obj.pricePerDay = Number(obj.pricePerDay)||0; obj.photo = obj.photo||''; obj.inventoryStatus = obj.inventoryStatus||'In store'; obj.category = obj.category||''; obj.size = obj.size||'';
      state.products.push(obj); imported++;
    }
    save(LS.products,state.products); renderCollection(); toast(`${imported} imported, ${skipped} skipped`);
  }catch(err){ console.error(err); toast('ZIP import error'); } finally { e.target.value=''; }
});



// Global handler for urgent product-code buttons (open pickup or return)
document.addEventListener('click', function(e){
  const btn = e.target.closest && e.target.closest('button[data-action]');
  if(!btn) return;
  const action = btn.getAttribute('data-action');
  const bid = btn.getAttribute('data-bid');
  const pid = btn.getAttribute('data-pid');
  if(action === 'open-return' && typeof openReturnModalFor === 'function'){
    openReturnModalFor(bid,pid);
  } else if(action === 'open-pickup' && typeof openPickupModalFor === 'function'){
    openPickupModalFor(bid,pid);
  }
});
function openPickupModalFor(bookingId, productId){
  const bk = state.bookings.find(b=>(""+b.bookingId)==(""+bookingId));
  if(!bk) return;
  const it = bk.items.find(i=>i.productId===productId);
  if(!it) return;
  const dlg = $('#pickupModal');
  $('#pickupCollector').value='';
  $('#pickupPhotos').value='';
  $('#pickupDueNow').value='';
  $('#pickupDueHint').textContent='';
  dlg.showModal();
  const due = Math.max(0, bk.pricing.final - bk.pricing.advance);
  $('#pickupDueNow').value = due;
  $('#pickupDueHint').textContent = `Current due: ₹${due}`;
  $('#pickupCollectBtn').onclick = ()=>{ /* no-op collector button handler — actual collect handled on OK */ };
  $('#pickupCancel').onclick = ()=> dlg.close();
  $('#pickupOk').onclick = async ()=> {
    const name = $('#pickupCollector').value.trim(); if(!name){ alert('Collector name required'); return; }
    const files = $('#pickupPhotos').files; if(!files || files.length===0){ alert('At least one photo required'); return; }
    let collected = Number($('#pickupDueNow').value) || 0;
    const remaining = Math.max(0, due - collected); if(remaining>0){ const ok = await askPin(); if(!ok) return; }
    const photos = []; for(const f of files){ photos.push(await fileToDataURL(f,1600,0.7)); }
    it.status = 'pickedUp'; it.pickerName = name; it.pickupPhotos = photos; it.lastCollected = collected;
    bk.pricing.advance = (bk.pricing.advance||0) + collected;
    bk.pricing.due = Math.max(0, bk.pricing.final - bk.pricing.advance);
    const prod = state.products.find(p=>p.id===it.productId); if(prod) prod.inventoryStatus = 'Out on rent';
    save(LS.products, state.products); save(LS.bookings, state.bookings);
    dlg.close(); renderPickReturn(); renderBookings(); toast('Pickup confirmed (urgent)'); if(typeof updateNavBadges==='function') updateNavBadges();
  };
}

// init seeds
if(state.products.length===0){
  state.products = [
    { id:"LHN001", name:"Silk Lehenga - Rose", category:"Lehenga", pricePerDay:1200, size:"M", photo:"", inventoryStatus:"In store" },
    { id:"JWL001", name:"Kundan Necklace", category:"Jewellery", pricePerDay:600, size:"", photo:"", inventoryStatus:"In store" },
    { id:"LHN002", name:"Embroidered Lehenga", category:"Lehenga", pricePerDay:1500, size:"L", photo:"", inventoryStatus:"In store" }
  ];
  save(LS.products, state.products);
}
renderCollection();

// mini cart go to cart
document.addEventListener('click', function(e){
  if(e.target && e.target.id==='miniGoToCart'){
    show('cart');
  }
});

// urgent return handler
document.addEventListener("click", async function(e){
  if (e.target && e.target.dataset && e.target.dataset.urgentRet){
    const [bid, pid] = e.target.dataset.urgentRet.split("|");
    const bk = state.bookings.find(b=>b.bookingId===bid);
    if(!bk) return;
    const it = bk.items.find(i=>i.productId===pid && i.status==="pickedUp");
    if(!it) return alert("Item not eligible for return");
    const dlg=$("#returnModal");
    $("#returnRemark").value=""; $("#returnPhotos").value="";
    const pr=$("#returnPickupPhotos");
    pr.innerHTML=(it.pickupPhotos||[]).map(src=>`<img src="${src}">`).join("");
    dlg.showModal();
    $("#returnCancel").onclick=()=>dlg.close();
    $("#returnOk").onclick=async ()=>{
      const cond=(document.querySelector('input[name="returnCondition"]:checked')||{}).value||'ok';
      const files=$("#returnPhotos").files;
      const photos=[];
      for(const f of files) photos.push(await fileToDataURL(f,1600,0.7));
      it.status=(cond==="damaged")?"damaged":"returned";
      it.returnPhotos=photos;
      const prod=state.products.find(p=>p.id===it.productId);
      if(prod) prod.inventoryStatus=(cond==="damaged")?"Maintenance":"In store";
      save(LS.products,state.products); save(LS.bookings,state.bookings);
      dlg.close(); renderPickReturn(); renderBookings();
      toast("Return finalized (urgent)");
      if(typeof updateNavBadges==='function') updateNavBadges();
    };
  }
});

function openReturnModalFor(bookingId, productId){
  const bk = state.bookings.find(b=>(""+b.bookingId)==(""+bookingId));
  if(!bk) return;
  const it = bk.items.find(i=>i.productId===productId && i.status==="pickedUp" || i.productId===productId);
  if(!it) return alert("Item not eligible for return");
  const dlg = $("#returnModal");
  $("#returnRemark").value = ""; $("#returnPhotos").value = "";
  const pr = $("#returnPickupPhotos"); pr.innerHTML = (it.pickupPhotos||[]).map(src=>`<img src="${src}">`).join("");
  dlg.showModal();
  $("#returnCancel").onclick = ()=> dlg.close();
  $("#returnOk").onclick = async ()=>{
    const cond = (document.querySelector('input[name="returnCondition"]:checked')||{}).value || 'ok';
    const files = $("#returnPhotos").files; const photos = [];
    for(const f of files){ photos.push(await fileToDataURL(f,1600,0.7)); }
    it.status = (cond==="damaged")? "damaged" : "returned";
    it.returnPhotos = photos;
    const prod = state.products.find(p=>p.id===it.productId); if(prod) prod.inventoryStatus = (cond==="damaged")? "Maintenance" : "In store";
    save(LS.products, state.products); save(LS.bookings, state.bookings);
    dlg.close(); renderPickReturn(); renderBookings(); toast("Return finalized (urgent)"); if(typeof updateNavBadges==='function') updateNavBadges();
  };
}

function updateNavBadges(){
  const t=D(todayYMD());
  let urgentPick=0, urgentRet=0;
  for(const bk of state.bookings){
    for(const it of bk.items){
      if(it.status==="booked" && D(it.pickup)<t) urgentPick++;
      if(it.status==="pickedUp" && D(it.return)<t) urgentRet++;
      if(it.status==="booked" && it.pickup===todayYMD()) urgentPick++;
      if(it.status==="pickedUp" && it.return===todayYMD()) urgentRet++;
    }
  }
  $$(".nav-btn").forEach(nb=>{
    if(!nb.querySelector('.dot')){
      const dot=document.createElement('span'); dot.className='dot'; nb.appendChild(dot);
    }
    if(nb.dataset.page==='pickreturn'){
      nb.querySelector('.dot').style.display=(urgentPick+urgentRet)>0?'inline-block':'none';
    }
  });
}
updateNavBadges();


// urgent return handler (added)
document.addEventListener("click", async function(e){
  if (e.target && e.target.dataset && e.target.dataset.urgentRet){
    const [bid, pid] = e.target.dataset.urgentRet.split("|");
    const bk = state.bookings.find(b=>b.bookingId===bid);
    if(!bk) return;
    const it = bk.items.find(i=>i.productId===pid && i.status==="pickedUp");
    if(!it) return alert("Item not eligible for return");
    const dlg=$("#returnModal");
    $("#returnRemark").value=""; $("#returnPhotos").value="";
    const pr=$("#returnPickupPhotos");
    pr.innerHTML=(it.pickupPhotos||[]).map(src=>`<img src="${src}">`).join("");
    dlg.showModal();
    $("#returnCancel").onclick=()=>dlg.close();
    $("#returnOk").onclick=async ()=>{
      const cond=(document.querySelector('input[name="returnCondition"]:checked')||{}).value||'ok';
      const files=$("#returnPhotos").files;
      const photos=[];
      for(const f of files) photos.push(await fileToDataURL(f,1600,0.7));
      it.status=(cond==="damaged")?"damaged":"returned";
      it.returnPhotos=photos;
      const prod=state.products.find(p=>p.id===it.productId);
      if(prod) prod.inventoryStatus=(cond==="damaged")?"Maintenance":"In store";
      save(LS.products,state.products); save(LS.bookings,state.bookings);
      dlg.close(); renderPickReturn(); renderBookings();
      toast("Return finalized (urgent)");
      if(typeof updateNavBadges==='function') updateNavBadges();
    };
  }
});
