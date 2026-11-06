(() => {
  'use strict';
  const host = window.chrome?.webview;
  if (!host) return;
  const storageKey = 'orb-windows-paired-session';
  let lastToken, lastPlayback = '';
  const send = message => { try { host.postMessage(message); } catch {} };

  // BLE and session state remain active; no redundant status badge in the sidebar.
  host.addEventListener('message', event => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'orb-desktop:update') {
      const check=document.getElementById('orb-check-update');
      const install=document.getElementById('orb-install-update');
      const status=document.getElementById('orb-update-status');
      const progress=document.getElementById('orb-update-progress');
      if (!check || !install || !status || !progress) return;
      const busy=['checking','downloading','progress','installing'].includes(data.stage);
      check.disabled=busy;
      check.textContent=busy ? (data.stage==='checking' ? 'Verificando…' : 'Baixando…') : 'Buscar atualização';
      progress.hidden=!['downloading','progress'].includes(data.stage);
      if(typeof data.percent==='number') progress.value=Math.max(0,Math.min(100,data.percent));
      if(data.stage==='ready') {
        install.hidden=false;install.disabled=false;
      } else if(data.stage==='checking' || data.stage==='current' || data.stage==='error' || data.stage==='downloading') {
        install.hidden=true;
      }
      if(typeof data.message==='string') status.textContent=data.message;
      else if(data.stage==='progress') status.textContent='Baixando '+(data.version||'atualização')+': '+Math.round(data.percent||0)+'%';
    }
  });

  const checkUpdate=document.getElementById('orb-check-update');
  if(checkUpdate)checkUpdate.addEventListener('click',()=>send({type:'orb-desktop:update-check'}));
  const installUpdate=document.getElementById('orb-install-update');
  if(installUpdate)installUpdate.addEventListener('click',()=>{
    if(window.confirm('Deseja fechar o Orb Music e abrir o instalador da atualização baixada?')) {
      installUpdate.disabled=true;
      send({type:'orb-desktop:update-install'});
    }
  });

  function sync() {
    if (typeof state === 'undefined' || typeof audio === 'undefined') return;
    const token = state.token || null;
    if (token !== lastToken) {
      lastToken = token;
      try { if (token) localStorage.setItem(storageKey, token); else localStorage.removeItem(storageKey); } catch {}
      send({type:'orb-desktop:auth',token});
      if (token) send({type:'orb-desktop:capabilities'});
    }
    const playback = {type:'orb-desktop:playback',playing:!audio.paused&&!state.followingApp,
      nowPlayingOpen:Boolean(document.getElementById('now-playing')?.open)};
    const current = JSON.stringify(playback);
    if (current !== lastPlayback) { lastPlayback = current; send(playback); }
  }

  // Preserve the square format of real album artwork. The thumbnail fallback
  // uses 4:3 YouTube frames that often contain a centered square and black bands.
  function normalizeArt(img) {
    if (!(img instanceof HTMLImageElement)) return;
    const isYoutube = /^https:\/\/i\.ytimg\.com\/vi\//i.test(img.currentSrc || img.src);
    if (!isYoutube && !img.closest('.orb-art-crop')) return;
    let shell = img.closest('.orb-art-crop');
    if (isYoutube && !shell) {
      shell = document.createElement('span');
      shell.className = 'orb-art-crop';
      if (img.classList.contains('card-art')) {
        img.classList.remove('card-art'); shell.classList.add('card-art');
      } else if (img.closest('.full-art')) {
        shell.classList.add('full-player-art');
      } else if (img.id === 'mini-art') {
        shell.classList.add('mini-art-crop');
        shell.id = img.id; img.removeAttribute('id');
      } else if (img.closest('.track-row')) shell.classList.add('row-art-crop');
      else return;
      img.before(shell); shell.append(img);
    }
    img.classList.toggle('orb-video-thumb',isYoutube);
  }
  function scanImages(root) {
    if (root instanceof HTMLImageElement) normalizeArt(root);
    if (root instanceof Element) root.querySelectorAll('img').forEach(normalizeArt);
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') { normalizeArt(record.target); continue; }
      record.addedNodes.forEach(scanImages);
    }
  });
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
  scanImages(document.body);

  const svgIcon = (paths, size=24) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('width',String(size));
    svg.setAttribute('height',String(size)); svg.setAttribute('fill','none');
    svg.setAttribute('stroke','currentColor'); svg.setAttribute('stroke-width','1.9');
    svg.setAttribute('stroke-linecap','round'); svg.setAttribute('stroke-linejoin','round');
    svg.innerHTML = paths; return svg;
  };
  const icons = {
    shuffle:'<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h2.5a6 6 0 0 0 5-2.7l5-8.6A6 6 0 0 1 19.5 4H22"/><path d="M2 6h2.5a6 6 0 0 1 5 2.7l1.2 2"/><path d="m14.4 16 1 1.4A6 6 0 0 0 20 19h2"/>',
    queue:'<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    lyrics:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'
  };
  const expanded = document.querySelector('#now-playing .full-info');
  if (expanded && !document.getElementById('orb-expanded-actions')) {
    const secondary = document.createElement('div'); secondary.className='orb-expanded-actions';secondary.id='orb-expanded-actions';
    const makeButton = (name,title,click) => {
      const btn=document.createElement('button'); btn.type='button';btn.className='orb-action';
      btn.setAttribute('aria-label',title);
      const actionIcon=document.createElement('span'); actionIcon.className='orb-action-icon';
      actionIcon.style.maskImage=`url(icons/${name}.png)`;
      actionIcon.style.webkitMaskImage=`url(icons/${name}.png)`;
      btn.append(actionIcon);
      const label=document.createElement('span');label.textContent=title;btn.append(label);
      btn.addEventListener('click',click); secondary.append(btn);return btn;
    };
    const shuffle = makeButton('shuffle','Aleatório',()=>document.getElementById('shuffle')?.click());
    const sourceShuffle = document.getElementById('shuffle');
    if (sourceShuffle) {
      const reflect=()=>shuffle.setAttribute('aria-pressed',sourceShuffle.getAttribute('aria-pressed')||'false');
      new MutationObserver(reflect).observe(sourceShuffle,{attributes:true,attributeFilter:['aria-pressed']});reflect();
    }
    const lyricsButton=makeButton('lyrics','Letras',showLyrics);lyricsButton.id='orb-lyrics-action';lyricsButton.setAttribute('aria-pressed','false');
    const queueButton = makeButton('queue','Fila',toggleExpandedQueue);
    queueButton.id = 'orb-expanded-queue-button';
    queueButton.setAttribute('aria-expanded','false');
    expanded.append(secondary);
  }


  // Keep the existing Now Playing open; widen its grid to reveal the queue.
  const expandedQueue=document.getElementById('orb-expanded-queue');
  const nowPlaying=document.getElementById('now-playing');
  function toggleExpandedQueue(force) {
    if (!expandedQueue || !nowPlaying) return;
    const isOpen=nowPlaying.classList.contains('orb-queue-open');
    const open=typeof force==='boolean' ? force : !isOpen;
    expandedQueue.hidden=!open;
    nowPlaying.classList.toggle('orb-queue-open',open);
    if(open){
      const lyrics=document.getElementById('orb-desktop-lyrics');
      if(lyrics) lyrics.hidden=true;
      nowPlaying.classList.remove('orb-lyrics-open');
      document.getElementById('orb-lyrics-action')?.setAttribute('aria-pressed','false');
    }
    nowPlaying.classList.toggle('orb-side-open',open || !document.getElementById('orb-desktop-lyrics')?.hidden);
    const button=document.getElementById('orb-expanded-queue-button');
    button?.setAttribute('aria-expanded',String(open));
    button?.setAttribute('aria-pressed',String(open));
    if(open) {
      renderQueue();
      requestAnimationFrame(()=>expandedQueue.querySelector('.track-row.active')?.scrollIntoView({block:'nearest'}));
    }
  }
  document.getElementById('orb-close-expanded-queue')?.addEventListener('click',()=>toggleExpandedQueue(false));
  nowPlaying?.addEventListener('close',()=>toggleExpandedQueue(false));
  document.getElementById('orb-clear-sidebar-queue')?.addEventListener('click',clearQueueKeepingCurrent);
  document.getElementById('orb-clear-expanded-queue')?.addEventListener('click',clearQueueKeepingCurrent);
  renderQueue();

  const dialog=document.createElement('section');dialog.id='orb-desktop-lyrics';
  dialog.className='orb-expanded-lyrics';dialog.hidden=true; dialog.setAttribute('aria-label','Letras');
  dialog.innerHTML='<header class="orb-lyrics-head"><div><h2 id="orb-lyrics-title">Letras</h2><p id="orb-lyrics-artist"></p></div><button id="orb-lyrics-close" class="icon-button" type="button" aria-label="Ocultar letras">✕</button></header><div id="orb-lyrics-content" class="orb-lyrics-content" role="region" aria-label="Letra da música"></div>';
  nowPlaying.append(dialog);
  function closeLyrics() {
    dialog.hidden=true;nowPlaying.classList.remove('orb-lyrics-open');
    if(!nowPlaying.classList.contains('orb-queue-open'))nowPlaying.classList.remove('orb-side-open');
    document.getElementById('orb-lyrics-action')?.setAttribute('aria-pressed','false');
  }
  dialog.querySelector('#orb-lyrics-close').addEventListener('click',closeLyrics);
  nowPlaying.addEventListener('close',()=>{closeLyrics();requestSerial++;});
  const lyricsCache=new Map(); let lyricLines=[];let requestSerial=0;let lastActive=-1;
  const content=dialog.querySelector('#orb-lyrics-content');
  function updateLyrics() {
    if(dialog.hidden || !lyricLines.length)return;
    const now=audio.currentTime||0;
    let active=-1;
    for(let i=0;i<lyricLines.length;i++) if(lyricLines[i].at<=now+.12)active=i;
    if(active===lastActive)return;
    lastActive=active;
    const elements=content.querySelectorAll('.orb-lyric-line');
    elements.forEach((el,i)=>el.classList.toggle('current',i===active));
    if(active>=0) elements[active]?.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  audio.addEventListener('timeupdate',updateLyrics);
  function renderLyrics(result) {
    lyricLines=[];lastActive=-1;content.replaceChildren();
    if(result.instrumental) {content.textContent='Esta faixa é instrumental.';return;}
    if(result.syncedLyrics) {
      for(const row of result.syncedLyrics.split(/\r?\n/)){
        const match=row.match(/^\[(\d{1,3}):(\d{2})(?:\.(\d+))?\](.*)$/);
        if(!match)continue;
        const at=Number(match[1])*60+Number(match[2])+Number('0.'+(match[3]||'0'));
        const line=match[4].trim();if(!line)continue;
        lyricLines.push({at,line});
      }
      lyricLines.sort((a,b)=>a.at-b.at);
      if(lyricLines.length){
        for(const item of lyricLines) {
          const el=document.createElement('button');el.className='orb-lyric-line';el.type='button';
          el.textContent=item.line;
          const atLabel=Math.floor(item.at/60)+':'+String(Math.floor(item.at%60)).padStart(2,'0');
          el.title='Ir para '+atLabel;
          el.setAttribute('aria-label','Ir para '+atLabel+': '+item.line);
          el.addEventListener('click',()=>{
            if (state.followingApp || !Number.isFinite(audio.duration) || audio.duration<=0) return;
            audio.currentTime=Math.max(0,Math.min(item.at,audio.duration));
            updateLyrics();
          });
          content.append(el);
        }
        updateLyrics();return;
      }
    }
    content.textContent=result.plainLyrics||'Letra não encontrada para esta gravação.';
  }
  async function showLyrics() {
    const track=state.queue?.[state.index];
    const title=track?.title||document.getElementById('full-title')?.textContent||'';
    const artist=track?.artist||document.getElementById('full-artist')?.textContent||'';
    document.getElementById('orb-lyrics-title').textContent=title||'Letras';
    document.getElementById('orb-lyrics-artist').textContent=artist;
    if(!dialog.hidden){closeLyrics();return;}
    toggleExpandedQueue(false);
    dialog.hidden=false;nowPlaying.classList.add('orb-side-open','orb-lyrics-open');
    document.getElementById('orb-lyrics-action')?.setAttribute('aria-pressed','true');
    if(!title||!artist){content.textContent='Selecione uma música para consultar a letra.';return;}
    const key=title+'|'+artist+'|'+(track?.duration||'');
    dialog.dataset.trackKey=key;
    if(lyricsCache.has(key)){renderLyrics(lyricsCache.get(key));return;}
    const serial=++requestSerial;content.textContent='Buscando letra…';
    try{
      const q=new URLSearchParams({track_name:title,artist_name:artist});
      if(track?.album)q.set('album_name',track.album);
      if(track?.duration && track.duration>0)q.set('duration',String(Math.round(track.duration)));
      const response=await fetch('https://lrclib.net/api/get?'+q.toString(),{
        headers:{'Lrclib-Client':'Orb Music Windows/0.1.0 (https://orbmusic.online)'},signal:AbortSignal.timeout(12000)});
      if(serial!==requestSerial || dialog.hidden)return;
      if(response.status===404){content.textContent='Letra não encontrada para esta gravação.';return;}
      if(response.status===429){content.textContent='Serviço de letras ocupado. Tente novamente mais tarde.';return;}
      if(!response.ok)throw new Error('HTTP '+response.status);
      const result=await response.json();lyricsCache.set(key,result);renderLyrics(result);
    }catch{if(serial===requestSerial && !dialog.hidden)content.textContent='Não foi possível carregar a letra agora.';}
  }

  // If the song changes while the side lyrics are visible, load its own lines.
  setInterval(() => {
    if(dialog.hidden)return;
    const song=state.queue?.[state.index];
    const key=(song?.title||'')+'|'+(song?.artist||'')+'|'+(song?.duration||'');
    if(key !== dialog.dataset.trackKey){
      closeLyrics();
      void showLyrics();
    }
  },1100);

  // Orb account ratings are synced through the existing song_ratings table.
  // We match YouTube/video IDs where possible, and recording keys otherwise.
  let ratings = new Map();
  let canonicalRatingIds = new Map();
  let ratingLoading = false;
  let lastRatingToken = null;
  let lastRatingsFetch = 0;
  let activeTrack = null;
  let pendingRating = false;
  const likeControls = ['orb-mini-like', 'orb-full-like'];
  function ratingKey(track) {
    const tidy = value => String(value ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
    const seconds = Math.round(Number(track?.duration ?? 0));
    const bucket = seconds > 0 ? String(Math.floor((seconds + 2) / 5) * 5) : '?';
    return `rec:v1:${tidy(track?.title)}|${tidy(track?.artist)}|${bucket}`;
  }
  function ratingKeyForTrack(track) {
    if (!track) return '';
    return ratings.get('id:'+String(track.videoId||track.id||'')) || ratings.get('key:'+ratingKey(track)) || '';
  }
  function renderRating() {
    const track = activeTrack || (typeof state !== 'undefined' ? state.queue?.[state.index] : null);
    const ready = !!(track?.title && track?.artist && state?.token);
    const liked = ready && ratingKeyForTrack(track) === 'LIKE';
    for (const id of likeControls) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.disabled = !ready || pendingRating;
      button.setAttribute('aria-pressed', String(liked));
      button.setAttribute('aria-label', liked ? 'Remover curtida' : 'Curtir música');
      button.title = liked ? 'Remover curtida' : 'Curtir música';
    }
    const confirmedExplicit = track?.explicit === true;
    for (const id of ['orb-mini-explicit','orb-full-explicit']) {
      const badge = document.getElementById(id);
      if (badge) badge.hidden = !confirmedExplicit;
    }
  }
  async function refreshRatings(force=false) {
    const token = state?.token;
    if (!token || ratingLoading) return;
    if (!force && token === lastRatingToken && Date.now()-lastRatingsFetch<45000) return;
    ratingLoading = true;
    try {
      const response = await api('/ratings');
      if (state.token !== token) return;
      const next = new Map();
      const canonical = new Map();
      for (const rating of response.ratings ?? []) {
        if (rating.videoId) next.set('id:'+rating.videoId,rating.status);
        if (rating.recordingKey && !next.has('key:'+rating.recordingKey)) {
          next.set('key:'+rating.recordingKey,rating.status);
          canonical.set(rating.recordingKey,rating.videoId);
        }
      }
      ratings = next; canonicalRatingIds = canonical;
      lastRatingToken = token; lastRatingsFetch = Date.now();
      renderRating();
    } catch (error) {
      console.warn('Falha ao atualizar curtidas:',error?.message||error);
    } finally {ratingLoading=false;}
  }
  function updateTrack(track) {activeTrack=track||null;renderRating();}
  window.orbDesktopUpdateTrack = updateTrack;
  async function toggleTrackLike(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const track=activeTrack||state.queue?.[state.index];
    if (!track||pendingRating||!state.token) return;
    const previous = ratingKeyForTrack(track);
    const status = previous === 'LIKE' ? 'INDIFFERENT' : 'LIKE';
    // Update the original Android-owned row for this recording when it exists.
    const id = String(canonicalRatingIds.get(ratingKey(track)) || track.videoId || track.id || track.tidalId || '');
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
      notify('Não é possível identificar esta gravação.');return;
    }
    pendingRating=true;renderRating();
    try {
      const response = await api('/rating',{method:'POST',body:{videoId:id, status,
        title:track.title,artist:track.artist,album:track.album||'',duration:Math.round(Number(track.duration||0))}});
      ratings.set('id:'+id,status);
      ratings.set('key:'+response.recordingKey,status);
      canonicalRatingIds.set(response.recordingKey,id);
      if (Array.isArray(state.library?.likes)) {
        state.library.likes = state.library.likes.filter(t=>String(t.id)!==id && ratingKey(t)!==response.recordingKey);
        if(status==='LIKE')state.library.likes.unshift({...track});
        if(state.view==='likes' || state.view==='home')renderView();
      }
      notify(status==='LIKE' ? 'Música curtida e sincronizada.' : 'Curtida removida.');
    }catch(error){notify(error?.message||'Não foi possível sincronizar a curtida.');}
    finally {pendingRating=false;renderRating();}
  }
  for (const id of likeControls)document.getElementById(id)?.addEventListener('click',toggleTrackLike);
  // Poll cheap rating metadata, not track audio. Android changes are reflected when active.
  const ratingTimer=setInterval(()=>{
    if(!state?.token){ratings.clear();canonicalRatingIds.clear();lastRatingToken=null;lastRatingsFetch=0;activeTrack=null;renderRating();return;}
    if(!activeTrack && state.queue?.[state.index]) updateTrack(state.queue[state.index]);
    void refreshRatings();
  },2000);
  if (state?.token) {updateTrack(state.queue?.[state.index]||null); void refreshRatings(true);}

  // Android ThinSlider.kt: travelling sine wave with smooth fade towards a round head.
  const wormSliders=['seek','full-seek'].map(id=>document.getElementById(id)).filter(Boolean);
  const wormHosts=[];
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  for (const slider of wormSliders) {
    const host=document.createElement('span');host.className='orb-worm-host';
    slider.before(host);host.append(slider);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.classList.add('orb-worm-visual');svg.setAttribute('aria-hidden','true');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.classList.add('orb-worm-wave');
    const head=document.createElementNS('http://www.w3.org/2000/svg','circle');head.classList.add('orb-worm-head-dot');
    svg.append(path,head);host.append(svg);
    wormHosts.push({slider,host,svg,path,head,phase:0});
  }
  let lastFrame=performance.now();
  function drawWorms(timestamp){
    const dt=Math.max(0,Math.min(60,timestamp-lastFrame));lastFrame=timestamp;
    const moving=!audio.paused && !state.followingApp && !reducedMotion.matches;
    for(const w of wormHosts){
      const width=w.host.getBoundingClientRect().width;
      if(width<1)continue;
      const height=Math.max(24,w.host.getBoundingClientRect().height);
      const min=Number(w.slider.min)||0,max=Number(w.slider.max)||100;
      const f=Math.max(0,Math.min(1,((Number(w.slider.value)||0)-min)/Math.max(1,max-min)));
      const radius=8, cx=Math.max(radius,Math.min(width-radius,width*f));
      const end=Math.max(0,cx-radius), center=height/2;
      if(moving)w.phase+=dt/1250*Math.PI*2;
      const wavelength=Math.max(22,end/6.5);
      const amplitude=reducedMotion.matches?0:2.45;
      const points=[];
      for(let x=0;x<end;x+=2){
        const t=end?x/end:0;
        const envelope=.48+.52*Math.max(0,Math.sin(Math.PI*t));
        const fade=Math.max(0,Math.min(1,(1-t)/.075));
        const smooth=fade*fade*(3-2*fade);
        const y=center+amplitude*Math.sin(x/wavelength*Math.PI*2-w.phase)*envelope*smooth;
        points.push((points.length?'L':'M')+x.toFixed(1)+' '+y.toFixed(2));
      }
      if(end>0)points.push('L'+end.toFixed(1)+' '+center.toFixed(2));
      w.svg.setAttribute('viewBox','0 0 '+width+' '+height);
      w.path.setAttribute('d',points.join(' '));
      w.head.setAttribute('cx',cx.toFixed(2));w.head.setAttribute('cy',center.toFixed(2));w.head.setAttribute('r',radius);
      w.svg.style.opacity=w.slider.disabled?'.45':'1';
    }
    requestAnimationFrame(drawWorms);
  }
  requestAnimationFrame(drawWorms);

  sync();setInterval(sync,600);
})();
