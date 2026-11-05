(() => {
  'use strict';
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => {try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}};
  let profiles=[];
  let activeRequest=0;
  let activeController=null;
  window.cancelDirectory = () => { activeRequest++; activeController?.abort(); activeController=null; };
  window.workspaceVendors=[];
  const name = id => MARKETS.find(m=>m.id===id)?.short||id;
  const image = p => /^data:image\/(png|jpeg|webp);base64,/.test(p.photoData||'') ? p.photoData : '';
  const publicServiceOrigin = () => String(window.FSM_API_ORIGIN||location.origin).replace(/\/$/,'');
  const mediaUrl = id => `${publicServiceOrigin()}/api/media?id=${encodeURIComponent(id)}`;
  const listText = value => Array.isArray(value) ? value.map(item=>typeof item==='string'?item:(item?.name||item?.label||'')).filter(Boolean).join(' · ') : String(value||'');
  const profileFact = (label,value) => value ? `<div><dt>${e(label)}</dt><dd>${e(listText(value))}</dd></div>` : '';
  const offers = list => list.length?`<div class="published-offers"><span class="eyebrow">From this business</span><h2>CURRENT OFFERS</h2>${list.map(o=>`<article class="offer-ticket"><span class="fine">${e(o.startDate)} – ${e(o.endDate)}</span><h3>${e(o.title)}</h3><p><strong>${e(o.value)}</strong></p><p>${e(o.description)}</p><p class="fine" style="margin-top:12px">${o.marketIds.map(id=>e(name(id))).join(' · ')}</p></article>`).join('')}<p class="fine">Offers are published by the business. Confirm availability and redemption terms directly; a listing does not confirm market attendance.</p></div>`:'';
  window.workspaceVendorCard = v => `<article class="vendor-card"><div class="vendor-visual">${image(v.profile)?`<img loading="lazy" src="${e(image(v.profile))}" alt="${e(v.name)}">`:`<span class="vendor-monogram">${e(v.name.slice(0,2).toUpperCase())}</span>`}${window.FSMCustomer?.saveButton?.('vendor',v.id,v.name)||''}</div><div class="card-body"><span class="vendor-category">${e(v.category)} · Vendor-published</span><h3><a href="#vendor/${e(v.id)}">${e(v.name)}</a></h3><p>${e(v.description)}</p>${v.products?.length?`<p class="fine">Products: ${e(listText(v.products))}</p>`:''}<a class="text-link" href="#vendor/${e(v.id)}">View profile & offers ↗</a></div></article>`;
  window.workspaceProfilePage = id => {
    const entry=profiles.find(p=>'profile-'+p.id===id);
    if(!entry)return `<section class="page-head wrap" id="workspace-profile-public"><span class="eyebrow">Vendor directory</span><h1>LOADING PROFILE…</h1><p role="status">Getting the published business details.</p></section>`;
    const p=entry.profile,x=entry.extras||p.extras||p,url=safeUrl(p.website),shop=safeUrl(x.shopUrl),contact=safeUrl(x.contactUrl),instagram=safeUrl(p.instagram);
    const gallery=Array.isArray(x.gallery)?x.gallery.filter(item=>item?.fileId).slice(0,8):[];
    const facts=[profileFact('Products',x.products),profileFact('Dietary notes',x.dietaryNotes),profileFact('Allergen information',x.allergenNotes),profileFact('Accepted payments',x.paymentMethods),profileFact('Pickup',x.pickupNotes),profileFact('Accessibility & service',x.accessibilityNotes),profileFact('Preferred contact',x.contactPreference)].join('');
    const shareUrl=`${publicServiceOrigin()}/share/vendor/${encodeURIComponent(entry.id)}`;
    return `<section class="page-head wrap"><div class="breadcrumb"><a href="#vendors">Vendor directory</a><span>/</span><span>${e(p.businessName)}</span></div><span class="eyebrow">${e(p.city)} · Vendor-published profile</span><h1>${e(p.businessName)}</h1><p>${e(p.shortDescription)}</p></section><section class="wrap details-layout"><div class="detail-content"><h2>MEET THE BUSINESS</h2><p style="white-space:pre-line;margin-top:20px">${e(p.about||p.shortDescription)}</p><div class="chips">${p.categories.map(c=>`<span class="pill">${e(c)}</span>`).join('')}</div>${facts?`<dl class="profile-shopper-facts">${facts}</dl>`:''}${gallery.length?`<div class="profile-gallery">${gallery.map(item=>`<figure><img loading="lazy" src="${e(mediaUrl(item.fileId))}" alt="${e(item.caption||`${p.businessName} product`)}"><figcaption>${e(item.caption||'Vendor product photo')}</figcaption></figure>`).join('')}</div>`:''}<div class="button-row">${shop?`<a class="button" href="${e(shop)}" target="_blank" rel="noopener">Shop / order ↗</a>`:url?`<a class="button" href="${e(url)}" target="_blank" rel="noopener">Visit the business ↗</a>`:''}${contact?`<a class="button outline" href="${e(contact)}" target="_blank" rel="noopener">Contact ↗</a>`:''}${instagram?`<a class="text-link" href="${e(instagram)}" target="_blank" rel="noopener">Instagram ↗</a>`:''}</div>${offers(entry.offers)}<div class="notice"><p>Business details are published by the vendor. Dietary and allergen notes are informational; confirm ingredients and cross-contact directly before purchasing. A profile does not establish attendance unless a market appearance is marked confirmed.</p></div></div><aside class="detail-panel">${image(p)?`<img class="live-profile-image" src="${e(image(p))}" alt="${e(p.businessName)}">`:`<div class="profile-initial">${e(p.businessName.slice(0,2).toUpperCase())}</div>`}<h3>KEEP IN TOUCH</h3><p style="margin:15px 0">Save or follow this business without losing the public profile link.</p>${window.FSMCustomer?.saveButton?.('vendor',id,p.businessName)||''}<button class="button outline" data-follow="vendor:${e(id)}">Follow for updates</button><button class="button outline" data-share-url="${e(shareUrl)}">Copy share-ready profile link</button><p class="fine" style="margin-top:16px">Anyone can view the published profile without signing in.</p></aside></section>`;
  };
  window.initDirectory = async (page,id) => {
    const path=location.hash;
    const requestNumber=++activeRequest;
    activeController?.abort();
    const controller=new AbortController();
    activeController=controller;
    profiles=[];window.workspaceVendors=[];
    if(page==='vendors')filterVendors();
    if(page==='vendor'&&id?.startsWith('profile-'))document.getElementById('main').innerHTML=window.workspaceProfilePage(id);
    try{
      const endpoint=new URL(window.FSM_DIRECTORY_URL||'/api/directory',location.href);
      if(page==='vendor'&&id?.startsWith('profile-'))endpoint.searchParams.set('id',id.slice(8));
      const loaded=new Map();
      const seenCursors=new Set();
      let cursor=null;
      do{
        if(cursor)endpoint.searchParams.set('cursor',cursor);
        const res=await fetch(endpoint.href,{cache:'no-store',credentials:'omit',signal:controller.signal});
        if(!res.ok)throw new Error('directory_unavailable');
        const data=await res.json();
        if(!Array.isArray(data.profiles))throw new Error('invalid_directory');
        if(requestNumber!==activeRequest||location.hash!==path)return;
        for(const profile of data.profiles)loaded.set(profile.id,profile);
        cursor=data.nextCursor||null;
        if(cursor&&seenCursors.has(cursor))throw new Error('invalid_directory_cursor');
        if(cursor)seenCursors.add(cursor);
        profiles=[...loaded.values()].sort((a,b)=>a.profile.businessName.localeCompare(b.profile.businessName));
        window.workspaceVendors=profiles.map(x=>{const extras=x.extras||x.profile.extras||x.profile;return{id:'profile-'+x.id,name:x.profile.businessName,description:x.profile.shortDescription,category:x.profile.categories[0]||'Independent business',categories:x.profile.categories,products:Array.isArray(extras.products)?extras.products:[],markets:[],workspaceProfile:true,profile:x.profile,extras,offers:x.offers};});
        if(page==='vendors'&&location.hash===path){
          filterVendors();
          let progress=document.getElementById('directory-progress');
          if(!progress){progress=document.createElement('p');progress.id='directory-progress';progress.className='fine';document.getElementById('vendor-results')?.before(progress);}
          progress.textContent=cursor?`${profiles.length} published profiles loaded · loading more…`:'';
        }
      }while(cursor);
      profiles=[...loaded.values()].sort((a,b)=>a.profile.businessName.localeCompare(b.profile.businessName));
      window.workspaceVendors=profiles.map(x=>{const extras=x.extras||x.profile.extras||x.profile;return{id:'profile-'+x.id,name:x.profile.businessName,description:x.profile.shortDescription,category:x.profile.categories[0]||'Independent business',categories:x.profile.categories,products:Array.isArray(extras.products)?extras.products:[],markets:[],workspaceProfile:true,profile:x.profile,extras,offers:x.offers};});
      window.FSMCustomer?.directoryChanged?.(window.workspaceVendors);
      if(location.hash!==path)return;
      if(page==='vendors'){
        filterVendors();
        document.getElementById('directory-progress')?.remove();
        const note=document.createElement('p');note.className='fine workspace-directory-note';note.id='directory-state';note.textContent=`${profiles.length} ${profiles.length===1?'profile':'profiles'} published through the new vendor workspace. These public profiles are available without sign-in; a listing does not confirm market attendance.`;
        document.getElementById('directory-state')?.remove();document.getElementById('vendor-results').after(note);
      }
      if(page==='vendor'&&id?.startsWith('profile-')){
        const liveEntry=profiles.find(x=>'profile-'+x.id===id);
        if(liveEntry)document.title=liveEntry.profile.businessName+' · Four Seasons Markets';
        document.getElementById('main').innerHTML=profiles.some(x=>'profile-'+x.id===id)?window.workspaceProfilePage(id):`<section class="page-head wrap"><h1>PROFILE UNAVAILABLE</h1><p>This profile is not currently published.</p><a href="#vendors" class="button" style="margin-top:20px">Back to the directory</a></section>`;
      }
      if(page==='market'){
        document.getElementById('market-live-offers')?.remove();
        const relevant=profiles.flatMap(p=>p.offers.filter(o=>o.marketIds.includes(id)).map(o=>({...o,business:p.profile.businessName,profileId:p.id})));
        if(relevant.length){const el=document.createElement('section');el.id='market-live-offers';el.innerHTML=`<h2>VENDOR OFFERS</h2><p>Created in the new workspace. These offers do not confirm the vendor’s attendance.</p>${relevant.map(o=>`<article class="offer-ticket"><span class="fine">${e(o.business)}</span><h3>${e(o.title)}</h3><p><strong>${e(o.value)}</strong></p><p>${e(o.description)}</p><a class="text-link" href="#vendor/profile-${e(o.profileId)}" style="margin-top:12px">View profile & terms ↗</a></article>`).join('')}`;document.querySelector('.detail-content')?.append(el);}
      }
      if(page==='saved')window.FSMCustomer?.directoryChanged?.(window.workspaceVendors);
    }catch{
      if(requestNumber!==activeRequest||location.hash!==path)return;
      profiles=[];window.workspaceVendors=[];
      if(page==='vendors')filterVendors();
      if(page==='vendor'&&id?.startsWith('profile-'))document.getElementById('main').innerHTML=`<section class="page-head wrap"><h1>COULDN’T LOAD THIS PROFILE</h1><p>Check your connection and reload this page to try again.</p><a class="button" href="#vendors" style="margin-top:20px">Back to vendors</a></section>`;
      if(page==='vendors'){const el=document.createElement('p');el.className='notice';el.textContent='Workspace profiles are temporarily unavailable. The researched directory remains available below.';document.getElementById('vendor-results')?.before(el);}
    }
  };
})();
